import { tick } from 'svelte'

const bottomThreshold = 8

export class SessionScrollController {
  messagesContainer: HTMLElement | null = $state(null)
  messagesContent: HTMLDivElement | undefined = $state()
  isAtBottom = $state(true)

  private shouldAutoScroll = $state(true)
  private autoScrollTop: number | undefined
  private resizeObserver: ResizeObserver | undefined

  constructor(private readonly trackChanges: () => void) {
    $effect(() => {
      if (!this.messagesContent || typeof ResizeObserver === 'undefined') return

      this.resizeObserver?.disconnect()
      this.resizeObserver = new ResizeObserver(() => {
        requestAnimationFrame(() => {
          if (this.shouldAutoScroll) this.scrollToBottom()
          this.updateScrollState()
        })
      })
      this.resizeObserver.observe(this.messagesContent)

      return () => {
        this.resizeObserver?.disconnect()
        this.resizeObserver = undefined
      }
    })

    $effect(() => {
      this.trackChanges()
      this.scrollToLatestAfterRender({ preserveUserPosition: true })
    })
  }

  handleScroll = () => {
    this.updateScrollState()

    if (this.isAtBottom) {
      this.shouldAutoScroll = true
      this.autoScrollTop = undefined
      return
    }

    if (
      this.shouldAutoScroll &&
      this.autoScrollTop !== undefined &&
      this.messagesContainer &&
      Math.abs(this.messagesContainer.scrollTop - this.autoScrollTop) < 2
    ) {
      return
    }

    this.shouldAutoScroll = this.isAtBottom
  }

  handleWheel = (event: WheelEvent) => {
    if (event.deltaY >= 0) return
    this.shouldAutoScroll = false
    this.autoScrollTop = undefined
  }

  jumpToLatest = () => {
    this.shouldAutoScroll = true
    this.scrollToBottom()
  }

  scrollToLatestAfterRender(options?: {
    readonly preserveUserPosition?: boolean
  }) {
    if (!options?.preserveUserPosition) this.shouldAutoScroll = true

    tick().then(() =>
      requestAnimationFrame(() => {
        if (!options?.preserveUserPosition || this.shouldAutoScroll) {
          this.scrollToBottom()
        }
        this.updateScrollState()
      })
    )
  }

  private scrollToBottom() {
    if (!this.messagesContainer) return
    this.autoScrollTop = Math.max(
      0,
      this.messagesContainer.scrollHeight - this.messagesContainer.clientHeight
    )
    this.messagesContainer.scrollTo({
      top: this.messagesContainer.scrollHeight,
    })
    this.isAtBottom = true
    this.updateScrollState()
  }

  private updateScrollState() {
    if (!this.messagesContainer) return

    const distanceFromBottom =
      this.messagesContainer.scrollHeight -
      this.messagesContainer.scrollTop -
      this.messagesContainer.clientHeight

    this.isAtBottom = distanceFromBottom <= bottomThreshold
  }
}
