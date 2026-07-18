import { Cause, Effect, Exit, Fiber, Stream } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { serverEvents, SseDecodeError } from './sse.js'

type EventListener = (event: MessageEvent) => void

class FakeEventSource {
  static readonly pending: Array<(source: FakeEventSource) => void> = []
  static readonly sources: Array<FakeEventSource> = []

  readonly listeners = new Map<string, Array<EventListener>>()
  onerror: (() => void) | null = null
  closed = false

  constructor(readonly url: string) {
    const resolve = FakeEventSource.pending.shift()
    if (resolve) resolve(this)
    else FakeEventSource.sources.push(this)
  }

  static next(): Promise<FakeEventSource> {
    const source = FakeEventSource.sources.shift()
    if (source) return Promise.resolve(source)
    return new Promise((resolve) => FakeEventSource.pending.push(resolve))
  }

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  emit(type: string, data: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new MessageEvent(type, { data }))
    }
  }

  failConnection(): void {
    this.onerror?.()
  }

  close(): void {
    this.closed = true
  }
}

describe('serverEvents', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    FakeEventSource.pending.length = 0
    FakeEventSource.sources.length = 0
  })

  it('keeps event decode failures visible instead of reconnecting', async () => {
    vi.stubGlobal('EventSource', FakeEventSource)

    const result = Effect.runPromiseExit(
      serverEvents('http://localhost:3000').pipe(Stream.runDrain)
    )
    const source = await FakeEventSource.next()

    source.emit('TextDelta', '{}')

    const exit = await result
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isSuccess(exit)) return
    expect(Cause.squash(exit.cause)).toBeInstanceOf(SseDecodeError)
    expect(source.closed).toBe(true)
    expect(FakeEventSource.sources).toHaveLength(0)
  })

  it('reconnects after connection failures', async () => {
    vi.stubGlobal('EventSource', FakeEventSource)

    const fiber = Effect.runFork(
      serverEvents('http://localhost:3000').pipe(Stream.runDrain)
    )
    const firstSource = await FakeEventSource.next()
    const nextSource = FakeEventSource.next()

    firstSource.failConnection()

    const secondSource = await nextSource
    expect(firstSource.closed).toBe(true)
    expect(secondSource.url).toBe('http://localhost:3000/events')

    await Effect.runPromise(Fiber.interrupt(fiber))
    expect(secondSource.closed).toBe(true)
  })
})
