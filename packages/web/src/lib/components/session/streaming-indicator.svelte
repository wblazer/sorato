<script lang="ts">
  import type { MessagePart } from '$lib/types.js'
  import { clientSettingsStore } from '$lib/stores/client-settings.svelte.js'
  import { projectTranscript, streamingSources } from '$lib/transcript.js'
  import AssistantTranscript from './assistant-transcript.svelte'
  import SystemTranscript from './system-transcript.svelte'

  let {
    parts,
    isRunning,
    variant = 'assistant',
    accordionState,
    accordionKey,
  }: {
    parts: MessagePart[]
    isRunning: boolean
    variant?: 'assistant' | 'system'
    accordionState: Record<string, string[]>
    accordionKey: string
  } = $props()

  // Show this component when the followed run is active OR when there's still
  // streaming content waiting to be replaced by persisted messages.
  // This prevents the flash on RunEnd: the content stays visible until
  // refreshMessages lands and clears streamingParts.
  const visible = $derived(isRunning || parts.length > 0)

  const renderParts = $derived.by(() =>
    projectTranscript(streamingSources(parts), {
      pretty: clientSettingsStore.prettyTranscript,
    }),
  )
</script>

{#if visible}
  {#if variant === 'system'}
    <SystemTranscript
      items={renderParts}
      title="Summary"
      defaultOpen={true}
      {accordionState}
      accordionKey={`${accordionKey}:system-streaming`}
    />
  {:else}
    <AssistantTranscript
      items={renderParts}
      {isRunning}
      {accordionState}
      {accordionKey}
    />
  {/if}
{/if}
