<script lang="ts">
  import { Button } from '$lib/components/ui/button/index.js'
  import * as Command from '$lib/components/ui/command/index.js'
  import * as Dialog from '$lib/components/ui/dialog/index.js'
  import { Input } from '$lib/components/ui/input/index.js'
  import { Label } from '$lib/components/ui/label/index.js'
  import { connectionsStore } from '$lib/stores/connections.svelte.js'
  import { modelsStore } from '$lib/stores/models.svelte.js'
  import { useId } from 'bits-ui'

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

  $effect(() => {
    if (!open) return
    provider = null
    key = ''
    error = null
  })

  async function submit() {
    const api = connectionsStore.getApiBase()
    const providerId = provider?.id
    const apiKey = key.trim()
    if (!api || !providerId || !apiKey || saving) return

    saving = true
    error = null
    try {
      const res = await fetch(`${api}/auth/${encodeURIComponent(providerId)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: apiKey }),
      })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      open = false
      if (modelsStore.directory) void modelsStore.load(modelsStore.directory)
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to connect provider'
    } finally {
      saving = false
    }
  }

  async function signInWithChatGpt() {
    const api = connectionsStore.getApiBase()
    if (!api || provider?.id !== 'openai' || oauthSaving) return

    oauthSaving = true
    error = null
    try {
      const res = await fetch(`${api}/auth/openai/oauth/authorize`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      const body = (await res.json()) as { url: string }
      window.open(body.url, '_blank', 'noopener,noreferrer')
      window.setTimeout(() => {
        if (modelsStore.directory) void modelsStore.load(modelsStore.directory)
      }, 2500)
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to start ChatGPT sign-in'
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
      <Command.Root class="gap-2 overflow-visible rounded-none bg-transparent p-0 [&_[data-slot=command-input-wrapper]]:p-0">
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
      <form class="space-y-4" onsubmit={(event) => { event.preventDefault(); void submit() }}>
        {#if provider.id === 'openai'}
          <div class="rounded-lg border border-border bg-surface p-3">
            <p class="text-sm font-medium text-foreground">ChatGPT subscription</p>
            <p class="mt-1 text-xs text-muted-foreground">
              Use your ChatGPT Plus, Pro, Team, Edu, or Enterprise access for Sorato.
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
          <Input id={keyInputId} bind:value={key} type="password" autocomplete="off" />
        </div>

        {#if error}
          <p class="text-sm text-danger">{error}</p>
        {/if}

        <Dialog.DialogFooter>
          <Button type="button" variant="ghost" onclick={() => (provider = null)}>
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
