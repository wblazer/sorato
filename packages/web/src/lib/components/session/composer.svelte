<script lang="ts">
  import { Button } from '$lib/components/ui/button/index.js'
  import * as Item from '$lib/components/ui/item/index.js'
  import * as Tooltip from '$lib/components/ui/tooltip/index.js'
  import { tick } from 'svelte'
  import { Textarea } from '$lib/components/ui/textarea/index.js'
  import * as Select from '$lib/components/ui/select/index.js'
  import {
    pushComposerHistory,
    readComposerDraft,
    readComposerHistory,
    writeComposerDraft,
  } from '$lib/composer-storage.js'
  import type {
    AvailableModel,
    MessageNode,
    ModelOptions,
    SessionRunStatus,
  } from '$lib/types.js'
  import ArrowUpIcon from 'phosphor-svelte/lib/ArrowUpIcon'
  import PlusIcon from 'phosphor-svelte/lib/PlusIcon'
  import StopIcon from 'phosphor-svelte/lib/StopIcon'
  import XIcon from 'phosphor-svelte/lib/XIcon'
  import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircleIcon'
  import ModelSelector from './model-selector.svelte'
  import SessionTokenUsage from './session-token-usage.svelte'

  let {
    onSend,
    onStop,
    onAttach,
    onDismissStatus,
    onModelChange,
    models = [],
    model = null,
    modelOptions = {},
    modelLoading = false,
    modelDisabled = false,
    isRunning = false,
    isStopping = false,
    disabled = false,
    autoFocus = false,
    focusKey,
    draftStorageKey,
    historyStorageKey,
    draftText,
    draftKey,
    placeholder,
    sessionStatus = null,
    tokenUsageMessages = [],
  }: {
    onSend: (input: string) => boolean | Promise<boolean>
    onStop?: () => void
    onAttach?: () => void
    onDismissStatus?: () => void
    onModelChange?: (value: string, options?: ModelOptions) => void
    models?: ReadonlyArray<AvailableModel>
    model?: string | null
    modelOptions?: ModelOptions
    modelLoading?: boolean
    modelDisabled?: boolean
    isRunning?: boolean
    isStopping?: boolean
    disabled?: boolean
    autoFocus?: boolean
    focusKey?: string | number | null
    draftStorageKey?: string | null
    historyStorageKey?: string | null
    draftText?: string
    draftKey?: string | number | null
    placeholder?: string
    sessionStatus?: SessionRunStatus | null
    tokenUsageMessages?: ReadonlyArray<MessageNode>
  } = $props()

  let input = $state('')
  let textarea: HTMLTextAreaElement | null = $state(null)
  let now = $state(Date.now())
  let loadedDraftStorageKey = $state<string | null>(null)
  let historyIndex = $state(-1)
  let savedHistoryDraft = $state<string | null>(null)
  let submitting = $state(false)

  const selectedModel = $derived(
    models.find((item) => item.id === model) ?? null,
  )
  const thinkingLevel = $derived(
    modelOptions.thinkingLevel ?? selectedModel?.capabilities.thinkingLevels[0],
  )
  const selectedMode = $derived(modelOptions.mode)
  const retrySeconds = $derived(
    sessionStatus?._tag === 'retrying'
      ? Math.max(0, Math.ceil((sessionStatus.retryAt - now) / 1000))
      : null,
  )
  const status = $derived(
    sessionStatus?._tag === 'failed'
      ? {
          variant: 'danger' as const,
          title: sessionStatus.title,
          description: sessionStatus.message,
          dismissible: true,
        }
      : sessionStatus?._tag === 'retrying'
        ? {
            variant: 'muted' as const,
            title: sessionStatus.title,
            description: `Retrying in ${retrySeconds ?? 0}s (${sessionStatus.attempt}/${sessionStatus.maxAttempts}).`,
            dismissible: false,
          }
        : isStopping
          ? {
              variant: 'muted' as const,
              title: 'Stopping current run',
              description:
                'Waiting for the server to confirm the stop request.',
              dismissible: false,
            }
          : null,
  )

  function selectThinking(level: NonNullable<ModelOptions['thinkingLevel']>) {
    if (!model) return
    onModelChange?.(model, {
      ...modelOptions,
      thinkingLevel: level,
    })
  }

  function selectMode(mode: string | undefined) {
    if (!model) return
    const next = { ...modelOptions, mode }
    if (!mode) delete next.mode
    onModelChange?.(model, next)
  }

  function resetHistoryNavigation() {
    historyIndex = -1
    savedHistoryDraft = null
  }

  function setInput(value: string, options?: { persist?: boolean }) {
    input = value
    if (options?.persist !== false) writeComposerDraft(draftStorageKey, value)
  }

  async function handleSubmit() {
    const trimmed = input.trim()
    if (!trimmed || disabled || submitting) return

    submitting = true
    try {
      const sent = await onSend(trimmed)
      if (!sent) return

      pushComposerHistory(historyStorageKey, trimmed)
      resetHistoryNavigation()
      setInput('')
    } finally {
      submitting = false
    }
  }

  function canNavigateHistory(direction: 'up' | 'down') {
    if (!textarea) return false
    if (textarea.selectionStart !== textarea.selectionEnd) return false

    const cursor = textarea.selectionStart
    if (historyIndex >= 0) {
      return direction === 'up' ? cursor === 0 : cursor === input.length
    }

    return direction === 'up'
      ? cursor === 0 && input.length === 0
      : cursor === input.length
  }

  function applyHistoryValue(value: string, cursor: 'start' | 'end') {
    setInput(value)
    tick().then(() => {
      if (!textarea) return
      const offset = cursor === 'start' ? 0 : textarea.value.length
      textarea.focus()
      textarea.setSelectionRange(offset, offset)
    })
  }

  function navigateHistory(direction: 'up' | 'down') {
    const history = readComposerHistory(historyStorageKey)
    if (direction === 'up') {
      if (history.length === 0) return false

      if (historyIndex === -1) {
        savedHistoryDraft = input
        historyIndex = 0
        applyHistoryValue(history[0] ?? '', 'start')
        return true
      }

      if (historyIndex < history.length - 1) {
        historyIndex += 1
        applyHistoryValue(history[historyIndex] ?? '', 'start')
        return true
      }

      return false
    }

    if (historyIndex > 0) {
      historyIndex -= 1
      applyHistoryValue(history[historyIndex] ?? '', 'end')
      return true
    }

    if (historyIndex === 0) {
      const draft = savedHistoryDraft ?? ''
      resetHistoryNavigation()
      applyHistoryValue(draft, 'end')
      return true
    }

    return false
  }

  function handleKeydown(e: KeyboardEvent) {
    if (
      (e.key === 'ArrowUp' || e.key === 'ArrowDown') &&
      !e.altKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      canNavigateHistory(e.key === 'ArrowUp' ? 'up' : 'down') &&
      navigateHistory(e.key === 'ArrowUp' ? 'up' : 'down')
    ) {
      e.preventDefault()
      return
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSubmit()
    }
  }

  function handleInput(e: Event) {
    resetHistoryNavigation()
    setInput((e.currentTarget as HTMLTextAreaElement).value)
  }

  $effect(() => {
    if (draftStorageKey === loadedDraftStorageKey) return
    loadedDraftStorageKey = draftStorageKey ?? null
    resetHistoryNavigation()
    setInput(readComposerDraft(draftStorageKey) ?? '', { persist: false })
  })

  $effect(() => {
    focusKey
    if (!autoFocus || disabled) return

    tick().then(() => {
      if (!disabled) textarea?.focus()
    })
  })

  $effect(() => {
    if (draftKey === undefined || draftKey === null) return
    resetHistoryNavigation()
    setInput(draftText ?? '')

    tick().then(() => {
      if (disabled) return
      textarea?.focus()
      const end = textarea?.value.length ?? 0
      textarea?.setSelectionRange(end, end)
    })
  })

  $effect(() => {
    if (sessionStatus?._tag !== 'retrying') return

    now = Date.now()
    const id = setInterval(() => {
      now = Date.now()
    }, 250)
    return () => clearInterval(id)
  })
