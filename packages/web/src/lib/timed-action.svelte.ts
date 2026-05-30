export type TimedActionState = 'idle' | 'pending' | 'success'

export interface TimedActionOptions {
  readonly run: () => Promise<void> | void
  readonly successFor?: number
}

export interface TimedAction {
  readonly state: TimedActionState
  readonly pending: boolean
  readonly run: () => Promise<void>
  readonly reset: () => void
}

export const createTimedAction = ({
  run: runAction,
  successFor = 1400,
}: TimedActionOptions): TimedAction => {
  let state = $state<TimedActionState>('idle')
  let timeout: ReturnType<typeof setTimeout> | undefined

  const clearSuccessTimeout = () => {
    if (timeout === undefined) return
    clearTimeout(timeout)
    timeout = undefined
  }

  const reset = () => {
    clearSuccessTimeout()
    state = 'idle'
  }

  const run = async () => {
    if (state === 'pending') return
    clearSuccessTimeout()
    state = 'pending'
    try {
      await runAction()
      state = 'success'
      timeout = setTimeout(() => {
        state = 'idle'
        timeout = undefined
      }, successFor)
    } catch (cause) {
      state = 'idle'
      throw cause
    }
  }

  return {
    get state() {
      return state
    },
    get pending() {
      return state === 'pending'
    },
    run,
    reset,
  }
}
