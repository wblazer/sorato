import type { Hotkey } from '@tanstack/hotkeys'
import { hotkeyStore } from './hotkeys.svelte.js'

export type ActionId =
  | 'app.command-palette'
  | 'app.toggle-tool-output-display-mode'
  | 'connection.add'
  | 'directory.open'
  | 'provider.connect'
  | 'session.new'

export type ActionContext = 'global' | string
export type ActionPaletteVisibility = 'auto' | 'never'

export interface ActionDefinition {
  id: ActionId
  title: string
  category: string
  description?: string
  keywords?: string[]
  contexts?: ActionContext[]
  palette?: ActionPaletteVisibility
  defaultShortcut?: Hotkey
  shortcutScope?: 'app' | string
  enabled?: () => boolean
  run: () => void
}

export interface ActionRegistration extends ActionDefinition {
  contexts: ActionContext[]
  palette: ActionPaletteVisibility
}

function createActionStore() {
  let actions = $state<ActionRegistration[]>([])
  let activeContexts = $state<ActionContext[]>(['global'])

  function isInContext(action: ActionRegistration): boolean {
    return action.contexts.some(
      (context) => context === 'global' || activeContexts.includes(context)
    )
  }

  function isEnabled(action: ActionRegistration): boolean {
    return action.enabled?.() ?? true
  }

  function isAvailable(action: ActionRegistration): boolean {
    return isInContext(action) && isEnabled(action)
  }

  const availableActions = $derived.by(() => actions.filter(isAvailable))

  const paletteActions = $derived.by(() =>
    availableActions.filter((action) => action.palette !== 'never')
  )

  function register(definition: ActionDefinition): () => void {
    const action: ActionRegistration = {
      ...definition,
      contexts: definition.contexts ?? ['global'],
      palette: definition.palette ?? 'auto',
    }

    actions = [action, ...actions.filter((item) => item.id !== action.id)]

    const unregisterHotkey = action.defaultShortcut
      ? hotkeyStore.register(
          action.defaultShortcut,
          () => {
            trigger(action.id)
          },
          {
            scope: action.shortcutScope ?? 'app',
            enabled: () => isAvailable(action),
          }
        )
      : () => {}

    return () => {
      actions = actions.filter((item) => item !== action)
      unregisterHotkey()
    }
  }

  function trigger(id: ActionId): boolean {
    const action = actions.find((item) => item.id === id)
    if (!action || !isAvailable(action)) return false
    action.run()
    return true
  }

  function pushContext(context: ActionContext) {
    if (context === 'global') return
    activeContexts = [...activeContexts, context]
  }

  function popContext(context: ActionContext) {
    const index = activeContexts.lastIndexOf(context)
    if (index === -1) return
    activeContexts = [
      ...activeContexts.slice(0, index),
      ...activeContexts.slice(index + 1),
    ]
  }

  return {
    get actions() {
      return actions
    },
    get availableActions() {
      return availableActions
    },
    get paletteActions() {
      return paletteActions
    },
    get activeContexts() {
      return activeContexts
    },
    register,
    trigger,
    pushContext,
    popContext,
  }
}

export const actionStore = createActionStore()
