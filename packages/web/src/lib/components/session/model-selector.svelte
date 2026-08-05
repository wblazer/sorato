<script lang="ts">
  import { tick } from 'svelte'
  import { useId } from 'bits-ui'
  import { Button } from '$lib/components/ui/button/index.js'
  import * as Command from '$lib/components/ui/command/index.js'
  import * as Popover from '$lib/components/ui/popover/index.js'
  import { Switch } from '$lib/components/ui/switch/index.js'
  import { actionStore } from '$lib/stores/actions.svelte.js'
  import type { AvailableModel } from '$lib/types.js'
  import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon'
  import PlugIcon from 'phosphor-svelte/lib/PlugIcon'

  interface Props {
    models: ReadonlyArray<AvailableModel>
    scenarios?: ReadonlyArray<AvailableModel>
    value: string | null
    scenarioValue?: string | null
    selectionKind?: 'model' | 'scenario'
    loading?: boolean
    disabled?: boolean
    onChange?: (value: string) => void
    onScenarioChange?: (value: string) => void
    onSelectionKindChange?: (kind: 'model' | 'scenario') => void
  }

  let {
    models,
    scenarios = [],
    value,
    scenarioValue = null,
    selectionKind = 'model',
    loading = false,
    disabled = false,
    onChange,
    onScenarioChange,
    onSelectionKindChange,
  }: Props = $props()

  let open = $state(false)
  let triggerRef: HTMLButtonElement | null = $state(null)
  const listboxId = useId()

  const missing = $derived(
    value ? !models.some((item) => item.id === value) : false,
  )

  const selectedModel = $derived(
    models.find((item) => item.id === value) ?? null,
  )
  const selectedScenario = $derived(
    scenarios.find((item) => item.id === scenarioValue) ?? null,
  )
  const scenarioMode = $derived(
    import.meta.env.DEV && selectionKind === 'scenario',
  )
  const showLoading = $derived(
    loading && models.length === 0 && scenarios.length === 0,
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

  function selectScenario(id: string) {
    onScenarioChange?.(id)
    closeAndFocusTrigger()
  }

  function connectProvider() {
    open = false
    queueMicrotask(() => actionStore.trigger('provider.connect'))
  }

  function filterModel(
    itemValue: string,
    search: string,
    keywords: Array<string> = [],
  ) {
    const query = search.trim().toLowerCase()

    if (!query) return 1

    const haystack = [itemValue, ...keywords].join(' ').toLowerCase()
    const terms = query.split(/\s+/)

    return terms.every((term) => fuzzyIncludes(haystack, term)) ? 1 : 0
  }

  function fuzzyIncludes(value: string, term: string) {
    if (value.includes(term)) return true

    const compactValue = compactSearchText(value)
    const compactTerm = compactSearchText(term)

    if (!compactTerm) return true
    return compactValue.includes(compactTerm)
  }

  function compactSearchText(value: string) {
    return value.replace(/[^a-z0-9]/g, '')
  }

  const triggerLabel = $derived.by(() => {
    if (scenarioMode) return selectedScenario?.name ?? 'Select scenario'
    if (selectedModel) return selectedModel.name
    if (showLoading) return 'Loading models...'
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
      class="min-w-0 justify-between text-foreground"
      role="combobox"
      aria-controls={listboxId}
      aria-expanded={open}
      {disabled}
    >
      <span class="truncate">{triggerLabel}</span>
      <CaretDownIcon class="shrink-0 text-muted-foreground" />
    </Button>
  </Popover.Trigger>

  <Popover.Content
    class="w-[min(24rem,calc(100vw-2rem))] gap-0 overflow-hidden p-0"
    align="start"
  >
    <Command.Root class="rounded-lg p-1" filter={filterModel}>
      {#if import.meta.env.DEV && scenarios.length > 0}
        <div
          class="-mx-1 flex items-center justify-between border-b px-3 py-2.5"
        >
          <div class="min-w-0 pr-3">
            <div class="text-sm font-medium">Developer scenarios</div>
            <div class="truncate text-xs text-muted-foreground">
              Use scripted inference without a provider
            </div>
          </div>
          <Switch
            size="sm"
            checked={scenarioMode}
            aria-label="Use developer scenarios"
            onCheckedChange={(checked) =>
              onSelectionKindChange?.(checked ? 'scenario' : 'model')}
          />
        </div>
      {/if}
      <Command.Input
        placeholder={scenarioMode ? 'Search scenarios...' : 'Search models...'}
      />
      <Command.List id={listboxId} class="h-60 py-1.5">
        {#if showLoading}
          <div class="px-3 py-6 text-center text-sm text-muted-foreground">
            Loading models...
          </div>
        {:else}
          <Command.Empty
            >No {scenarioMode ? 'scenarios' : 'models'} found.</Command.Empty
          >

          {#if !scenarioMode && missing && value}
            <Command.Group heading="Current selection">
              <Command.Item
                value={`${value} unavailable`}
                onSelect={() => selectModel(value)}
              >
                <span class="truncate">{value} (unavailable)</span>
              </Command.Item>
            </Command.Group>
          {/if}

          {#if scenarioMode}
            <Command.Group heading="Scenarios">
              {#each scenarios as item (item.id)}
                <Command.Item
                  value={`${item.name} ${item.id} ${item.description ?? ''}`}
                  keywords={[item.id, item.description ?? '']}
                  onSelect={() => selectScenario(item.id)}
                >
                  <span class="min-w-0">
                    <span class="block truncate">{item.name}</span>
                    {#if item.description}
                      <span class="block truncate text-xs text-muted-foreground"
                        >{item.description}</span
                      >
                    {/if}
                  </span>
                </Command.Item>
              {/each}
            </Command.Group>
          {:else}
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
        {/if}
      </Command.List>
      {#if !scenarioMode}
        <div class="-mx-1 border-t px-1.5 pt-1.5 pb-1">
          <Command.Item
            value="connect provider api key"
            onSelect={connectProvider}
          >
            <PlugIcon class="text-muted-foreground" />
            <span class="truncate">Connect provider</span>
          </Command.Item>
        </div>
      {/if}
    </Command.Root>
  </Popover.Content>
</Popover.Root>
