import { Match } from "effect";
import type { Fiber } from "effect";

interface SessionRunState {
  workerFiber: Fiber.Fiber<void, never> | null;
  activeRunFiber: Fiber.Fiber<void, never> | null;
  queuedInputs: Array<string>;
  stopRequested: boolean;
}

const running = new Map<string, SessionRunState>();

const missingSessionState = (kind: string, sessionId: string): never => {
  throw new Error(`Cannot register ${kind} for unknown session ${sessionId}`);
};

const startRunState = (sessionId: string, input: string) => {
  running.set(sessionId, {
    workerFiber: null,
    activeRunFiber: null,
    queuedInputs: [input],
    stopRequested: false,
  });

  return "started" as const;
};

const queueRunState = (state: SessionRunState, input: string) => {
  state.queuedInputs.push(input);
  return "queued" as const;
};

export function enqueueRun(
  sessionId: string,
  input: string,
): "started" | "queued" {
  const state = running.get(sessionId);
  return Match.value(state).pipe(
    Match.when(undefined, () => startRunState(sessionId, input)),
    Match.orElse((state) => queueRunState(state, input)),
  );
}

export function registerWorkerFiber(
  sessionId: string,
  fiber: Fiber.Fiber<void, never>,
): void {
  const state =
    running.get(sessionId) ?? missingSessionState("worker", sessionId);
  state.workerFiber = fiber;
}

export function registerActiveFiber(
  sessionId: string,
  fiber: Fiber.Fiber<void, never>,
): void {
  const state =
    running.get(sessionId) ?? missingSessionState("active run", sessionId);
  state.activeRunFiber = fiber;
}

export function clearActiveFiber(sessionId: string): void {
  const state = running.get(sessionId);
  if (!state) return;
  state.activeRunFiber = null;
}

export function shiftQueuedRun(sessionId: string): string | undefined {
  return running.get(sessionId)?.queuedInputs.shift();
}

export function requestStop(sessionId: string): void {
  const state = running.get(sessionId);
  if (!state) return;
  state.stopRequested = true;
}

export function shouldStop(sessionId: string): boolean {
  return running.get(sessionId)?.stopRequested ?? false;
}

export function drainQueuedRuns(sessionId: string): Array<string> {
  const state = running.get(sessionId);
  if (!state) return [];

  const queued = [...state.queuedInputs];
  state.queuedInputs = [];
  return queued;
}

export function releaseRun(sessionId: string): void {
  running.delete(sessionId);
}

export function getFiber(
  sessionId: string,
): Fiber.Fiber<void, never> | undefined {
  return running.get(sessionId)?.activeRunFiber ?? undefined;
}

export function isRunning(sessionId: string): boolean {
  return running.has(sessionId);
}

export function getQueuedRunCount(sessionId: string): number {
  return running.get(sessionId)?.queuedInputs.length ?? 0;
}

export function getRunningSessionIds(): ReadonlySet<string> {
  return new Set(running.keys());
}

export function resetRunRegistry(): void {
  running.clear();
}
