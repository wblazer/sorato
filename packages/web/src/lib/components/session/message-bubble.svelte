<script lang="ts">
  import { onDestroy } from 'svelte'
  import type {
    FilePart,
    MessageNode,
    MessagePart,
    ModelCall,
  } from '$lib/types.js'
  import { clientSettingsStore } from '$lib/stores/client-settings.svelte.js'
  import {
    messageParts,
    persistedSources,
    projectTranscript,
    type TranscriptItem,
  } from '$lib/transcript.js'
  import { Button } from '$lib/components/ui/button/index.js'
  import * as Tooltip from '$lib/components/ui/tooltip/index.js'
  import * as Dialog from '$lib/components/ui/dialog/index.js'
  import { createTimedAction } from '$lib/timed-action.svelte.js'
  import CheckIcon from 'phosphor-svelte/lib/CheckIcon'
  import CopyIcon from 'phosphor-svelte/lib/CopyIcon'
  import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimpleIcon'
  import AssistantTranscript from './assistant-transcript.svelte'
  import MessagePartComponent from './message-part.svelte'
  import { roleIcons } from './message-icons.js'
  import SystemTranscript from './system-transcript.svelte'
  import ToolCallResult from './tool-call-result.svelte'

  let {
    message,
    transcriptItems,
    modelCall = message.modelCall,
    isRunning = false,
    accordionState,
    accordionKey,
    onEditRetry,
  }: {
    message: MessageNode
    transcriptItems?: ReadonlyArray<TranscriptItem>
    modelCall?: ModelCall | null
    isRunning?: boolean
    accordionState: Record<string, string[]>
    accordionKey: string
    onEditRetry?: (message: MessageNode, text: string) => void
  } = $props()

  const role = $derived(message.encoded.role)
  const isPrettySummary = $derived(
    clientSettingsStore.prettyTranscript &&
      message.encoded.role === 'user' &&
      message.encoded.source === 'summary',
  )

  /** Normalize content to an array of parts for uniform rendering. */
  const parts = $derived(messageParts(message))

  const renderParts = $derived.by((): ReadonlyArray<TranscriptItem> => {
    if (transcriptItems !== undefined) return transcriptItems
    const summaryContent =
      message.encoded.role === 'user'
        ? message.encoded.metadata?.summary?.content
        : undefined
    if (isPrettySummary && summaryContent !== undefined) {
      return projectTranscript(
        [
          {
            type: 'persisted',
            message,
            part: { type: 'text', text: summaryContent },
          },
        ],
        { pretty: true },
      )
    }

    return projectTranscript(persistedSources([message]), {
      pretty: clientSettingsStore.prettyTranscript,
    })
  })

  const isUser = $derived(role === 'user')
  const isSystem = $derived(role === 'system')
  const isAssistant = $derived(role === 'assistant')
  let copyTooltipOpen = $state(false)
  let previewOpen = $state(false)
  let previewImage = $state<FilePart | null>(null)
  const userText = $derived(
    parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n\n'),
  )
  const userTimestamp = $derived(formatTimestamp(message.createdAt))
  const canEditRetry = $derived(
    isUser && !isPrettySummary && !!onEditRetry && userText.trim().length > 0,
  )
  const canCopy = $derived(
    isUser && !isPrettySummary && userText.trim().length > 0,
  )
  const userImageParts = $derived(
    parts.filter((part): part is FilePart => isImagePart(part)),
  )
  const userRenderParts = $derived(
    renderParts.filter(
      (item) => item.type !== 'message' || !isImagePart(item.part),
    ),
  )
  const copyAction = createTimedAction({
    successFor: 1200,
    run: async () => {
      if (!canCopy) return
      await navigator.clipboard.writeText(userText)
    },
  })
  const copied = $derived(copyAction.state === 'success')
  const assistantInterrupted = $derived(
    message.encoded.role === 'assistant' &&
      message.encoded.metadata?.interrupted === true,
  )
  const userDisplay = $derived(
    message.encoded.role === 'user' ? message.encoded.display : undefined,
  )
  const systemDisplay = $derived(
    message.encoded.role === 'system' ? message.encoded.display : undefined,
  )
  const systemTitle = $derived(
    isPrettySummary
      ? (userDisplay?.title ?? 'Summary')
      : systemDisplay
        ? (systemDisplay.title ?? 'System')
        : 'System',
  )
  const systemSubtitle = $derived(
    isPrettySummary ? userDisplay?.subtitle : systemDisplay?.subtitle,
  )
  const systemIcon = $derived(
    isPrettySummary ? roleIcons.summary : roleIcons.system,
  )

  const itemAccordionKey = (item: TranscriptItem, index: number): string => {
    if (item.type === 'combined-tool') return `tool:${item.call.id}`
    if (item.type === 'message' && 'id' in item.part) {
      return `part:${item.part.type}:${item.part.id}`
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

  function isImagePart(part: MessagePart): part is FilePart {
    return (
      part.type === 'file' &&
      part.mediaType.startsWith('image/') &&
      typeof part.data === 'string'
    )
  }

  function openImagePreview(part: FilePart) {
    previewImage = part
    previewOpen = true
  }

  $effect(() => {
    if (!previewOpen) previewImage = null
  })

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
      : isSystem || isPrettySummary
        ? 'flex flex-col gap-2 py-1'
        : 'flex flex-col gap-2 pt-2.5 pb-1'}
  >
    {#if parts.length === 0}
      <span class="text-xs italic text-muted-foreground">(empty)</span>
    {:else if isUser && !isPrettySummary}
      <div class="group/user-message flex w-full flex-col items-end">
        {#if userImageParts.length > 0}
          <div
            class="mb-2 ml-auto flex max-w-[min(42rem,85%)] flex-wrap justify-end gap-2"
            aria-label="Message image attachments"
          >
            {#each userImageParts as part, index (`${part.fileName ?? 'image'}:${index}`)}
              <button
                type="button"
                class="size-16 cursor-zoom-in overflow-hidden rounded-lg border border-border bg-background outline-none ring-offset-background transition-[border-color,box-shadow] hover:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                aria-label={`Preview ${part.fileName ?? 'image attachment'}`}
                onclick={() => openImagePreview(part)}
              >
                <img src={part.data} alt="" class="size-full object-cover" />
              </button>
            {/each}
          </div>
        {/if}

        {#if userRenderParts.length > 0}
          <div
            class="ml-auto w-fit max-w-[min(42rem,85%)] rounded-lg border border-accent bg-accent text-accent-foreground shadow-sm shadow-shadow/30"
          >
            <div class="flex flex-col gap-3 px-3 py-3">
              {#each userRenderParts as item, index}
                {#if item.type === 'combined-tool'}
                  <ToolCallResult
                    call={item.call}
                    result={item.result}
                    {accordionState}
                    accordionKey={itemAccordionKey(item, index)}
                  />
                {:else if item.type === 'message'}
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
        {/if}

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
    {:else if isSystem || isPrettySummary}
      <SystemTranscript
        items={renderParts}
        title={systemTitle}
        subtitle={systemSubtitle}
        icon={systemIcon}
        defaultOpen={clientSettingsStore.expandSystemMessagesByDefault}
        {accordionState}
        accordionKey={`${accordionKey}:system`}
      />
    {:else}
      <AssistantTranscript
        items={renderParts}
        {modelCall}
        {isRunning}
        interrupted={assistantInterrupted}
        {accordionState}
        {accordionKey}
      />
    {/if}
  </div>
{/if}

<Dialog.Root bind:open={previewOpen}>
  <Dialog.Content
    class="w-fit max-w-[96vw] justify-items-center gap-2 bg-transparent p-0 shadow-none ring-0 sm:max-w-[96vw] [&_[data-slot='dialog-close']>button]:bg-background/60 [&_[data-slot='dialog-close']>button]:backdrop-blur-sm"
  >
    {#if previewImage}
      <Dialog.Title class="sr-only"
        >Preview {previewImage.fileName ?? 'image attachment'}</Dialog.Title
      >
      <img
        src={previewImage.data}
        alt={previewImage.fileName ?? 'Image attachment'}
        class="max-h-[88vh] w-auto max-w-full rounded-lg object-contain"
      />
      {#if previewImage.fileName}
        <Dialog.Description
          class="truncate px-1 text-center text-xs text-muted-foreground"
        >
          {previewImage.fileName}
        </Dialog.Description>
      {/if}
    {/if}
  </Dialog.Content>
</Dialog.Root>
