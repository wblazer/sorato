<script lang="ts">
  import type { MessagePart } from '$lib/types.js'
  import { clientSettingsStore } from '$lib/stores/client-settings.svelte.js'
  import { projectTranscript, streamingSources } from '$lib/transcript.js'
  import MessagePartComponent from './message-part.svelte'
  import ToolCallResult from './tool-call-result.svelte'

  let { parts, isRunning }: { parts: MessagePart[]; isRunning: boolean } =
    $props()

  // Show this component when the run is active OR when there's still
  // streaming content waiting to be replaced by persisted messages.
  // This prevents the flash on RunEnd: the content stays visible until
  // refreshMessages lands and clears streamingParts.
  const visible = $derived(isRunning || parts.length > 0)

  const renderParts = $derived.by(() =>
    projectTranscript(streamingSources(parts), {
      pretty: clientSettingsStore.prettyTranscript,
    })
  )
</script>

{#if visible}
  <div class="py-1">
    <div class="flex flex-col gap-3">
      {#if renderParts.length > 0}
        {#each renderParts as item}
          {#if item.type === 'combined-tool'}
            <ToolCallResult call={item.call} result={item.result} />
          {:else if item.type === 'interruption'}
            <div class="flex items-center gap-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <div class="h-px flex-1 bg-border"></div>
              <span>Interrupted</span>
              <div class="h-px flex-1 bg-border"></div>
            </div>
          {:else}
            <MessagePartComponent part={item.part} monospace={false} />
          {/if}
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

    <div class="mt-2 h-4" aria-hidden="true"></div>
  </div>
{/if}
