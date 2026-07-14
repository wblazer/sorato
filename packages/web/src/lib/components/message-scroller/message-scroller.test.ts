// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageScrollerController } from './message-scroller.svelte.js'

type ObserverCallback = () => void

class ResizeObserverMock implements ResizeObserver {
  static readonly callbacks = new Map<Element, Set<ObserverCallback>>()

  readonly callback: ResizeObserverCallback
  readonly elements = new Set<Element>()

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
  }

  observe(target: Element) {
    this.elements.add(target)
    const callbacks = ResizeObserverMock.callbacks.get(target) ?? new Set()
    callbacks.add(() => this.callback([], this))
    ResizeObserverMock.callbacks.set(target, callbacks)
  }

  unobserve(target: Element) {
    this.elements.delete(target)
  }

  disconnect() {
    for (const element of this.elements) {
      ResizeObserverMock.callbacks.delete(element)
    }
    this.elements.clear()
  }

  static trigger(target: Element) {
    for (const callback of this.callbacks.get(target) ?? []) callback()
  }
}

class MutationObserverMock implements MutationObserver {
  static readonly callbacks = new Map<Node, ObserverCallback>()

  readonly callback: MutationCallback
  target: Node | null = null

  constructor(callback: MutationCallback) {
    this.callback = callback
  }

  observe(target: Node) {
    this.target = target
    MutationObserverMock.callbacks.set(target, () => this.callback([], this))
  }

  disconnect() {
    if (this.target) MutationObserverMock.callbacks.delete(this.target)
    this.target = null
  }

  takeRecords() {
    return []
  }

  static trigger(target: Node) {
    this.callbacks.get(target)?.()
  }
}

type TestMessage = {
  readonly height: number
  readonly id: string
  readonly scrollAnchor?: boolean
}

function createTestScroller(messages: ReadonlyArray<TestMessage>) {
  const frames = new Map<number, FrameRequestCallback>()
  let nextFrame = 1

  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextFrame++
    frames.set(id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))

  const flushFrames = () => {
    while (frames.size > 0) {
      const pending = [...frames.entries()]
      frames.clear()
      for (const [, callback] of pending) callback(performance.now())
    }
  }

  const controller = new MessageScrollerController({
    autoScroll: true,
    defaultScrollPosition: 'end',
  })
  const root = document.createElement('div')
  const viewport = document.createElement('div')
  const content = document.createElement('div')
  const spacer = document.createElement('div')
  const bindings: Array<{ destroy: () => void }> = []

  root.append(viewport)
  viewport.append(content)
  document.body.append(root)

  Object.defineProperties(viewport, {
    clientHeight: { value: 100 },
    scrollHeight: {
      get: () =>
        [...content.children].reduce(
          (height, element) =>
            height +
            (element === spacer
              ? Number.parseFloat(spacer.style.height) || 0
              : Number(element.getAttribute('data-test-height'))),
          0
        ),
    },
  })
  viewport.getBoundingClientRect = () => new DOMRect(0, 0, 100, 100)
  viewport.scrollTo = (optionsOrX?: number | ScrollToOptions, y?: number) => {
    const top =
      typeof optionsOrX === 'number'
        ? (y ?? viewport.scrollTop)
        : (optionsOrX?.top ?? viewport.scrollTop)
    viewport.scrollTop = Math.min(
      Number(top),
      Math.max(0, viewport.scrollHeight - viewport.clientHeight)
    )
  }

  const addMessage = (message: TestMessage) => {
    const element = document.createElement('div')
    element.setAttribute('data-test-height', String(message.height))
    element.getBoundingClientRect = () => {
      let top = 0
      for (const sibling of content.children) {
        if (sibling === element) break
        if (sibling !== spacer) {
          top += Number(sibling.getAttribute('data-test-height'))
        }
      }

      const height = Number(element.getAttribute('data-test-height'))
      return new DOMRect(0, top - viewport.scrollTop, 100, height)
    }
    content.insertBefore(element, spacer)
    bindings.push(
      controller.item(element, {
        messageId: message.id,
        scrollAnchor: message.scrollAnchor,
      })
    )
    return element
  }

  content.append(spacer)
  for (const message of messages) addMessage(message)

  bindings.push(controller.root(root), controller.viewport(viewport))
  bindings.push(controller.spacer(spacer), controller.content(content))
  flushFrames()

  return {
    addMessage(message: TestMessage) {
      const element = addMessage(message)
      MutationObserverMock.trigger(content)
      return element
    },
    content,
    controller,
    flushFrames,
    message(id: string) {
      const element = content.querySelector(`[data-message-id="${id}"]`)
      if (!(element instanceof HTMLElement)) throw new Error(`Missing ${id}`)
      return element
    },
    resizeContent() {
      ResizeObserverMock.trigger(content)
      flushFrames()
    },
    spacer,
    viewport,
    destroy() {
      for (const binding of bindings.toReversed()) binding.destroy()
      controller.destroy()
    },
  }
}

