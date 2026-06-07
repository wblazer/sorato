<script lang="ts">
  import type { MessagePart } from '$lib/types.js'
  import { clientSettingsStore } from '$lib/stores/client-settings.svelte.js'
  import { projectTranscript, streamingSources } from '$lib/transcript.js'
  import AssistantTranscript from './assistant-transcript.svelte'

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
  <AssistantTranscript
    items={renderParts}
    {isRunning}
    reserveMetaSpace={parts.length > 0}
  />
{/if}
