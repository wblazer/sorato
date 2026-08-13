<script lang="ts">
  import { AuthApi } from '$lib/connection-services.js'
  import { runConnectionPromise } from '$lib/connection-runtime.js'
  import { requestErrorMessage } from '$lib/api-errors.js'
  import { Button } from '$lib/components/ui/button/index.js'
  import * as Command from '$lib/components/ui/command/index.js'
  import * as Dialog from '$lib/components/ui/dialog/index.js'
  import { Input } from '$lib/components/ui/input/index.js'
  import * as Item from '$lib/components/ui/item/index.js'
  import { Label } from '$lib/components/ui/label/index.js'
  import { authStore } from '$lib/stores/auth.svelte.js'
  import { modelsStore } from '$lib/stores/models.svelte.js'
  import { useId } from 'bits-ui'
  import { Effect, Schedule } from 'effect'
  import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircleIcon'

  interface Props {
    open: boolean
  }

  let { open = $bindable(false) }: Props = $props()

  const providers = [
    {
      id: 'openai',
      name: 'OpenAI',
    },
    {
      id: 'anthropic',
      name: 'Anthropic',
    },
  ] as const

  let provider = $state<(typeof providers)[number] | null>(null)
  let key = $state('')
  let saving = $state(false)
  let oauthState = $state<'idle' | 'starting' | 'waiting'>('idle')
  let error = $state<string | null>(null)
  const keyInputId = useId()
  const oauthBusy = $derived(oauthState !== 'idle')
  const oauthLabel = $derived(
    oauthState === 'starting'
      ? 'Opening browser...'
      : oauthState === 'waiting'
        ? 'Waiting for sign-in...'
        : 'Sign in with ChatGPT',
  )

  function effectErrorMessage(cause: unknown, context: string): string {
    if (
      typeof cause === 'object' &&
      cause !== null &&
      'message' in cause &&
      typeof cause.message === 'string'
    ) {
      return cause.message
    }
    return requestErrorMessage(cause, context)
  }

  $effect(() => {
    if (!open) return
    provider = null
    key = ''
    error = null
  })

  async function submit() {
    const providerId = provider?.id
    const apiKey = key.trim()
    if (!providerId || !apiKey || saving) return

    saving = true
    error = null
    try {
      const connectProvider = Effect.gen(function* () {
        const authApi = yield* AuthApi
        yield* authApi.set(providerId, apiKey)
        yield* authStore.load()
        if (modelsStore.projectId)
          yield* modelsStore.load(modelsStore.projectId)
      })

      await runConnectionPromise(connectProvider)
      open = false
    } catch (cause) {
      error = effectErrorMessage(cause, 'Failed to connect provider')
    } finally {
      saving = false
    }
  }

  async function signInWithChatGpt() {
    if (provider?.id !== 'openai' || oauthBusy) return

    const desktop = window.soratoDesktop
    let authWindow: Window | null = null
    oauthState = 'starting'
    error = null
    try {
      if (!desktop) {
        authWindow = window.open('about:blank', '_blank')
        if (!authWindow) {
          throw new Error(
            'The browser blocked the ChatGPT sign-in window. Allow pop-ups for Sorato and try again.',
          )
        }
        authWindow.opener = null
      }

      const authorize = Effect.gen(function* () {
        const authApi = yield* AuthApi
        return yield* authApi.oauthAuthorize('openai')
      }).pipe(
        Effect.timeoutOrElse({
          duration: '10 seconds',
          orElse: () =>
            Effect.fail(
              new Error(
                'The Sorato server did not start ChatGPT sign-in within 10 seconds.',
              ),
            ),
        }),
      )

      const result = await runConnectionPromise(authorize)
      if (desktop) {
        await desktop.openExternal(result.url)
      } else if (authWindow && !authWindow.closed) {
        authWindow.location.replace(result.url)
      } else {
        throw new Error(
          'The ChatGPT sign-in window was closed before it opened.',
        )
      }

      oauthState = 'waiting'
      const waitForAuthorization = Effect.gen(function* () {
        const authApi = yield* AuthApi
        const checkStatus = authApi
          .oauthStatus('openai', result.attemptId)
          .pipe(
            Effect.flatMap((status) =>
              status.status === 'failed'
                ? Effect.fail(
                    new Error(status.message ?? 'ChatGPT sign-in failed.'),
                  )
                : Effect.succeed(status.status),
            ),
          )

        yield* checkStatus.pipe(
          Effect.repeat({
            schedule: Schedule.spaced('1 second'),
            until: (status) => status === 'succeeded',
          }),
          Effect.timeoutOrElse({
            duration: Math.max(1, result.expiresAt - Date.now() + 1000),
            orElse: () =>
              checkStatus.pipe(
                Effect.flatMap((status) =>
                  status === 'succeeded'
                    ? Effect.succeed(status)
                    : Effect.fail(
                        new Error(
                          'This ChatGPT sign-in attempt expired. Start a new sign-in attempt.',
                        ),
                      ),
                ),
              ),
          }),
        )

        yield* authStore.load()
        if (
          !authStore.providers.some(
            (item) => item.id === 'openai' && item.authenticated,
          )
        ) {
          return yield* Effect.fail(
            new Error(
              authStore.error ??
                'ChatGPT sign-in completed, but the saved credentials could not be verified.',
            ),
          )
        }
        if (modelsStore.projectId) {
          yield* modelsStore.load(modelsStore.projectId)
        }
      })

      await runConnectionPromise(waitForAuthorization)
      open = false
    } catch (cause) {
      if (oauthState === 'starting' && authWindow && !authWindow.closed) {
        authWindow.close()
      }
      error = effectErrorMessage(cause, 'Failed to start ChatGPT sign-in')
    } finally {
      oauthState = 'idle'
    }
  }
