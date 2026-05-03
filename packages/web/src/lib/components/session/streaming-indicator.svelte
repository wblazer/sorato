<script lang="ts">
  import type { MessagePart } from '$lib/types.js'
      import MessagePartComponent from './message-part.svelte'

      let { parts, isRunning }: { parts: MessagePart[]; isRunning: boolean } =
        $props()

      // Show this component when the run is active OR when there's still
      // streaming content waiting to be replaced by persisted messages.
      // This prevents the flash on RunEnd: the content stays visible until
      // refreshMessages lands and clears streamingParts.
      const visible = $derived(isRunning || parts.length > 0)
</script>

{#if visible}
  <div class="flex flex-col gap-3 py-1">
    {#if parts.length > 0}
      {#each parts as part}
        <MessagePartComponent {part} monospace={false} />
      {/each}
    {:else if isRunning}
      <div class="flex items-center gap-1.5">
        <span
          class="inline-block h-1 w-1 animate-pulse rounded-full bg-muted-foreground"
        ></span>
        <span
          class="inline-block h-1 w-1 animate-pulse rounded-full bg-muted-foreground"
          style="animation-delay: 150ms"
        ></span>
        <span
          class="inline-block h-1 w-1 animate-pulse rounded-full bg-muted-foreground"
          style="animation-delay: 300ms"
        ></span>
      </div>
    {/if}
  </div>
{/if}
