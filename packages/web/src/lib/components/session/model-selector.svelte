<script lang="ts">
  import type { AvailableModel } from '$lib/types.js'

  interface Props {
    models: ReadonlyArray<AvailableModel>
    value: string | null
    loading?: boolean
    disabled?: boolean
    label?: string
    onChange?: (value: string) => void
  }

  let {
    models,
    value,
    loading = false,
    disabled = false,
    label = 'Model',
    onChange,
  }: Props = $props()

  const missing = $derived(
    value ? !models.some((item) => item.id === value) : false
  )
</script>

<label class="flex min-w-0 flex-col gap-1">
  <span
    class="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
  >
    {label}
  </span>
  <select
    class="min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-ring disabled:cursor-not-allowed disabled:opacity-60"
    value={value ?? ''}
    {disabled}
    onchange={(event) => onChange?.(event.currentTarget.value)}
  >
    {#if loading}
      <option value="">Loading models...</option>
    {:else if !value && models.length === 0}
      <option value="">No models available</option>
    {:else}
      {#if missing && value}
        <option {value}>{value} (unavailable)</option>
      {/if}
      {#each models as item (item.id)}
        <option value={item.id}>{item.name}</option>
      {/each}
    {/if}
  </select>
</label>
