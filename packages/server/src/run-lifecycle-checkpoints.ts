import { Deferred, Effect, Ref } from 'effect'

export type RunLifecycleCheckpointName =
  | 'afterQueueShiftBeforeActiveRegister'
  | 'afterAgentPreambleAppended'

export interface RunLifecycleCheckpoint {
  readonly name: RunLifecycleCheckpointName
  readonly runId: string
}

interface Gate {
  readonly reached: Deferred.Deferred<void>
  readonly release: Deferred.Deferred<void>
}

interface ControllerState {
  readonly gates: Map<string, Gate>
  readonly enabled: Set<string>
  readonly reached: Ref.Ref<ReadonlyArray<RunLifecycleCheckpoint>>
}

let controllerState: ControllerState | null = null

const gateKey = (name: RunLifecycleCheckpointName, runId: string) =>
  `${name}:${runId}`

const getGate = (
  state: ControllerState,
  name: RunLifecycleCheckpointName,
  runId: string
) =>
  Effect.gen(function* () {
    const key = gateKey(name, runId)
    const existing = state.gates.get(key)
    if (existing) return existing

    const reached = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const gate = { reached, release }
    state.gates.set(key, gate)
    return gate
  })

export const runLifecycleCheckpoint = (
  name: RunLifecycleCheckpointName,
  runId: string
) =>
  Effect.gen(function* () {
    const state = controllerState
    if (state === null || !state.enabled.has(gateKey(name, runId))) return

    const gate = yield* getGate(state, name, runId)
    yield* Ref.update(state.reached, (checkpoints) => [
      ...checkpoints,
      { name, runId },
    ])
    yield* Deferred.succeed(gate.reached, undefined)
    yield* Deferred.await(gate.release)
  })

export const installRunLifecycleCheckpointController = Effect.gen(function* () {
  const previous = controllerState
  const reached = yield* Ref.make<ReadonlyArray<RunLifecycleCheckpoint>>([])
  const state: ControllerState = {
    gates: new Map(),
    enabled: new Set(),
    reached,
  }
  controllerState = state

  return {
    waitFor: (name: RunLifecycleCheckpointName, runId: string) =>
      Effect.sync(() => {
        state.enabled.add(gateKey(name, runId))
      }).pipe(
        Effect.andThen(getGate(state, name, runId)),
        Effect.flatMap((gate) => Deferred.await(gate.reached))
      ),
    release: (name: RunLifecycleCheckpointName, runId: string) =>
      getGate(state, name, runId).pipe(
        Effect.flatMap((gate) => Deferred.succeed(gate.release, undefined)),
        Effect.asVoid
      ),
    reached: Ref.get(reached),
    reset: Effect.sync(() => {
      if (controllerState === state) controllerState = previous
    }),
  }
})
