type MessageScrollerMode =
  | 'following-bottom'
  | 'free-scrolling'
  | 'anchored-to-message'
  | 'settling-jump'

type MessageScrollerScrollable = {
  start: boolean
  end: boolean
}

type MessageScrollerScrollOptions = {
  readonly align?: 'start' | 'center' | 'end' | 'nearest'
  readonly behavior?: ScrollBehavior
  readonly scrollMargin?: number
}

type MessageScrollerItemOptions = {
  readonly messageId?: string
  readonly scrollAnchor?: boolean
}

const defaultScrollEdgeThreshold = 8
const defaultScrollPreviousItemPeek = 64
const scrollPositionEpsilon = 0.5
const autoscrollingClearDelay = 180
const userScrollKeys = new Set([
  'ArrowDown',
  'ArrowUp',
  'End',
  'Home',
  'PageDown',
  'PageUp',
  ' ',
])

const emptyScrollable: MessageScrollerScrollable = {
  start: false,
  end: false,
}

class MessageScrollerController {
  private rootElement: HTMLDivElement | null = null
  private viewportElement: HTMLDivElement | null = null
  private contentElement: HTMLDivElement | null = null
  private spacerElement: HTMLDivElement | null = null
  private messageElements = new Map<string, HTMLElement>()
  private handledScrollAnchors = new WeakSet<HTMLElement>()
  private mode: MessageScrollerMode = 'following-bottom'
  private itemCount = 0
  private firstItem: HTMLElement | null = null
  private streamingTurn: HTMLElement | null = null
  private autoscrolling = false
  private autoscrollingTimeout: number | null = null
  private defaultScrollPositionApplied = false
  private pendingScrollFrame: number | null = null
  private pendingScrollToMessage: {
    messageId: string
    options?: MessageScrollerScrollOptions
  } | null = null
  private stateFrame: number | null = null
  private lastScrollTop = 0
  private spacerGap = 0
  private spacerHeight = 0
  private prependRestore: {
    element: HTMLElement
    viewportTop: number
  } | null = null

  readonly scrollable = $state<MessageScrollerScrollable>(emptyScrollable)

  constructor(
    private readonly options: {
      readonly autoScroll?: boolean
      readonly defaultScrollPosition?: 'start' | 'end' | 'last-anchor'
      readonly scrollEdgeThreshold?: number
      readonly scrollMargin?: number
      readonly scrollPreviousItemPeek?: number
    } = {}
  ) {
    this.mode =
      options.autoScroll === false ? 'free-scrolling' : 'following-bottom'
  }

  get canScrollToEnd() {
    return this.scrollable.end
  }

  readonly root = (node: HTMLDivElement) => {
    this.rootElement = node
    this.writeStateAttributes()

    return {
      destroy: () => {
        if (this.rootElement === node) this.rootElement = null
      },
    }
  }

