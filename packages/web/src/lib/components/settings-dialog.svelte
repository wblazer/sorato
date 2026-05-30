<script lang="ts">
  import Button from '$lib/components/ui/button/button.svelte'
  import ButtonStableLabel from '$lib/components/ui/button/button-stable-label.svelte'
  import * as Dialog from '$lib/components/ui/dialog/index.js'
  import * as Item from '$lib/components/ui/item/index.js'
  import * as Select from '$lib/components/ui/select/index.js'
  import { Switch } from '$lib/components/ui/switch/index.js'
  import * as Tabs from '$lib/components/ui/tabs/index.js'
  import { confirmationStore } from '$lib/stores/confirmation.svelte.js'
  import { hotkeyStore } from '$lib/stores/hotkeys.svelte.js'
  import { createTimedAction } from '$lib/timed-action.svelte.js'
  import CheckIcon from 'phosphor-svelte/lib/CheckIcon'
  import CopyIcon from 'phosphor-svelte/lib/CopyIcon'
  import GearIcon from 'phosphor-svelte/lib/GearIcon'
  import KeyboardIcon from 'phosphor-svelte/lib/KeyboardIcon'
  import XIcon from 'phosphor-svelte/lib/XIcon'
  import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircleIcon'
  import {
    clientConfigService,
    diffClientConfig,
    encodeClientConfig,
    mergeClientConfig,
    type ClientConfig,
    type ResolvedClientConfig,
    type ToolOutputFormat,
  } from '$lib/client-config/index.js'
  import { Effect } from 'effect'
  import { untrack } from 'svelte'

  interface Props {
    open: boolean
  }

  type SettingsTab = 'general' | 'keybinds'

  let { open = $bindable(false) }: Props = $props()

  let activeTab = $state<SettingsTab>('general')
  let config = $state<ResolvedClientConfig | null>(null)
  let expandToolBlocksByDefault = $state(false)
  let toolOutputFormat = $state<ToolOutputFormat>('pretty')
  let error = $state<string | null>(null)
  let loading = $state(false)
  let saving = $state(false)
  let saveInFlight = false
  let queuedSaveValue: Required<ClientConfig> | null = null

  const baseConfig = $derived(
    config === null ? null : mergeClientConfig(config.defaults, config.file)
  )

  const customConfig = $derived(
    config === null ? {} : diffClientConfig(config.defaults, config.resolved)
  )

  const hasFileConfig = $derived(
    config !== null && Object.keys(config.file).length > 0
  )
  const hasOverrides = $derived(
    config !== null && Object.keys(config.overrides).length > 0
  )
  const resetLabel = $derived(
    hasFileConfig ? 'Reset to config file' : 'Reset to defaults'
  )

  const copySettingsAction = createTimedAction({ run: copyChangedSettings })

  $effect(() => {
    if (!open) return
    untrack(() => hotkeyStore.pushScope('settings-dialog'))
    return () => untrack(() => hotkeyStore.popScope('settings-dialog'))
  })

  $effect(() => {
    if (!open) return
    void loadConfig()
  })

  function describeError(cause: unknown, fallback: string) {
    return cause instanceof Error ? cause.message : fallback
  }

  function applyConfig(nextConfig: ResolvedClientConfig) {
    config = nextConfig
    expandToolBlocksByDefault = nextConfig.resolved.expand_tool_blocks_by_default
    toolOutputFormat = nextConfig.resolved.tool_output_format
  }

  async function loadConfig() {
    loading = true
    error = null
    try {
      applyConfig(await Effect.runPromise(clientConfigService.getResolved))
    } catch (cause) {
      error = describeError(cause, 'Failed to load settings.')
    } finally {
      loading = false
    }
  }

  function saveResolvedValue(value: Required<ClientConfig>) {
    if (config === null || baseConfig === null) return

    const overrides = diffClientConfig(baseConfig, value)
    config = {
      ...config,
      overrides,
      resolved: value,
    }
    saving = true
    error = null

    if (saveInFlight) {
      queuedSaveValue = value
      return
    }

    void flushSave(value)
  }

  async function flushSave(initialValue: Required<ClientConfig>) {
    saveInFlight = true

    try {
      let value: Required<ClientConfig> | null = initialValue

      while (value !== null) {
        if (baseConfig === null) return

        const overrides = diffClientConfig(baseConfig, value)
        const savedConfig = await Effect.runPromise(
          clientConfigService.setOverrides(overrides)
        )

        value = queuedSaveValue
        queuedSaveValue = null

        if (value === null) {
          applyConfig(savedConfig)
        }
      }
    } catch (cause) {
      queuedSaveValue = null
      error = describeError(cause, 'Failed to save settings.')
    } finally {
      saveInFlight = false
      saving = false
    }
  }

  function setExpandToolBlocksByDefault(value: boolean) {
    expandToolBlocksByDefault = value
    saveResolvedValue({
      expand_tool_blocks_by_default: value,
      tool_output_format: toolOutputFormat,
    })
  }

  function setToolOutputFormat(value: string) {
    if (value !== 'pretty' && value !== 'raw') return
    toolOutputFormat = value
    saveResolvedValue({
      expand_tool_blocks_by_default: expandToolBlocksByDefault,
      tool_output_format: value,
    })
  }

  function confirmClearOverrides() {
    confirmationStore.openConfirmation({
      title: resetLabel,
      description: hasFileConfig
        ? 'Discard all local changes and return to the values from your config file? This cannot be undone.'
        : 'Discard all local changes and return to the default settings? This cannot be undone.',
      action: {
        label: (pending) => (pending ? 'Resetting…' : resetLabel),
        variant: 'destructive',
        run: async ({ close, setError, setPending }) => {
          queuedSaveValue = null
          saving = true
          error = null
          setError(null)
          setPending(true)

          try {
            applyConfig(
              await Effect.runPromise(clientConfigService.setOverrides({}))
            )
            close()
          } catch (cause) {
            setError(describeError(cause, 'Failed to reset settings.'))
          } finally {
            saving = false
            setPending(false)
          }
        },
      },
    })
  }

  async function copyText(text: string) {
    error = null
    try {
      await navigator.clipboard.writeText(text)
    } catch (cause) {
      error = describeError(cause, 'Failed to copy settings.')
    }
  }

  async function copyChangedSettings() {
    await copyText(encodeClientConfig(customConfig))
  }