describe('MessageScrollerController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    vi.stubGlobal('MutationObserver', MutationObserverMock)
  })

  afterEach(() => {
    ResizeObserverMock.callbacks.clear()
    MutationObserverMock.callbacks.clear()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.replaceChildren()
  })

  it('keeps following when growth is observed before resize catches up', () => {
    const rendered = createTestScroller([
      { id: 'message-1', height: 80 },
      { id: 'message-2', height: 80 },
      { id: 'message-3', height: 80 },
    ])

    expect(rendered.viewport.scrollTop).toBe(140)
    vi.advanceTimersByTime(300)

    rendered.message('message-3').setAttribute('data-test-height', '160')
    rendered.viewport.dispatchEvent(new Event('scroll'))

    expect(rendered.controller.canScrollToEnd).toBe(false)

    rendered.resizeContent()

    expect(rendered.viewport.scrollTop).toBe(220)
    expect(rendered.controller.canScrollToEnd).toBe(false)
    rendered.destroy()
  })

  it('resumes following after one jump to latest', () => {
    const rendered = createTestScroller([
      { id: 'message-1', height: 80 },
      { id: 'message-2', height: 80 },
      { id: 'message-3', height: 80 },
    ])

    vi.advanceTimersByTime(300)
    rendered.viewport.dispatchEvent(new WheelEvent('wheel'))
    rendered.viewport.scrollTop = 60
    rendered.viewport.dispatchEvent(new Event('scroll'))

    expect(rendered.controller.canScrollToEnd).toBe(true)

    rendered.controller.jumpToEnd('auto')

    expect(rendered.viewport.scrollTop).toBe(140)
    expect(rendered.controller.canScrollToEnd).toBe(false)

    rendered.message('message-3').setAttribute('data-test-height', '160')
    rendered.resizeContent()

    expect(rendered.viewport.scrollTop).toBe(220)
    expect(rendered.controller.canScrollToEnd).toBe(false)
    rendered.destroy()
  })

  it('holds a new turn at the reading line, then follows once its spacer is consumed', () => {
    const rendered = createTestScroller([
      { id: 'message-1', height: 80 },
      { id: 'message-2', height: 80 },
      { id: 'message-3', height: 80 },
    ])
    const anchor = rendered.addMessage({
      id: 'message-4',
      height: 20,
      scrollAnchor: true,
    })

    expect(rendered.viewport.scrollTop).toBe(176)
    expect(anchor.getBoundingClientRect().top).toBe(64)
    expect(rendered.spacer.style.height).toBe('16px')

    const reply = rendered.addMessage({ id: 'message-5', height: 8 })
    rendered.resizeContent()

    expect(rendered.viewport.scrollTop).toBe(176)
    expect(anchor.getBoundingClientRect().top).toBe(64)
    expect(rendered.spacer.style.height).toBe('8px')

    reply.setAttribute('data-test-height', '60')
    rendered.resizeContent()

    expect(rendered.spacer.style.height).toBe('0px')
    expect(rendered.viewport.scrollTop).toBe(220)
    expect(rendered.controller.canScrollToEnd).toBe(false)

    reply.setAttribute('data-test-height', '100')
    rendered.resizeContent()

    expect(rendered.viewport.scrollTop).toBe(260)
    expect(rendered.controller.canScrollToEnd).toBe(false)
    rendered.destroy()
  })
})
