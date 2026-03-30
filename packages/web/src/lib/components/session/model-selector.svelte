<script lang="ts">
  import { tick } from 'svelte'
  import { useId } from 'bits-ui'
  import * as Command from '$lib/components/ui/command/index.js'
  import * as Popover from '$lib/components/ui/popover/index.js'
  import type { AvailableModel } from '$lib/types.js'

  interface Props {
    models: ReadonlyArray<AvailableModel>
    value: string | null
    loading?: boolean
    disabled?: boolean
    compact?: boolean
    onChange?: (value: string) => void
  }

  let {
    models,
    value,
    loading = false,
    disabled = false,
    compact = false,
    onChange,
  }: Props = $props()

  let open = $state(false)
  let triggerRef: HTMLButtonElement | null = $state(null)
  const listboxId = useId()

  const missing = $derived(
    value ? !models.some((item) => item.id === value) : false
  )

  const selectedModel = $derived(
    models.find((item) => item.id === value) ?? null
  )

  function closeAndFocusTrigger() {
    open = false
    tick().then(() => triggerRef?.focus())
  }

  function selectModel(id: string) {
    onChange?.(id)
    closeAndFocusTrigger()
  }

  const triggerLabel = $derived.by(() => {
    if (loading) return 'Loading models...'
    if (selectedModel) return selectedModel.name
    if (missing && value) return `${value} (unavailable)`
    if (models.length === 0) return 'No models'
    return 'Select model'
  })
</script>

<Popover.Root bind:open>
  <Popover.Trigger bind:ref={triggerRef}>
    <button
      type="button"
      class={compact
        ? 'flex min-w-0 items-center gap-1 rounded-md px-2 py-1 text-sm text-foreground transition-colors hover:bg-background/70 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60'
        : 'flex min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground transition-colors hover:border-ring focus:outline-none disabled:cursor-not-allowed disabled:opacity-60'}
      role="combobox"
      aria-controls={listboxId}
      aria-expanded={open}
      {disabled}
    >
      <span class="truncate">{triggerLabel}</span>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="shrink-0 text-muted-foreground"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
  </Popover.Trigger>

  <Popover.Content
    class="w-[min(24rem,calc(100vw-2rem))] gap-0 overflow-hidden p-1.5"
    align={compact ? 'start' : 'center'}
  >
    <Command.Root class="rounded-lg border border-border/60 bg-popover p-0">
      <Command.Input placeholder="Search models..." />
      <Command.List id={listboxId} class="max-h-72 px-1 pb-1">
        {#if loading}
          <div class="px-3 py-6 text-center text-sm text-muted-foreground">
            Loading models...
          </div>
        {:else}
          <Command.Empty>No models found.</Command.Empty>

          {#if missing && value}
            <Command.Group heading="Current selection">
              <Command.Item
                value={`${value} unavailable`}
                onSelect={() => selectModel(value)}
              >
                <span class="truncate">{value} (unavailable)</span>
              </Command.Item>
            </Command.Group>
          {/if}

          <Command.Group heading="Models">
            {#each models as item (item.id)}
              <Command.Item
                value={`${item.name} ${item.id} ${item.provider}`}
                onSelect={() => selectModel(item.id)}
              >
                <span class="truncate">{item.name}</span>
              </Command.Item>
            {/each}
          </Command.Group>
        {/if}
      </Command.List>
    </Command.Root>
  </Popover.Content>
</Popover.Root>
