<script lang="ts">
  import type { MessageIconName } from '@sorato/core/presentation'
  import { iconForMessageName } from './message-icons.js'

  let {
    name,
    class: className = 'size-4 shrink-0 text-muted-foreground',
  }: {
    name?: MessageIconName | undefined
    class?: string | undefined
  } = $props()

  const Icon = $derived(iconForMessageName(name))
</script>

{#if Icon}
  <Icon class={className} aria-hidden="true" />
{/if}
