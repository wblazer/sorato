<script lang="ts">
  import Markdown from '$lib/components/markdown.svelte'
  import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon'

  let {
    text,
    accordionState,
    accordionKey,
  }: {
    text: string
    accordionState: Record<string, string[]>
    accordionKey: string
  } = $props()

  const expanded = $derived(
    (accordionState[accordionKey] ?? []).includes('content'),
  )

  function toggle() {
    accordionState[accordionKey] = expanded ? [] : ['content']
  }
</script>

<div class="py-1 text-sm">
  <button
    type="button"
    class="flex w-full items-center gap-2 py-1 text-left text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    aria-expanded={expanded}
    onclick={toggle}
  >
    <CaretDownIcon
      class="size-3.5 shrink-0 transition-transform {expanded
        ? ''
        : '-rotate-90'}"
    />
    <span>Summary</span>
  </button>
  {#if expanded}
    <div class="pb-1 pl-5 pt-2">
      <Markdown {text} />
    </div>
  {/if}
</div>