  readonly viewport = (node: HTMLDivElement) => {
    this.viewportElement = node
    this.writeStateAttributes()

    const handleScroll = () => this.syncAfterScroll()
    const handleIntent = () => this.userScrollIntent()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (userScrollKeys.has(event.key)) this.userScrollIntent()
    }
    let resizeFrame = 0
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            window.cancelAnimationFrame(resizeFrame)
            resizeFrame = window.requestAnimationFrame(() =>
              this.handleResize()
            )
          })

    node.addEventListener('scroll', handleScroll)
    node.addEventListener('wheel', handleIntent)
    node.addEventListener('touchmove', handleIntent)
    node.addEventListener('keydown', handleKeyDown)
    resizeObserver?.observe(node)

    requestAnimationFrame(() => {
      this.handleContentChange()
    })

    return {
      destroy: () => {
        node.removeEventListener('scroll', handleScroll)
        node.removeEventListener('wheel', handleIntent)
        node.removeEventListener('touchmove', handleIntent)
        node.removeEventListener('keydown', handleKeyDown)
        window.cancelAnimationFrame(resizeFrame)
        resizeObserver?.disconnect()
        if (this.viewportElement === node) this.viewportElement = null
      },
    }
  }

  readonly content = (node: HTMLDivElement) => {
    this.contentElement = node
    this.handleContentChange()

    const mutationObserver =
      typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver(() => this.handleContentChange())
    let resizeFrame = 0
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            window.cancelAnimationFrame(resizeFrame)
            resizeFrame = window.requestAnimationFrame(() =>
              this.handleResize()
            )
          })

    mutationObserver?.observe(node, { childList: true })
    resizeObserver?.observe(node)

    return {
      destroy: () => {
        mutationObserver?.disconnect()
        window.cancelAnimationFrame(resizeFrame)
        resizeObserver?.disconnect()
        if (this.contentElement === node) this.contentElement = null
      },
    }
  }

  readonly spacer = (node: HTMLDivElement) => {
    this.spacerElement = node
    this.spacerGap = getFlexGap(node.parentElement)

    return {
      destroy: () => {
        if (this.spacerElement === node) this.spacerElement = null
      },
    }
  }

  readonly item = (
    node: HTMLDivElement,
    options: MessageScrollerItemOptions
  ) => {
    let current = options

    const apply = (next: MessageScrollerItemOptions) => {
      if (current.messageId && current.messageId !== next.messageId) {
        this.messageElements.delete(current.messageId)
      }

      current = next
      node.dataset.scrollAnchor = next.scrollAnchor ? 'true' : 'false'

      if (next.messageId) {
        node.dataset.messageId = next.messageId
        this.messageElements.set(next.messageId, node)
        this.schedulePendingScrollToMessageFlush(next.messageId)
      } else {
        delete node.dataset.messageId
      }
    }

    apply(options)

    return {
      update: apply,
      destroy: () => {
        if (
          current.messageId &&
          this.messageElements.get(current.messageId) === node
        ) {
          this.messageElements.delete(current.messageId)
        }
      },
    }
  }

  jumpToEnd(behavior: ScrollBehavior = 'smooth') {
    return this.scrollToEnd({ behavior })
  }

  scrollToMessage(messageId: string, options?: MessageScrollerScrollOptions) {
    const element = this.messageElements.get(messageId)

    if (!element) {
      if (this.itemCount === 0) {
        this.pendingScrollToMessage = { messageId, options }
        this.defaultScrollPositionApplied = true
        return true
      }

      return false
    }

    this.defaultScrollPositionApplied = true

    if (this.scrollToElement(element, options)) {
      this.pendingScrollToMessage = null
      return true
    }

    this.pendingScrollToMessage = { messageId, options }
    return true
  }

  destroy() {
    if (this.autoscrollingTimeout !== null) {
      window.clearTimeout(this.autoscrollingTimeout)
      this.autoscrollingTimeout = null
    }
    if (this.pendingScrollFrame !== null) {
      window.cancelAnimationFrame(this.pendingScrollFrame)
      this.pendingScrollFrame = null
    }
    if (this.stateFrame !== null) {
      window.cancelAnimationFrame(this.stateFrame)
      this.stateFrame = null
    }
  }

  private get autoScroll() {
    return this.options.autoScroll !== false
  }

  private get scrollEdgeThreshold() {
    return this.options.scrollEdgeThreshold ?? defaultScrollEdgeThreshold
  }

  private get scrollMargin() {
    return this.options.scrollMargin ?? 0
  }

  private get scrollPreviousItemPeek() {
    return this.options.scrollPreviousItemPeek ?? defaultScrollPreviousItemPeek
  }

  private get defaultScrollPosition() {
    return this.options.defaultScrollPosition ?? 'end'
  }

  private handleContentChange() {
    const content = this.contentElement
    const viewport = this.viewportElement
    if (!content || !viewport) return

    const items = getMessageScrollerItems(content, this.spacerElement)
    const previousItemCount = this.itemCount
    const previousFirstItem = this.firstItem

    this.itemCount = items.length
    this.firstItem = items[0] ?? null

    const reconcileScrollPosition = () => {
      if (this.flushPendingScrollToMessage()) return

      if (previousItemCount === 0) {
        if (this.applyDefaultScrollPosition()) {
          this.markScrollAnchorsHandled(items)
          return
        }

        if (
          items.length > 0 &&
          this.autoScroll &&
          this.scrollToEnd({ behavior: 'auto' })
        ) {
          this.markScrollAnchorsHandled(items)
          return
        }

        this.commitScrollState()
        return
      }

      const previousFirstIndex = previousFirstItem
        ? items.indexOf(previousFirstItem)
        : -1

      if (previousFirstIndex > 0) {
        this.restorePrependedAnchor()
        return
      }

      if (items.length > previousItemCount) {
        const newAnchor = getNewScrollAnchor(items, previousItemCount)
        if (newAnchor) {
          if (
            this.autoScroll &&
            this.mode === 'following-bottom' &&
            hasMultipleNewScrollAnchors(items, previousItemCount)
          ) {
            this.scrollToEnd({ behavior: 'auto' })
            return
          }

          this.scrollToElement(
            newAnchor,
            { align: 'start' },
            { keepPreviousPeek: true }
          )
          this.handledScrollAnchors.add(newAnchor)
          return
        }
      }

      if (items.length === previousItemCount) {
        const unhandledAnchor = getUnanchoredScrollAnchor(
          items,
          this.handledScrollAnchors
        )

        if (unhandledAnchor) {
          this.scrollToElement(
            unhandledAnchor,
            { align: 'start' },
            { keepPreviousPeek: true }
          )
          this.handledScrollAnchors.add(unhandledAnchor)
          return
        }
      }

      if (this.mode === 'following-bottom' && this.autoScroll) {
        this.scrollToEnd({ behavior: 'auto' })
        return
      }

      this.commitScrollState()
    }

    reconcileScrollPosition()
    this.capturePrependAnchor()
  }

  private markScrollAnchorsHandled(items: ReadonlyArray<HTMLElement>) {
    for (const item of items) {
      if (item.dataset.scrollAnchor === 'true') {
        this.handledScrollAnchors.add(item)
      }
    }
  }

  private handleResize() {
    if (this.mode === 'following-bottom' && this.autoScroll) {
      this.scrollToEnd({ behavior: 'auto' })
      return
    }

    const previousSpacerHeight = this.spacerHeight

    if (this.reanchorToAnchoredMessage()) {
      if (
        this.autoScroll &&
        previousSpacerHeight > 0 &&
        this.spacerHeight === 0
      ) {
        this.scrollToEnd({ behavior: 'auto' })
      }

      return
    }

    this.scheduleStateCommit()
  }

  private syncAfterScroll() {
    this.commitScrollState()
    this.capturePrependAnchor()
  }

  private userScrollIntent() {
    if (
      this.mode === 'following-bottom' ||
      this.mode === 'anchored-to-message' ||
      this.mode === 'settling-jump'
    ) {
      this.streamingTurn = null
      this.mode = 'free-scrolling'
    }
  }

  private reconcileFollowMode(scrollable: MessageScrollerScrollable) {
    const scrollTop = this.viewportElement?.scrollTop ?? 0
    const scrolledUp = scrollTop < this.lastScrollTop - scrollPositionEpsilon

    this.lastScrollTop = scrollTop

    if (
      this.autoScroll &&
      !scrollable.end &&
      this.mode !== 'settling-jump' &&
      this.mode !== 'anchored-to-message'
    ) {
      this.mode = 'following-bottom'
    } else if (
      this.mode === 'following-bottom' &&
      scrollable.end &&
      scrolledUp &&
      !this.autoscrolling
    ) {
      this.mode = 'free-scrolling'
    }
  }

  private commitScrollState() {
    const nextState = getMessageScrollerScrollable({
      content: this.contentElement,
      scrollEdgeThreshold: this.scrollEdgeThreshold,
      spacer: this.spacerElement,
      viewport: this.viewportElement,
    })

    this.reconcileFollowMode(nextState)

    const publishedState =
      this.mode === 'following-bottom'
        ? { ...nextState, end: false }
        : nextState

    this.scrollable.start = publishedState.start
    this.scrollable.end = publishedState.end
    this.writeStateAttributes()
  }

  private scheduleStateCommit() {
    if (this.stateFrame !== null) return

    this.stateFrame = window.requestAnimationFrame(() => {
      this.stateFrame = null
      this.commitScrollState()
    })
  }

  private writeStateAttributes() {
    const scrollable = [
      this.scrollable.start && 'start',
      this.scrollable.end && 'end',
    ]
      .filter(Boolean)
      .join(' ')

    for (const element of [this.rootElement, this.viewportElement]) {
      if (!element) continue

      if (scrollable) element.setAttribute('data-scrollable', scrollable)
      else element.removeAttribute('data-scrollable')

      element.toggleAttribute('data-autoscrolling', this.autoscrolling)
    }
  }

  private applyDefaultScrollPosition() {
    if (this.defaultScrollPositionApplied || this.itemCount === 0) return false

    let handled = false

    if (this.defaultScrollPosition === 'last-anchor') {
      const content = this.contentElement
      const viewport = this.viewportElement
      const anchor =
        content && viewport
          ? getLastScrollAnchor(
              getMessageScrollerItems(content, this.spacerElement)
            )
          : null

      if (!content || !viewport || !anchor) {
        handled = this.scrollToEnd({ behavior: 'auto' })
      } else {
        const anchorTop = getElementTop(anchor, viewport)
        const contentBottom = getContentBottom({
          content,
          spacer: this.spacerElement,
          viewport,
        })
        const lastTurnFits = contentBottom - anchorTop <= viewport.clientHeight

        handled = lastTurnFits
          ? this.scrollToEnd({ behavior: 'auto' })
          : this.scrollToElement(
              anchor,
              { align: 'start' },
              { keepPreviousPeek: true }
            )
      }
    } else {
      handled =
        this.defaultScrollPosition === 'end'
          ? this.scrollToEnd({ behavior: 'auto' })
          : this.scrollToStart({ behavior: 'auto' })
    }

    if (!handled) return false

    this.defaultScrollPositionApplied = true
    return true
  }

  private setAutoScrolling(autoscrolling: boolean) {
    if (this.autoscrollingTimeout !== null) {
      window.clearTimeout(this.autoscrollingTimeout)
      this.autoscrollingTimeout = null
    }

    if (this.autoscrolling !== autoscrolling) {
      this.autoscrolling = autoscrolling
      this.commitScrollState()
    }

    if (autoscrolling) {
      this.autoscrollingTimeout = window.setTimeout(() => {
        this.autoscrollingTimeout = null
        this.autoscrolling = false
        this.commitScrollState()
      }, autoscrollingClearDelay)
    }
  }

  private setTailSpacerHeight(height: number) {
    const spacer = this.spacerElement
    if (!spacer) return

    const nextHeight = Math.max(0, Math.ceil(height))
    if (this.spacerHeight === nextHeight) return

    this.spacerHeight = nextHeight
    spacer.hidden = nextHeight === 0
    spacer.style.height = `${nextHeight}px`
    spacer.style.marginTop = nextHeight > 0 ? `${-this.spacerGap}px` : ''
  }

  private scrollToPosition(
    scrollTop: number,
    {
      behavior = 'auto',
      autoscrolling = false,
    }: {
      readonly behavior?: ScrollBehavior
      readonly autoscrolling?: boolean
    } = {}
  ) {
    const viewport = this.viewportElement
    if (!viewport) return

    const nextScrollTop = Math.max(0, scrollTop)

    if (Math.abs(viewport.scrollTop - nextScrollTop) <= scrollPositionEpsilon) {
      viewport.scrollTop = nextScrollTop
      this.commitScrollState()
      return
    }

    if (autoscrolling) this.setAutoScrolling(true)

    viewport.scrollTo({ top: nextScrollTop, behavior })
    this.scheduleStateCommit()
  }

  private scrollToStart({
    behavior = 'auto',
  }: MessageScrollerScrollOptions = {}) {
    if (!this.viewportElement) return false

    this.setTailSpacerHeight(0)
    this.streamingTurn = null
    this.mode = 'free-scrolling'
    this.scrollToPosition(0, { behavior })
    return true
  }

  private scrollToEnd({
    behavior = 'auto',
  }: MessageScrollerScrollOptions = {}) {
    const viewport = this.viewportElement
    if (!viewport) return false

    this.setTailSpacerHeight(0)
    this.streamingTurn = null
    this.mode = this.autoScroll ? 'following-bottom' : 'free-scrolling'
    this.scrollToPosition(getMaxScrollTop(viewport), {
      autoscrolling: true,
      behavior,
    })
    return true
  }

  private scrollToElement(
    element: HTMLElement,
    {
      align = 'start',
      behavior = 'auto',
      scrollMargin = this.scrollMargin,
    }: MessageScrollerScrollOptions = {},
    { keepPreviousPeek = false }: { readonly keepPreviousPeek?: boolean } = {}
  ) {
    const content = this.contentElement
    const viewport = this.viewportElement

    if (!content || !viewport || !content.contains(element)) return false

    const scrollTop = getElementScrollTop({
      align,
      element,
      scrollMargin: keepPreviousPeek
        ? scrollMargin + this.scrollPreviousItemPeek
        : scrollMargin,
      spacer: this.spacerElement,
      viewport,
    })
    const nextSpacerHeight = getTailSpacerHeight({
      content,
      scrollTop,
      spacer: this.spacerElement,
      viewport,
    })

    this.setTailSpacerHeight(nextSpacerHeight)
    this.prependRestore = {
      element,
      viewportTop: getElementViewportTop(element, viewport),
    }
    this.mode = keepPreviousPeek ? 'anchored-to-message' : 'settling-jump'
    this.streamingTurn = keepPreviousPeek ? element : null
    this.scrollToPosition(scrollTop, { behavior })

    return true
  }

  private reanchorToAnchoredMessage() {
    const element = this.streamingTurn

    if (
      !element ||
      !element.isConnected ||
      this.mode !== 'anchored-to-message'
    ) {
      return false
    }

    return this.scrollToElement(
      element,
      { align: 'start' },
      { keepPreviousPeek: true }
    )
  }

  private schedulePendingScrollToMessageFlush(messageId: string) {
    if (
      this.pendingScrollToMessage?.messageId !== messageId ||
      this.pendingScrollFrame !== null
    ) {
      return
    }

    this.pendingScrollFrame = window.requestAnimationFrame(() => {
      this.pendingScrollFrame = null
      if (this.flushPendingScrollToMessage()) this.capturePrependAnchor()
    })
  }

  private flushPendingScrollToMessage() {
    const pending = this.pendingScrollToMessage
    if (!pending) return false

    const element = this.messageElements.get(pending.messageId)
    if (!element) return false

    const handled = this.scrollToElement(element, pending.options)
    if (!handled) return false

    this.pendingScrollToMessage = null
    this.defaultScrollPositionApplied = true
    return true
  }

  private capturePrependAnchor() {
    const content = this.contentElement
    const viewport = this.viewportElement

    if (!content || !viewport) {
      this.prependRestore = null
      return
    }

    const anchor = getFirstVisibleMessageItem({
      content,
      spacer: this.spacerElement,
      viewport,
    })

    this.prependRestore = anchor
      ? {
          element: anchor,
          viewportTop: getElementViewportTop(anchor, viewport),
        }
      : null
  }

  private restorePrependedAnchor() {
    const anchor = this.prependRestore
    const viewport = this.viewportElement

    if (!anchor || !viewport || !anchor.element.isConnected) return false

    const nextViewportTop = getElementViewportTop(anchor.element, viewport)
    const delta = nextViewportTop - anchor.viewportTop

    if (Math.abs(delta) <= scrollPositionEpsilon) return false

    viewport.scrollTop += delta
    anchor.viewportTop = getElementViewportTop(anchor.element, viewport)
    this.scheduleStateCommit()

    return true
  }
}

