<script lang="ts">
  import { onDestroy } from 'svelte'
  import type { MessageNode, ModelCall } from '$lib/types.js'
  import { clientSettingsStore } from '$lib/stores/client-settings.svelte.js'
  import {
    messageParts,
    persistedSources,
    projectTranscript,
    type TranscriptItem,
  } from '$lib/transcript.js'
  import { Button } from '$lib/components/ui/button/index.js'
  import * as Tooltip from '$lib/components/ui/tooltip/index.js'
  import { createTimedAction } from '$lib/timed-action.svelte.js'
  import CheckIcon from 'phosphor-svelte/lib/CheckIcon'
  import CopyIcon from 'phosphor-svelte/lib/CopyIcon'
  import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimpleIcon'
  import AssistantTranscript from './assistant-transcript.svelte'
  import MessagePartComponent from './message-part.svelte'
  import SystemTranscript from './system-transcript.svelte'
  import ToolCallResult from './tool-call-result.svelte'

  let {
    message,
    transcriptItems,
    modelCall = message.modelCall,
    accordionState,
    accordionKey,
    onEditRetry,
  }: {
    message: MessageNode
    transcriptItems?: ReadonlyArray<TranscriptItem>
    modelCall?: ModelCall | null
    accordionState: Record<string, string[]>
    accordionKey: string
    onEditRetry?: (message: MessageNode, text: string) => void
  } = $props()

  const role = $derived(message.encoded.role)

  /** Normalize content to an array of parts for uniform rendering. */
  const parts = $derived(messageParts(message))

  const renderParts = $derived.by(
    (): ReadonlyArray<TranscriptItem> =>
      transcriptItems ??
      projectTranscript(persistedSources([message]), {
        pretty: clientSettingsStore.prettyTranscript,
      }),
  )

  const isUser = $derived(role === 'user')
  const isSystem = $derived(role === 'system')
  const isAssistant = $derived(role === 'assistant')
  let copyTooltipOpen = $state(false)
  const userText = $derived(
    parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n\n'),
  )
  const userTimestamp = $derived(formatTimestamp(message.createdAt))
  const canEditRetry = $derived(
    isUser && !!onEditRetry && userText.trim().length > 0,
  )
  const canCopy = $derived(isUser && userText.trim().length > 0)
  const copyAction = createTimedAction({
    successFor: 1200,
    run: async () => {
      if (!canCopy) return
      await navigator.clipboard.writeText(userText)
    },
  })
  const copied = $derived(copyAction.state === 'success')
  const isInterruption = $derived(
    renderParts.length === 1 && renderParts[0]?.type === 'interruption',
  )
  const systemTitle = $derived(
    message.encoded.role === 'system'
      ? (message.encoded.display?.title ?? 'System')
      : 'System',
  )
  const systemSubtitle = $derived(
    message.encoded.role === 'system'
      ? message.encoded.display?.subtitle
      : undefined,
  )

  const itemAccordionKey = (item: TranscriptItem, index: number): string => {
    if (item.type === 'combined-tool')
      return `${accordionKey}:tool:${item.call.id}`
    if (item.type === 'message' && 'id' in item.part) {
      return `${accordionKey}:part:${item.part.id}`
    }
    return `${accordionKey}:item:${index}`
  }

  function formatTimestamp(value: number): string {
    if (!Number.isFinite(value)) return ''
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(value))
  }

  function handleCopy() {
    if (!canCopy) return
    void copyAction.run().catch(() => {
      copyTooltipOpen = false
    })
  }

  function handleEditRetry() {
    if (!canEditRetry) return
    onEditRetry?.(message, userText)
  }

  $effect(() => {
    if (copyAction.state === 'success') {
      copyTooltipOpen = true
    } else if (copyAction.state === 'idle') {
      copyTooltipOpen = false
    }
  })

  onDestroy(() => {
    copyAction.reset()
  })
</script>

