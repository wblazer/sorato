<script lang="ts">
  import { tick } from 'svelte'
      import { useId } from 'bits-ui'
      import { Button } from '$lib/components/ui/button/index.js'
      import * as Command from '$lib/components/ui/command/index.js'
      import * as Popover from '$lib/components/ui/popover/index.js'
      import type { AvailableModel } from '$lib/types.js'
      import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon'

      interface Props {
        models: ReadonlyArray<AvailableModel>
        value: string | null
        loading?: boolean
        disabled?: boolean
        onChange?: (value: string) => void
      }

      let {
        models,
        value,
        loading = false,
        disabled = false,
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

      const modelsByProvider = $derived.by(() => {
        const groups = new Map<string, Array<AvailableModel>>()

        for (const model of models) {
          const provider = model.provider.trim() || 'Unknown'
          const providerModels = groups.get(provider)

          if (providerModels) {
            providerModels.push(model)
            continue
          }

          groups.set(provider, [model])
        }

        return Array.from(groups.entries(), ([provider, items]) => ({
          provider,
          items,
        }))
      })

      function closeAndFocusTrigger() {
        open = false
        tick().then(() => triggerRef?.focus())
      }

      function selectModel(id: string) {
        onChange?.(id)
        closeAndFocusTrigger()
      }

      function filterModel(
        itemValue: string,
        search: string,
        keywords: Array<string> = []
      ) {
        const query = search.trim().toLowerCase()

        if (!query) return 1

        const haystack = [itemValue, ...keywords].join(' ').toLowerCase()
        const terms = query.split(/\s+/)

        return terms.every((term) => haystack.includes(term)) ? 1 : 0
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
    <Button
      type="button"
      variant="ghost"
      size="sm"
      class="h-7 min-w-0 justify-between gap-2 text-sm text-foreground"
      role="combobox"
      aria-controls={listboxId}
      aria-expanded={open}
      {disabled}
    >
      <span class="truncate">{triggerLabel}</span>
      <CaretDownIcon class="shrink-0 text-muted" />
    </Button>
  </Popover.Trigger>

  <Popover.Content
    class="w-[min(24rem,calc(100vw-2rem))] gap-0 overflow-hidden p-1.5"
    align="start"
  >
    <Command.Root class="rounded-lg p-0" filter={filterModel}>
      <Command.Input placeholder="Search models..." />
      <Command.List id={listboxId} class="h-60 px-1 pb-1">
        {#if loading}
          <div class="px-3 py-6 text-center text-sm text-muted">
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

          {#each modelsByProvider as group (group.provider)}
            <Command.Group heading={group.provider}>
              {#each group.items as item (item.id)}
                <Command.Item
                  value={`${item.name} ${item.id} ${item.provider}`}
                  keywords={[item.provider, item.id]}
                  onSelect={() => selectModel(item.id)}
                >
                  <span class="truncate">{item.name}</span>
                </Command.Item>
              {/each}
            </Command.Group>
          {/each}
        {/if}
      </Command.List>
    </Command.Root>
  </Popover.Content>
</Popover.Root>