function getMessageScrollerScrollable({
  content,
  scrollEdgeThreshold,
  spacer,
  viewport,
}: {
  readonly content: HTMLElement | null
  readonly scrollEdgeThreshold: number
  readonly spacer: HTMLElement | null
  readonly viewport: HTMLElement | null
}): MessageScrollerScrollable {
  if (!viewport || !content) return emptyScrollable

  const contentBottom = getContentBottom({ content, spacer, viewport })

  return {
    start: viewport.scrollTop > scrollEdgeThreshold,
    end:
      contentBottom - viewport.scrollTop - viewport.clientHeight >
      scrollEdgeThreshold,
  }
}

function getMessageScrollerItems(
  content: HTMLElement,
  spacer: HTMLElement | null
) {
  return Array.from(content.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child !== spacer
  )
}

function getNewScrollAnchor(items: HTMLElement[], previousItemCount: number) {
  for (let index = previousItemCount; index < items.length; index++) {
    const item = items[index]
    if (item?.dataset.scrollAnchor === 'true') return item
  }

  return null
}

function getUnanchoredScrollAnchor(
  items: HTMLElement[],
  handledAnchors: { has(element: HTMLElement): boolean }
) {
  for (const item of items) {
    if (item.dataset.scrollAnchor === 'true' && !handledAnchors.has(item)) {
      return item
    }
  }

  return null
}