{#if renderParts.length > 0}
  <div
    class={isAssistant
      ? ''
      : isSystem
        ? 'flex flex-col gap-2 py-1'
        : 'flex flex-col gap-2 pt-2.5 pb-1'}
  >
    {#if isInterruption}
      <div
        class="flex items-center gap-3 py-1 text-sm font-medium text-muted-foreground"
      >
        <div class="h-px flex-1 bg-border"></div>
        <span>Interrupted</span>
        <div class="h-px flex-1 bg-border"></div>
      </div>
    {:else if parts.length === 0}
      <span class="text-xs italic text-muted-foreground">(empty)</span>
    {:else if isUser}
      <div class="group/user-message flex w-full flex-col items-end">
        <div
          class="ml-auto w-fit max-w-[min(42rem,85%)] rounded-lg border border-accent bg-accent text-accent-foreground shadow-sm shadow-shadow/30"
        >
          <div class="flex flex-col gap-3 px-3 py-3">
            {#each renderParts as item, index}
              {#if item.type === 'combined-tool'}
                <ToolCallResult
                  call={item.call}
                  result={item.result}
                  {accordionState}
                  accordionKey={itemAccordionKey(item, index)}
                />
              {:else if item.type === 'interruption'}
                <div
                  class="flex items-center gap-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground"
                >
                  <div class="h-px flex-1 bg-border"></div>
                  <span>Interrupted</span>
                  <div class="h-px flex-1 bg-border"></div>
                </div>
              {:else}
                <MessagePartComponent
                  part={item.part}
                  monospace={false}
                  {accordionState}
                  accordionKey={itemAccordionKey(item, index)}
                />
              {/if}
            {/each}
          </div>
        </div>

        <div
          class="mt-1 flex min-h-6 max-w-[min(42rem,85%)] items-center justify-end gap-1 text-xs text-muted-foreground opacity-0 transition-opacity duration-150 group-hover/user-message:opacity-100 focus-within:opacity-100"
        >
          {#if userTimestamp}
            <span class="mr-1 cursor-default select-none tabular-nums"
              >{userTimestamp}</span
            >
          {/if}

          {#if canEditRetry}
            <Tooltip.Root>
              <Tooltip.Trigger>
                {#snippet child({ props })}
                  <Button
                    {...props}
                    variant="ghost"
                    size="icon-xs"
                    class="text-muted-foreground hover:text-foreground"
                    aria-label="Edit and retry"
                    onclick={handleEditRetry}
                  >
                    <PencilSimpleIcon />
                  </Button>
                {/snippet}
              </Tooltip.Trigger>
              <Tooltip.Content>Edit and retry</Tooltip.Content>
            </Tooltip.Root>
          {/if}

          {#if canCopy}
            <Tooltip.Root bind:open={copyTooltipOpen}>
              <Tooltip.Trigger>
                {#snippet child({ props })}
                  <Button
                    {...props}
                    variant="ghost"
                    size="icon-xs"
                    class="text-muted-foreground hover:text-foreground"
                    aria-label={copied ? 'Copied' : 'Copy message'}
                    onclick={handleCopy}
                  >
                    {#if copied}
                      <CheckIcon />
                    {:else}
                      <CopyIcon />
                    {/if}
                  </Button>
                {/snippet}
              </Tooltip.Trigger>
              <Tooltip.Content
                >{copied ? 'Copied' : 'Copy message'}</Tooltip.Content
              >
            </Tooltip.Root>
          {/if}
        </div>
      </div>
    {:else if isSystem}
      <SystemTranscript
        items={renderParts}
        title={systemTitle}
        subtitle={systemSubtitle}
        defaultOpen={clientSettingsStore.expandSystemMessagesByDefault}
        {accordionState}
        accordionKey={`${accordionKey}:system`}
      />
    {:else}
      <AssistantTranscript
        items={renderParts}
        {modelCall}
        {accordionState}
        {accordionKey}
      />
    {/if}
  </div>
{/if}
