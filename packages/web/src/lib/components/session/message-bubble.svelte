<script lang="ts">
  import type { MessageNode } from '$lib/types.js'
  import { clientSettingsStore } from '$lib/stores/client-settings.svelte.js'
  import {
    messageParts,
    persistedSources,
    projectTranscript,
    type TranscriptItem,
  } from '$lib/transcript.js'
  import MessagePartComponent from './message-part.svelte'
  import ToolCallResult from './tool-call-result.svelte'

  let {
    message,
    transcriptItems,
  }: { message: MessageNode; transcriptItems?: ReadonlyArray<TranscriptItem> } =
    $props()

  const role = $derived(message.encoded.role)

  /** Normalize content to an array of parts for uniform rendering. */
  const parts = $derived(messageParts(message))

  const renderParts = $derived.by((): ReadonlyArray<TranscriptItem> =>
    transcriptItems ??
    projectTranscript(persistedSources([message]), {
      pretty: clientSettingsStore.prettyToolOutput,
    })
  )

  const isUser = $derived(role === 'user')
  const isSystem = $derived(role === 'system')
</script>

{#if renderParts.length > 0}
  <div class="flex flex-col gap-2 py-2.5">
    {#if parts.length === 0}
    <span class="text-xs italic text-muted-foreground">(empty)</span>
    {:else if isUser}
    <div
      class="ml-auto w-fit max-w-[min(42rem,85%)] rounded-lg border border-accent bg-accent text-accent-foreground shadow-sm shadow-shadow/30"
    >
      <div class="flex flex-col gap-3 px-3 py-3">
        {#each renderParts as item}
          {#if item.type === 'combined-tool'}
            <ToolCallResult call={item.call} result={item.result} />
          {:else}
            <MessagePartComponent part={item.part} monospace={false} />
          {/if}
        {/each}
      </div>
    </div>
    {:else if isSystem}
    <div
      class="w-full overflow-hidden rounded-lg border border-border bg-surface text-foreground shadow-sm shadow-shadow/30"
    >
      <div
        class="border-b border-border px-3 py-2 text-sm font-semibold text-foreground"
      >
        System
      </div>
      <div class="flex flex-col gap-3 px-3 py-3">
        {#each renderParts as item}
          {#if item.type === 'combined-tool'}
            <ToolCallResult call={item.call} result={item.result} />
          {:else}
            <MessagePartComponent part={item.part} monospace={true} />
          {/if}
        {/each}
      </div>
    </div>
    {:else}
    <div class="flex flex-col gap-3">
      {#each renderParts as item}
        {#if item.type === 'combined-tool'}
          <ToolCallResult call={item.call} result={item.result} />
        {:else}
          <MessagePartComponent part={item.part} monospace={false} />
        {/if}
      {/each}
    </div>
    {/if}
  </div>
{/if}