function hasMultipleNewScrollAnchors(
  items: HTMLElement[],
  previousItemCount: number
) {
  let count = 0

  for (let index = previousItemCount; index < items.length; index++) {
    const item = items[index]
    if (item?.dataset.scrollAnchor !== 'true') continue

    count += 1
    if (count > 1) return true
  }

  return false
}

function getLastScrollAnchor(items: HTMLElement[]) {
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]
    if (item?.dataset.scrollAnchor === 'true') return item
  }

  return null
}

function getFirstVisibleMessageItem({
  content,
  spacer,
  viewport,
}: {
  readonly content: HTMLElement
  readonly spacer: HTMLElement | null
  readonly viewport: HTMLElement
}) {
  const viewportRect = viewport.getBoundingClientRect()

  for (const item of getMessageScrollerItems(content, spacer)) {
    if (!item.dataset.messageId) continue

    const rect = item.getBoundingClientRect()
    if (rect.bottom > viewportRect.top && rect.top < viewportRect.bottom) {
      return item
    }
  }

  return null
}

function getElementScrollTop({
  align,
  element,
  scrollMargin,
  spacer,
  viewport,
}: {
  readonly align: 'start' | 'center' | 'end' | 'nearest'
  readonly element: HTMLElement
  readonly scrollMargin: number
  readonly spacer: HTMLElement | null
  readonly viewport: HTMLElement
}) {
  const elementTop = getElementTop(element, viewport)
  const elementHeight = element.getBoundingClientRect().height
  const contentPadding = getContentBlockPadding(spacer)

  if (align === 'center') {
    const insetHeight = Math.max(
      0,
      viewport.clientHeight - contentPadding.start - contentPadding.end
    )

    return (
      elementTop -
      contentPadding.start -
      (insetHeight - elementHeight) / 2 -
      scrollMargin
    )
  }

  if (align === 'end') {
    return (
      elementTop -
      viewport.clientHeight +
      elementHeight +
      contentPadding.end +
      scrollMargin
    )
  }

  if (align === 'nearest') {
    const elementBottom = elementTop + elementHeight
    const viewportTop = viewport.scrollTop + contentPadding.start
    const viewportBottom =
      viewport.scrollTop + viewport.clientHeight - contentPadding.end

    if (elementTop >= viewportTop && elementBottom <= viewportBottom) {
      return viewport.scrollTop
    }

    if (elementTop < viewportTop) {
      return elementTop - contentPadding.start - scrollMargin
    }

    return (
      elementBottom - viewport.clientHeight + contentPadding.end + scrollMargin
    )
  }

  return elementTop - contentPadding.start - scrollMargin
}