</script>

<Dialog.Root bind:open>
  <Dialog.Content
    class="h-[min(760px,calc(100vh-2rem))] gap-0 p-0 sm:max-w-[920px]"
    showCloseButton={false}
  >
    <Tabs.Root
      value={activeTab}
      onValueChange={(value) => (activeTab = value as SettingsTab)}
      orientation="vertical"
      class="grid min-h-0 flex-1 grid-cols-[220px_1fr] gap-0 overflow-hidden"
    >
      <aside class="border-r border-border p-3">
        <Dialog.Title class="sr-only">Settings</Dialog.Title>
        <Tabs.List variant="default" class="flex w-full flex-col items-stretch gap-1 bg-transparent p-0">
          <Tabs.Trigger value="general">
            {#snippet child({ props })}
              <Button
                {...props}
                variant="ghost"
                size="lg"
                class="w-full justify-start text-muted-foreground data-active:bg-selected data-active:text-foreground"
              >
                <GearIcon />
                General
              </Button>
            {/snippet}
          </Tabs.Trigger>
          <Tabs.Trigger value="keybinds">
            {#snippet child({ props })}
              <Button
                {...props}
                variant="ghost"
                size="lg"
                class="w-full justify-start text-muted-foreground data-active:bg-selected data-active:text-foreground"
              >
                <KeyboardIcon />
                Keybinds
              </Button>
            {/snippet}
          </Tabs.Trigger>
        </Tabs.List>
      </aside>

      <main class="relative min-h-0 overflow-y-auto p-6 pr-14">
        <Button
          variant="ghost"
          size="icon"
          class="absolute right-2 top-2"
          data-slot="dialog-close"
          aria-label="Close settings"
          onclick={() => (open = false)}
        >
          <XIcon />
        </Button>

        {#if loading && config === null}
          <div class="text-base text-muted-foreground">Loading settings…</div>
        {:else}
          <Tabs.Content value="general" class="text-base">
            <section class="grid gap-10">
              <div class="grid">
                <div class="flex items-center justify-between gap-8 border-b border-border py-4 first:pt-0">
                  <div class="min-w-0">
                    <div class="text-base font-medium">Expand tool blocks by default</div>
                    <div class="mt-0.5 text-base text-muted-foreground">
                      Open new tool call and result blocks automatically.
                    </div>
                  </div>
                  <Switch
                    checked={expandToolBlocksByDefault}
                    onCheckedChange={setExpandToolBlocksByDefault}
                    disabled={loading || config === null}
                  />
                </div>

                <div class="flex items-center justify-between gap-8 py-4">
                  <div class="min-w-0">
                    <div class="text-base font-medium">Tool output format</div>
                    <div class="mt-0.5 text-base text-muted-foreground">
                      Choose how tool results appear in the conversation.
                    </div>
                  </div>
                  <Select.Root
                    type="single"
                    value={toolOutputFormat}
                    onValueChange={setToolOutputFormat}
                    disabled={loading || config === null}
                  >
                    <Select.Trigger class="w-32 capitalize">
                      {toolOutputFormat}
                    </Select.Trigger>
                    <Select.Content class="w-40" align="end">
                      <Select.Item value="pretty" label="Pretty" />
                      <Select.Item value="raw" label="Raw" />
                    </Select.Content>
                  </Select.Root>
                </div>
              </div>

              {#if hasOverrides}
                <div class="grid gap-4">
                  <h2 class="text-lg font-semibold">Local changes</h2>
                  <div class="grid">
                    <div class="flex items-center justify-between gap-8 border-b border-border py-4 first:pt-0">
                      <div class="min-w-0">
                        <div class="text-base font-medium">Copy settings</div>
                        <div class="mt-0.5 text-base text-muted-foreground">
                          Copy non-default settings as JSON.
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        onclick={copySettingsAction.run}
                        disabled={loading ||
                          config === null ||
                          copySettingsAction.pending}
                      >
                        <ButtonStableLabel value={copySettingsAction.state}>
                          {#snippet idle()}
                            <CopyIcon />
                            Copy Settings
                          {/snippet}
                          {#snippet pending()}
                            Copying…
                          {/snippet}
                          {#snippet success()}
                            <CheckIcon />
                            Copied!
                          {/snippet}
                        </ButtonStableLabel>
                      </Button>
                    </div>

                    <div class="flex items-center justify-between gap-8 py-4">
                      <div class="min-w-0">
                        <div class="text-base font-medium">{resetLabel}</div>
                        <div class="mt-0.5 text-base text-muted-foreground">
                          {hasFileConfig
                            ? 'Discard local changes and use your config file.'
                            : 'Discard local changes and use the default settings.'}
                        </div>
                      </div>
                      <Button
                        variant="outline-destructive"
                        onclick={confirmClearOverrides}
                        disabled={loading || saving}
                      >
                        {resetLabel}
                      </Button>
                    </div>
                  </div>
                </div>
              {/if}
            </section>
          </Tabs.Content>

          <Tabs.Content value="keybinds" class="text-base">
            <section class="grid gap-3">
              <h2 class="text-base font-medium">Keybinds</h2>
              <p class="text-base text-muted-foreground">
                Keybind settings are coming soon. This tab is here to establish the settings layout.
              </p>
            </section>
          </Tabs.Content>
        {/if}

        {#if error}
          <Item.Root variant="danger" class="mt-6">
            <Item.Media variant="icon">
              <WarningCircleIcon />
            </Item.Media>
            <Item.Content>
              <Item.Title>Settings error</Item.Title>
              <Item.Description>{error}</Item.Description>
            </Item.Content>
          </Item.Root>
        {/if}
      </main>
    </Tabs.Root>
  </Dialog.Content>
</Dialog.Root>
