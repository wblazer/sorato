<script lang="ts">
  import type { MessageNode } from '$lib/types.js'
  import { clientSettingsStore } from '$lib/stores/client-settings.svelte.js'
  import {
    messageParts,
    persistedSources,
    projectTranscript,
    type TranscriptItem,
  } from '$lib/transcript.js'
  import * as Accordion from '$lib/components/ui/accordion/index.js'
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
      pretty: clientSettingsStore.prettyTranscript,
    })
  )

  const isUser = $derived(role === 'user')
  const isSystem = $derived(role === 'system')
  const isInterruption = $derived(
    renderParts.length === 1 && renderParts[0]?.type === 'interruption'
  )
  const systemTitle = $derived(
    message.encoded.role === 'system'
      ? (message.encoded.display?.title ?? 'System')
      : 'System'
  )
  const systemSubtitle = $derived(
    message.encoded.role === 'system' ? message.encoded.display?.subtitle : undefined
  )
  let systemOpenItems = $state(['content'])

  const transcriptItemKind = (item: TranscriptItem): string => {
    if (item.type === 'combined-tool') return 'tool'
    if (item.type === 'message') {
      return item.part.type === 'tool-call' || item.part.type === 'tool-result'
        ? 'tool'
        : item.part.type
    }
    return item.type
  }
</script>

{#if renderParts.length > 0}
  <div class="flex flex-col gap-2 py-2.5">
    {#if isInterruption}
    <div class="flex items-center gap-3 py-1 text-sm font-medium text-muted-foreground">
      <div class="h-px flex-1 bg-border"></div>
      <span>Interrupted</span>
      <div class="h-px flex-1 bg-border"></div>
    </div>
    {:else if parts.length === 0}
    <span class="text-xs italic text-muted-foreground">(empty)</span>
    {:else if isUser}
    <div
      class="ml-auto w-fit max-w-[min(42rem,85%)] rounded-lg border border-accent bg-accent text-accent-foreground shadow-sm shadow-shadow/30"
    >
      <div class="flex flex-col gap-3 px-3 py-3">
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
      </div>
    </div>
    {:else if isSystem}
    <Accordion.Root
      type="multiple"
      bind:value={systemOpenItems}
      class="w-full overflow-hidden rounded-lg border border-border bg-surface text-foreground shadow-sm shadow-shadow/30"
    >
      <Accordion.Item value="content" class="bg-surface data-open:bg-surface">
        <Accordion.Trigger
          level={4}
          class="flex w-full items-center gap-x-2 gap-y-1 border-0 border-b border-border px-3 py-2 text-sm font-normal no-underline hover:bg-surface-hover hover:no-underline"
        >
          <span class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
            <span class="font-semibold">{systemTitle}</span>
            {#if systemSubtitle}
              <span class="min-w-0 truncate font-mono text-muted-foreground">
                {systemSubtitle}
              </span>
            {/if}
          </span>
        </Accordion.Trigger>

        <Accordion.Content>
          <div class="flex flex-col gap-3 px-3 py-3">
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
                <MessagePartComponent part={item.part} monospace={true} />
              {/if}
            {/each}
          </div>
        </Accordion.Content>
      </Accordion.Item>
    </Accordion.Root>
    {:else}
    <div>
      {#each renderParts as item}
        <div class="assistant-transcript-item" data-transcript-kind={transcriptItemKind(item)}>
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
        </div>
      {/each}
    </div>
    {/if}
  </div>
{/if}

<style>
  .assistant-transcript-item + .assistant-transcript-item {
    margin-top: 0.75rem;
  }

  .assistant-transcript-item[data-transcript-kind='tool']
    + .assistant-transcript-item[data-transcript-kind='tool'] {
    margin-top: 0.5rem;
  }

  .assistant-transcript-item[data-transcript-kind='tool']
    + .assistant-transcript-item:not([data-transcript-kind='tool']),
  .assistant-transcript-item:not([data-transcript-kind='tool'])
    + .assistant-transcript-item[data-transcript-kind='tool'] {
    margin-top: 1.25rem;
  }
</style>