function getElementTop(element: HTMLElement, viewport: HTMLElement) {
  const elementRect = element.getBoundingClientRect()
  const viewportRect = viewport.getBoundingClientRect()

  return elementRect.top - viewportRect.top + viewport.scrollTop
}

function getElementViewportTop(element: HTMLElement, viewport: HTMLElement) {
  return (
    element.getBoundingClientRect().top - viewport.getBoundingClientRect().top
  )
}

function getTailSpacerHeight({
  content,
  scrollTop,
  spacer,
  viewport,
}: {
  readonly content: HTMLElement
  readonly scrollTop: number
  readonly spacer: HTMLElement | null
  readonly viewport: HTMLElement
}) {
  const contentBottom = getContentBottom({ content, spacer, viewport })
  return scrollTop + viewport.clientHeight - contentBottom
}

function getContentBottom({
  content,
  spacer,
  viewport,
}: {
  readonly content: HTMLElement
  readonly spacer: HTMLElement | null
  readonly viewport: HTMLElement
}) {
  const items = getMessageScrollerItems(content, spacer)
  const padding = getBlockPadding(content)
  const viewportRect = viewport.getBoundingClientRect()
  const scrollTop = viewport.scrollTop
  let contentBottom = padding.start + padding.end

  for (const item of items) {
    const rect = item.getBoundingClientRect()

    contentBottom = Math.max(
      contentBottom,
      rect.bottom - viewportRect.top + scrollTop + padding.end
    )
  }

  return contentBottom
}

function getMaxScrollTop(viewport: HTMLElement) {
  return Math.max(0, viewport.scrollHeight - viewport.clientHeight)
}

function getBlockPadding(element: HTMLElement) {
  const style = window.getComputedStyle(element)

  return {
    end: readCssPixel(style.paddingBlockEnd || style.paddingBottom),
    start: readCssPixel(style.paddingBlockStart || style.paddingTop),
  }
}

function getContentBlockPadding(spacer: HTMLElement | null) {
  const content = spacer?.parentElement
  return content ? getBlockPadding(content) : { end: 0, start: 0 }
}

function getFlexGap(element: HTMLElement | null) {
  if (!element) return 0

  const style = window.getComputedStyle(element)
  const gap = style.rowGap === 'normal' ? style.gap : style.rowGap

  return readCssPixel(gap)
}

function readCssPixel(value: string | undefined) {
  if (!value) return 0

  const number = Number.parseFloat(value)
  return Number.isFinite(number) ? number : 0
}

export { MessageScrollerController }
