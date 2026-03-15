import type { Fiber } from 'effect'
import { subscribe } from './event-bus.ts'

const running = new Map<string, Fiber.RuntimeFiber<void, never> | null>()

subscribe((event) => {
  if (event._tag === 'RunEnd') {
    running.delete(event.sessionId)
  }
})

export function claimRun(sessionId: string): boolean {
  if (running.has(sessionId)) return false
  running.set(sessionId, null)
  return true
}

export function registerFiber(
  sessionId: string,
  fiber: Fiber.RuntimeFiber<void, never>
): void {
  if (!running.has(sessionId)) {
    throw new Error(`Cannot register fiber for unclaimed session ${sessionId}`)
  }

  running.set(sessionId, fiber)
}

export function releaseRun(sessionId: string): void {
  running.delete(sessionId)
}

export function getFiber(
  sessionId: string
): Fiber.RuntimeFiber<void, never> | undefined {
  return running.get(sessionId) ?? undefined
}

export function isRunning(sessionId: string): boolean {
  return running.has(sessionId)
}

export function getRunningSessionIds(): ReadonlySet<string> {
  return new Set(running.keys())
}

export function resetRunRegistry(): void {
  running.clear()
}
