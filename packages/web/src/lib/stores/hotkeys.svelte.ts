/**
 * Hotkey store — global keyboard shortcut management.
 *
 * Thin Svelte wrapper around @tanstack/hotkeys' HotkeyManager singleton.
 * Provides scope-aware hotkey registration so overlays (command palette,
 * dialogs) can suppress base-layer hotkeys without manual plumbing.
 *
 * Scopes:
 *   - 'app' — base layer (sidebar, conversation, composer). Always active
 *     unless an overlay scope is active.
 *   - overlay scopes (e.g. 'command-palette') — pushed/popped as overlays
 *     open/close. When any overlay is active, 'app'-scoped hotkeys are
 *     disabled.
 *
 * This establishes the pattern for Linear-style chained hotkeys later —
 * the scope system can expand to support focus-based contexts without
 * rewriting existing registrations.
 */
import {
  getHotkeyManager,
  type Hotkey,
  type HotkeyCallback,
  type HotkeyOptions,
  type HotkeyRegistrationHandle,
} from '@tanstack/hotkeys'

// ---------------------------------------------------------------------------
// Scope management
// ---------------------------------------------------------------------------

/** Active overlay scopes. When non-empty, 'app' hotkeys are suppressed. */
let overlayStack = $state<string[]>([])

const hasOverlay = $derived(overlayStack.length > 0)

/** Push an overlay scope (e.g. when command palette opens). */
function pushScope(scope: string) {
  overlayStack = [...overlayStack, scope]
}

/** Pop the most recent overlay scope (e.g. when command palette closes). */
function popScope(scope: string) {
  const idx = overlayStack.lastIndexOf(scope)
  if (idx !== -1) {
    overlayStack = [
      ...overlayStack.slice(0, idx),
      ...overlayStack.slice(idx + 1),
    ]
  }
}

// ---------------------------------------------------------------------------
// Registration — wraps HotkeyManager with scope awareness
// ---------------------------------------------------------------------------

interface ScopedHotkeyOptions extends Omit<HotkeyOptions, 'enabled'> {
  /**
   * Scope this hotkey belongs to. Defaults to 'app'.
   * 'app'-scoped hotkeys are disabled when an overlay is active.
   */
  scope?: 'app' | string
  /**
   * Additional enabled condition. The hotkey is active only when BOTH
   * this returns true AND scope rules allow it.
   */
  enabled?: () => boolean
}

/** Tracked registrations so we can update `enabled` reactively. */
const tracked = new Map<
  string,
  {
    handle: HotkeyRegistrationHandle
    scope: string
    userEnabled: () => boolean
  }
>()

/**
 * Register a hotkey with scope awareness.
 *
 * Returns an unregister function. Call it to clean up (e.g. in Svelte's
 * `onDestroy` or `$effect` return).
 */
function register(
  hotkey: Hotkey,
  callback: HotkeyCallback,
  options: ScopedHotkeyOptions = {}
): () => void {
  const { scope = 'app', enabled: userEnabled = () => true, ...rest } = options
  const manager = getHotkeyManager()

  const handle = manager.register(hotkey, callback, {
    ...rest,
    // Initial enabled state — will be reactively updated
    enabled: scope === 'app' ? !hasOverlay && userEnabled() : userEnabled(),
  })

  tracked.set(handle.id, { handle, scope, userEnabled })

  return () => {
    tracked.delete(handle.id)
    handle.unregister()
  }
}

// ---------------------------------------------------------------------------
// Reactive sync — update enabled state when overlay stack changes
// ---------------------------------------------------------------------------

/**
 * Call this from a root-level `$effect` to keep hotkey enabled states
 * in sync with the overlay stack. Must be called once from the layout.
 */
function syncScopes() {
  // Touch reactive dependency
  const overlay = hasOverlay

  for (const [, { handle, scope, userEnabled }] of tracked) {
    const shouldBeEnabled =
      scope === 'app' ? !overlay && userEnabled() : userEnabled()
    handle.setOptions({ enabled: shouldBeEnabled })
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const hotkeyStore = {
  register,
  pushScope,
  popScope,
  syncScopes,
  get hasOverlay() {
    return hasOverlay
  },
}
