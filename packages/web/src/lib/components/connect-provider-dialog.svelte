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
  import { Effect } from 'effect'
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
  let oauthSaving = $state(false)
  let error = $state<string | null>(null)
  const keyInputId = useId()

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
    if (provider?.id !== 'openai' || oauthSaving) return

    oauthSaving = true
    error = null
    try {
      const authorize = Effect.gen(function* () {
        const authApi = yield* AuthApi
        return yield* authApi.oauthAuthorize('openai')
      })

      const result = await runConnectionPromise(authorize)
      window.open(result.url, '_blank', 'noopener,noreferrer')
      window.setTimeout(() => {
        void runConnectionPromise(authStore.load())
        if (modelsStore.projectId) {
          void runConnectionPromise(modelsStore.load(modelsStore.projectId))
        }
      }, 2500)
    } catch (cause) {
      error = effectErrorMessage(cause, 'Failed to start ChatGPT sign-in')
    } finally {
      oauthSaving = false
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
              disabled={oauthSaving}
              onclick={() => void signInWithChatGpt()}
            >
              {oauthSaving ? 'Opening browser...' : 'Sign in with ChatGPT'}
            </Button>
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
            onclick={() => (provider = null)}
          >
            Back
          </Button>
          <Button type="submit" disabled={saving || !key.trim()}>
            {saving ? 'Connecting...' : 'Connect'}
          </Button>
        </Dialog.DialogFooter>
      </form>
    {/if}
  </Dialog.DialogContent>
</Dialog.Dialog>