</script>

<Dialog.Dialog bind:open>
  <Dialog.DialogContent class="bg-popover sm:max-w-md">
    <Dialog.DialogHeader>
      <Dialog.DialogTitle>
        {provider ? `Connect ${provider.name}` : 'Connect Provider'}
      </Dialog.DialogTitle>
      {#if provider}
        <Dialog.DialogDescription>
          {provider.id === 'openai'
            ? 'Sign in with ChatGPT or enter an OpenAI API key.'
            : `Enter your ${provider.name} API key.`}
        </Dialog.DialogDescription>
      {/if}
    </Dialog.DialogHeader>

    {#if !provider}
      <Command.Root
        class="gap-2 overflow-visible rounded-none bg-transparent p-0 [&_[data-slot=command-input-wrapper]]:p-0"
      >
        <Command.Input placeholder="Search providers..." />
        <Command.List class="max-h-60 px-0 pb-0">
          <Command.Empty>No providers found.</Command.Empty>
          {#each providers as item (item.id)}
            <Command.Item
              class="px-2 py-2 text-sm"
              value={item.name}
              keywords={[item.id]}
              onSelect={() => {
                provider = item
                key = ''
                error = null
              }}
            >
              <span class="truncate">{item.name}</span>
            </Command.Item>
          {/each}
        </Command.List>
      </Command.Root>
    {:else}
      <form
        class="space-y-4"
        onsubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        {#if provider.id === 'openai'}
          <div class="rounded-lg border border-border p-3">
            <p class="text-sm font-medium text-foreground">
              ChatGPT subscription
            </p>
            <p class="mt-1 text-xs text-muted-foreground">
              Use your ChatGPT Plus, Pro, Team, Edu, or Enterprise access for
              Sorato.
            </p>
            <Button
              class="mt-3 w-full"
              type="button"
              variant="outline"
              disabled={oauthBusy}
              aria-busy={oauthBusy}
              onclick={() => void signInWithChatGpt()}
            >
              {oauthLabel}
            </Button>
            {#if oauthState === 'waiting'}
              <p class="mt-2 text-xs text-muted-foreground">
                Finish signing in in your browser. Sorato will update when it
                completes.
              </p>
            {/if}
          </div>

          <div class="flex items-center gap-3 text-xs text-muted-foreground">
            <div class="h-px flex-1 bg-border"></div>
            <span>or</span>
            <div class="h-px flex-1 bg-border"></div>
          </div>
        {/if}

        <div class="space-y-2.5">
          <Label for={keyInputId}>{provider.name} API key</Label>
          <Input
            id={keyInputId}
            bind:value={key}
            type="password"
            autocomplete="off"
            disabled={oauthBusy}
          />
        </div>

        {#if error}
          <Item.Root variant="danger" size="sm">
            <Item.Media variant="icon">
              <WarningCircleIcon />
            </Item.Media>
            <Item.Content>
              <Item.Title>Connection failed</Item.Title>
              <Item.Description>{error}</Item.Description>
            </Item.Content>
          </Item.Root>
        {/if}

        <Dialog.DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={saving || oauthBusy}
            onclick={() => (provider = null)}
          >
            Back
          </Button>
          <Button type="submit" disabled={saving || oauthBusy || !key.trim()}>
            {saving ? 'Connecting...' : 'Connect'}
          </Button>
        </Dialog.DialogFooter>
      </form>
    {/if}
  </Dialog.DialogContent>
</Dialog.Dialog>
