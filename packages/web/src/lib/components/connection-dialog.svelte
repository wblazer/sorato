<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog/index.js'
  import Button from '$lib/components/ui/button/button.svelte'
  import { hotkeyStore } from '$lib/stores/hotkeys.svelte.js'
  import type { Connection } from '$lib/stores/connections.svelte.js'
  import { untrack } from 'svelte'

  interface Props {
    open: boolean
    connection?: Connection | null
    onSave: (data: { url: string; name?: string }) => void
    onClose: () => void
  }

  let {
    open = $bindable(false),
    connection = null,
    onSave,
    onClose,
  }: Props = $props()

  // Form state
  let url = $state('')
  let name = $state('')
  let urlError = $state('')
  let isChecking = $state(false)
  let checkStatus = $state<'idle' | 'loading' | 'success' | 'error'>('idle')

  $effect(() => {
    if (!open) return
    untrack(() => hotkeyStore.pushScope('connection-dialog'))
    return () => untrack(() => hotkeyStore.popScope('connection-dialog'))
  })

  // Reset form when connection changes or dialog opens
  $effect(() => {
    if (open) {
      url = connection?.url ?? ''
      name = connection?.name ?? ''
      urlError = ''
      checkStatus = 'idle'
    }
  })

  async function checkUrl() {
    if (!url.trim()) {
      urlError = 'URL is required'
      checkStatus = 'error'
      return
    }

    // Basic URL validation
    try {
      new URL(url)
    } catch {
      urlError = 'Invalid URL format'
      checkStatus = 'error'
      return
    }

    urlError = ''
    isChecking = true
    checkStatus = 'loading'

    try {
      const response = await fetch(`${url}/handshake`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      })

      if (!response.ok) {
        throw new Error('Server returned error')
      }

      const data = await response.json()
      if (data.status === 'ok') {
        checkStatus = 'success'
      } else {
        checkStatus = 'error'
        urlError = 'Invalid server response'
      }
    } catch (e) {
      checkStatus = 'error'
      urlError = 'Could not connect to server'
    } finally {
      isChecking = false
    }
  }

  function handleUrlBlur() {
    if (url.trim()) {
      checkUrl()
    }
  }

  function handleSave() {
    if (checkStatus !== 'success' && url.trim()) {
      // Try to validate before saving
      checkUrl().then(() => {
        if (checkStatus === 'success') {
          doSave()
        }
      })
    } else {
      doSave()
    }
  }

  function doSave() {
    onSave({
      url: url.trim(),
      name: name.trim() || undefined,
    })
    onClose()
  }

  function getStatusColor() {
    switch (checkStatus) {
      case 'success':
        return 'text-green-500'
      case 'error':
        return 'text-red-500'
      case 'loading':
        return 'text-yellow-500'
      default:
        return 'text-muted-foreground'
    }
  }

  function getStatusIcon() {
    switch (checkStatus) {
      case 'success':
        return '✓'
      case 'error':
        return '✗'
      case 'loading':
        return '⟳'
      default:
        return '○'
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-[500px]">
    <Dialog.Header>
      <Dialog.Title
        >{connection ? 'Edit Connection' : 'Add Connection'}</Dialog.Title
      >
      <Dialog.Description>
        {connection
          ? 'Update the server connection details.'
          : 'Add a new agents server to connect to.'}
      </Dialog.Description>
    </Dialog.Header>

    <div class="grid gap-4 py-4">
      <div class="grid gap-2">
        <label for="url" class="text-sm font-medium">
          Server URL <span class="text-red-500">*</span>
        </label>
        <div class="relative">
          <input
            id="url"
            type="text"
            placeholder="http://localhost:3100"
            bind:value={url}
            onblur={handleUrlBlur}
            class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          />
          <div
            class="absolute right-3 top-1/2 -translate-y-1/2 {getStatusColor()}"
          >
            {#if checkStatus === 'loading'}
              <span class="animate-spin">{getStatusIcon()}</span>
            {:else}
              {getStatusIcon()}
            {/if}
          </div>
        </div>
        {#if urlError}
          <p class="text-xs text-red-500">{urlError}</p>
        {:else if checkStatus === 'success'}
          <p class="text-xs text-green-500">Server connected successfully</p>
        {/if}
        <p class="text-xs text-muted-foreground">
          The server URL will be checked when you unfocus the field.
        </p>
      </div>

      <div class="grid gap-2">
        <label for="name" class="text-sm font-medium">
          Display Name <span class="text-muted-foreground">(optional)</span>
        </label>
        <input
          id="name"
          type="text"
          placeholder="My Local Server"
          bind:value={name}
          class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>
    </div>

    <Dialog.Footer>
      <Button variant="outline" onclick={onClose}>Cancel</Button>
      <Button
        onclick={handleSave}
        disabled={!url.trim() || checkStatus === 'loading'}
      >
        {connection ? 'Save Changes' : 'Add Connection'}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
