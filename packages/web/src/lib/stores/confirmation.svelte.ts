import type { ButtonVariant } from '$lib/components/ui/button/index.js'

export interface ConfirmationActionContext {
  close: () => void
  setError: (error: string | null) => void
  setPending: (pending: boolean) => void
}

export interface ConfirmationAction {
  label: string | ((pending: boolean) => string)
  run: (context: ConfirmationActionContext) => void
  variant?: ButtonVariant
}

interface ConfirmationState {
  open: boolean
  title: string
  description: string
  cancelLabel: string
  action: ConfirmationAction | null
  onCancel?: () => void
  actionError: string | null
  actionPending: boolean
}

interface ConfirmationOptions {
  title: string
  description: string
  cancelLabel?: string
  action: ConfirmationAction
  onCancel?: () => void
}

const defaultState: ConfirmationState = {
  open: false,
  title: '',
  description: '',
  cancelLabel: 'Cancel',
  action: null,
  onCancel: undefined,
  actionError: null,
  actionPending: false,
}

function createConfirmationStore() {
  let state = $state<ConfirmationState>({ ...defaultState })

  function openConfirmation(data: ConfirmationOptions) {
    state = {
      open: true,
      title: data.title,
      description: data.description,
      cancelLabel: data.cancelLabel ?? 'Cancel',
      action: data.action,
      onCancel: data.onCancel,
      actionError: null,
      actionPending: false,
    }
  }

  function closeConfirmation() {
    state = { ...state, open: false }
  }

  function resetConfirmation() {
    state = { ...defaultState }
  }

  function setActionError(error: string | null) {
    state = { ...state, actionError: error }
  }

  function setActionPending(pending: boolean) {
    if (!state.open && !pending) return
    state = { ...state, actionPending: pending }
  }

  return {
    get state() {
      return state
    },
    openConfirmation,
    closeConfirmation,
    resetConfirmation,
    setActionError,
    setActionPending,
  }
}

export const confirmationStore = createConfirmationStore()