</script>

<div class="bg-background pb-5 pt-0">
  <div class="mx-auto w-full max-w-6xl px-4 sm:px-6">
    <div class="relative">
      {#if status}
        <Item.Root
          variant={status.variant}
          size="xs"
          class="relative z-0 -mb-2 rounded-t-lg border-border px-3 pb-4 pt-2 shadow-sm shadow-shadow/30"
        >
          {#if status.variant === 'danger'}
            <Item.Media variant="icon">
              <WarningCircleIcon />
            </Item.Media>
          {/if}
          <Item.Content>
            <Item.Title>{status.title}</Item.Title>
            <Item.Description>{status.description}</Item.Description>
          </Item.Content>
          {#if status.dismissible}
            <Item.Actions class="ml-auto self-start">
              <Button
                variant="ghost-destructive"
                size="icon-sm"
                class="hover:bg-danger-muted-hover"
                onclick={onDismissStatus}
                aria-label="Dismiss error"
              >
                <XIcon />
              </Button>
            </Item.Actions>
          {/if}
        </Item.Root>
      {/if}

      <Textarea
        bind:ref={textarea}
        bind:value={input}
        onkeydown={handleKeydown}
        oninput={handleInput}
        {disabled}
        {placeholder}
        rows={1}
        class="no-scrollbar relative z-10 min-h-[32px] w-full max-h-[220px] rounded-lg scroll-pb-4 overflow-y-auto border border-border bg-surface px-4 py-4 shadow-sm shadow-shadow/30 outline-none focus-visible:border-ring focus-visible:ring-0 md:text-sm"
      />

      <div
        class="relative -mt-2 flex w-full flex-wrap items-center gap-2 rounded-b-lg border border-border bg-background px-1 pb-1 pt-3 text-muted-foreground shadow-sm shadow-shadow/30 sm:flex-nowrap"
      >
        <div class="flex min-w-0 flex-1 items-center gap-1">
          <Tooltip.Root>
            <Tooltip.Trigger>
              {#snippet child({ props })}
                <Button
                  onclick={onAttach}
                  type="button"
                  variant="ghost"
                  size="icon"
                  class="shrink-0 text-muted-foreground"
                  aria-label="Attach file"
                  {disabled}
                  {...props}
                >
                  <PlusIcon />
                </Button>
              {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content>Attach file</Tooltip.Content>
          </Tooltip.Root>

          <div class="min-w-0 max-w-[min(20rem,60vw)]">
            <ModelSelector
              {models}
              value={model}
              loading={modelLoading}
              disabled={disabled || modelDisabled}
              onChange={onModelChange}
            />
          </div>

          {#if selectedModel?.capabilities.reasoning}
            <Select.Root
              type="single"
              value={thinkingLevel}
              onValueChange={(value) =>
                selectThinking(
                  value as NonNullable<ModelOptions['thinkingLevel']>,
                )}
            >
              <Tooltip.Root>
                <Tooltip.Trigger>
                  {#snippet child({ props })}
                    <Select.Trigger
                      class="shrink-0 border-transparent bg-transparent capitalize shadow-none hover:bg-base-hover"
                      disabled={disabled || modelDisabled}
                      {...props}
                    >
                      Think: {thinkingLevel}
                    </Select.Trigger>
                  {/snippet}
                </Tooltip.Trigger>
                <Tooltip.Content>Select thinking level</Tooltip.Content>
              </Tooltip.Root>
              <Select.Content class="w-48" align="start">
                <Select.Label>Thinking</Select.Label>
                {#each selectedModel.capabilities.thinkingLevels as level}
                  <Select.Item value={level} label={level} class="capitalize" />
                {/each}
              </Select.Content>
            </Select.Root>
          {/if}

          {#if selectedModel && selectedModel.capabilities.modes.length > 0}
            <Select.Root
              type="single"
              value={selectedMode ?? 'default'}
              onValueChange={(value) =>
                selectMode(value === 'default' ? undefined : value)}
            >
              <Tooltip.Root>
                <Tooltip.Trigger>
                  {#snippet child({ props })}
                    <Select.Trigger
                      class="shrink-0 border-transparent bg-transparent capitalize shadow-none hover:bg-base-hover"
                      disabled={disabled || modelDisabled}
                      {...props}
                    >
                      Mode: {selectedMode ?? 'default'}
                    </Select.Trigger>
                  {/snippet}
                </Tooltip.Trigger>
                <Tooltip.Content>Select model mode</Tooltip.Content>
              </Tooltip.Root>
              <Select.Content class="w-48" align="start">
                <Select.Label>Mode</Select.Label>
                <Select.Item value="default" label="Default" />
                {#each selectedModel.capabilities.modes as mode}
                  <Select.Item value={mode} label={mode} class="capitalize" />
                {/each}
              </Select.Content>
            </Select.Root>
          {/if}
        </div>

        <div class="flex shrink-0 items-center gap-2">
          <SessionTokenUsage messages={tokenUsageMessages} {models} />

          {#if isRunning}
            <Button
              onclick={onStop}
              disabled={isStopping}
              variant="destructive"
              size="icon-lg"
              aria-label={isStopping ? 'Stopping...' : 'Stop'}
              aria-busy={isStopping}
            >
              <StopIcon weight="fill" />
            </Button>
          {:else}
            <Button
              onclick={handleSubmit}
              disabled={disabled || submitting || !input.trim()}
              size="icon-lg"
              aria-label="Send message"
            >
              <ArrowUpIcon />
            </Button>
          {/if}
        </div>
      </div>
    </div>
  </div>
</div>
