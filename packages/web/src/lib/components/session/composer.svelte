<script lang="ts">
  import { Button } from '$lib/components/ui/button/index.js'
  import * as Item from '$lib/components/ui/item/index.js'
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js'
  import * as Tooltip from '$lib/components/ui/tooltip/index.js'
  import * as Dialog from '$lib/components/ui/dialog/index.js'
  import { tick } from 'svelte'
  import { Textarea } from '$lib/components/ui/textarea/index.js'
  import * as Select from '$lib/components/ui/select/index.js'
  import {
    pushComposerHistory,
    readComposerDraft,
    readComposerDraftAttachments,
    readComposerHistory,
    writeComposerDraft,
    writeComposerDraftAttachments,
  } from '$lib/composer-storage.js'
  import type {
    AvailableModel,
    MessageNode,
    ModelOptions,
    RunAttachment,
    SessionRunStatus,
  } from '$lib/types.js'
  import ArrowUpIcon from 'phosphor-svelte/lib/ArrowUpIcon'
  import PlusIcon from 'phosphor-svelte/lib/PlusIcon'
  import StopIcon from 'phosphor-svelte/lib/StopIcon'
  import XIcon from 'phosphor-svelte/lib/XIcon'
  import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircleIcon'
  import ModelSelector from './model-selector.svelte'
  import SessionTokenUsage from './session-token-usage.svelte'

  type FileReferenceResult = {
    readonly path: string
    readonly name: string
    readonly type: 'directory' | 'file'
    readonly score?: number
  }

  type ComposerAttachment = RunAttachment & { readonly id: string }

  const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024

  let {
    onSend,
    onStop,
    onAttach,
    onFileSearch,
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
    onSend: (
      input: string,
      attachments: ReadonlyArray<RunAttachment>,
    ) => boolean | Promise<boolean>
    onStop?: () => void
    onAttach?: () => void
    onFileSearch?: (
      query: string,
    ) => Promise<ReadonlyArray<FileReferenceResult>>
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
  let fileInput: HTMLInputElement | null = $state(null)
  let fileResultsViewport: HTMLElement | null = $state(null)
  let now = $state(Date.now())
  let loadedDraftStorageKey = $state<string | null>(null)
  let historyIndex = $state(-1)
  let savedHistoryDraft = $state<string | null>(null)
  let submitting = $state(false)
  let mentionOpen = $state(false)
  let mentionQuery = $state('')
  let mentionStart = $state(0)
  let mentionEnd = $state(0)
  let fileResults = $state<ReadonlyArray<FileReferenceResult>>([])
  let fileSearchLoading = $state(false)
  let fileSearchError = $state<string | null>(null)
  let selectedFileIndex = $state(0)
  let fileSearchRequest = 0
  let attachments = $state<ReadonlyArray<ComposerAttachment>>([])
  let attachmentError = $state<string | null>(null)
  let previewAttachment = $state<ComposerAttachment | null>(null)
  let previewOpen = $state(false)

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

  function resetMention() {
    fileSearchRequest += 1
    mentionOpen = false
    mentionQuery = ''
    fileResults = []
    fileSearchError = null
    selectedFileIndex = 0
  }

  function setInput(value: string, options?: { persist?: boolean }) {
    input = value
    if (options?.persist !== false) writeComposerDraft(draftStorageKey, value)
  }

  function setAttachments(
    value: ReadonlyArray<ComposerAttachment>,
    options?: { persist?: boolean },
  ) {
    attachments = value
    if (options?.persist !== false) {
      writeComposerDraftAttachments(
        draftStorageKey,
        value.map(({ mediaType, fileName, data, size }) => ({
          mediaType,
          fileName,
          data,
          size,
        })),
      )
    }
  }

  function runAttachments() {
    return attachments.map(({ mediaType, fileName, data, size }) => ({
      mediaType,
      fileName,
      data,
      size,
    }))
  }

  function syncMention() {
    if (!textarea || disabled) {
      resetMention()
      return
    }

    const cursor = textarea.selectionStart
    if (cursor !== textarea.selectionEnd) {
      resetMention()
      return
    }

    const beforeCursor = input.slice(0, cursor)
    const match = beforeCursor.match(/(?:^|\s)@([^\s@]*)$/)
    if (!match?.[1] && !beforeCursor.endsWith('@')) {
      resetMention()
      return
    }

    mentionOpen = true
    mentionQuery = match?.[1] ?? ''
    mentionStart = cursor - mentionQuery.length - 1
    mentionEnd = cursor
  }

  function insertFileReference(result: FileReferenceResult) {
    const after = input.slice(mentionEnd)
    const suffix = /^\s/.test(after) ? '' : ' '
    const next = `${input.slice(0, mentionStart)}@${result.path}${suffix}${after}`
    const cursor = mentionStart + result.path.length + 1 + suffix.length

    setInput(next)
    resetMention()
    tick().then(() => {
      textarea?.focus()
      textarea?.setSelectionRange(cursor, cursor)
    })
  }

  function drillIntoDirectory(result: FileReferenceResult) {
    const path = result.path.endsWith('/') ? result.path : `${result.path}/`
    const after = input.slice(mentionEnd)
    const next = `${input.slice(0, mentionStart)}@${path}${after}`
    const cursor = mentionStart + path.length + 1

    setInput(next)
    mentionOpen = true
    mentionQuery = path
    mentionEnd = cursor
    fileResults = []
    selectedFileIndex = 0

    tick().then(() => {
      textarea?.focus()
      textarea?.setSelectionRange(cursor, cursor)
    })
  }

  function scrollFileIndexIntoView(index: number) {
    fileResultsViewport
      ?.querySelector<HTMLElement>(`[data-file-reference-index="${index}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }

  function selectFileIndex(index: number, options?: { scroll?: boolean }) {
    selectedFileIndex = index
    if (options?.scroll === false) return
    tick().then(() => scrollFileIndexIntoView(index))
  }

  async function handleSubmit() {
    const trimmed = input.trim()
    if (
      (trimmed.length === 0 && attachments.length === 0) ||
      disabled ||
      submitting
    )
      return

    submitting = true
    try {
      const sent = await onSend(trimmed, runAttachments())
      if (!sent) return

      if (trimmed.length > 0) pushComposerHistory(historyStorageKey, trimmed)
      resetHistoryNavigation()
      setInput('')
      setAttachments([])
      attachmentError = null
      previewAttachment = null
      previewOpen = false
    } finally {
      submitting = false
    }
  }

  function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  function readFileAsDataUrl(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        if (typeof reader.result === 'string') resolve(reader.result)
        else reject(new Error('File could not be read.'))
      }
      reader.onerror = () =>
        reject(reader.error ?? new Error('File could not be read.'))
      reader.readAsDataURL(file)
    })
  }

  async function addFiles(files: Iterable<File>) {
    const next: ComposerAttachment[] = []
    attachmentError = null

    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        attachmentError = 'Only image attachments are supported right now.'
        continue
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        attachmentError = `${file.name} is larger than ${formatBytes(MAX_ATTACHMENT_BYTES)}.`
        continue
      }

      next.push({
        id: crypto.randomUUID(),
        fileName: file.name || 'pasted-image.png',
        mediaType: file.type || 'application/octet-stream',
        data: await readFileAsDataUrl(file),
        size: file.size,
      })
    }

    if (next.length > 0) setAttachments([...attachments, ...next])
  }

  function addSelectedImages(selected: ReadonlyArray<RunAttachment>) {
    const next: ComposerAttachment[] = []
    attachmentError = null

    for (const image of selected) {
      if (!image.mediaType.startsWith('image/')) {
        attachmentError = 'Only image attachments are supported right now.'
        continue
      }
      if (image.size > MAX_ATTACHMENT_BYTES) {
        attachmentError = `${image.fileName} is larger than ${formatBytes(MAX_ATTACHMENT_BYTES)}.`
        continue
      }
      next.push({ ...image, id: crypto.randomUUID() })
    }

    if (next.length > 0) setAttachments([...attachments, ...next])
  }

  function removeAttachment(id: string) {
    setAttachments(attachments.filter((attachment) => attachment.id !== id))
    if (previewAttachment?.id === id) {
      previewAttachment = null
      previewOpen = false
    }
  }

  function openAttachmentPreview(attachment: ComposerAttachment) {
    previewAttachment = attachment
    previewOpen = true
  }

  async function handleAttachClick() {
    onAttach?.()
    if (window.soratoDesktop?.selectImages) {
      addSelectedImages(await window.soratoDesktop.selectImages())
      return
    }
    fileInput?.click()
  }

  function handleFileChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    if (input.files) void addFiles(input.files)
    input.value = ''
  }

  function handlePaste(event: ClipboardEvent) {
    const files = Array.from(event.clipboardData?.files ?? [])
    if (files.length === 0) return
    event.preventDefault()
    void addFiles(files)
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
    if (mentionOpen) {
      if (e.key === 'Escape') {
        e.preventDefault()
        resetMention()
        return
      }

      if (fileResults.length > 0 && e.key === 'ArrowDown') {
        e.preventDefault()
        selectFileIndex((selectedFileIndex + 1) % fileResults.length)
        return
      }

      if (fileResults.length > 0 && e.key === 'ArrowUp') {
        e.preventDefault()
        selectFileIndex(
          (selectedFileIndex - 1 + fileResults.length) % fileResults.length,
        )
        return
      }

      if (
        fileResults.length > 0 &&
        (e.key === 'Enter' || e.key === 'Tab') &&
        !e.shiftKey
      ) {
        e.preventDefault()
        const result = fileResults[selectedFileIndex]
        if (e.key === 'Tab' && result.type === 'directory') {
          drillIntoDirectory(result)
          return
        }

        insertFileReference(result)
        return
      }
    }

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
    syncMention()
  }

  function handleClick() {
    syncMention()
  }

  function handleKeyup(e: KeyboardEvent) {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === 'Tab') return
    syncMention()
  }

  function fileSearchErrorMessage(error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'message' in error &&
      typeof error.message === 'string'
    ) {
      return error.message
    }

    return 'File search failed.'
  }

  function pathLeaf(path: string) {
    const normalized = path.replace(/\/$/, '')
    return normalized.slice(normalized.lastIndexOf('/') + 1)
  }

  function pathPrefix(path: string) {
    const normalized = path.replace(/\/$/, '')
    const slash = normalized.lastIndexOf('/')
    return slash === -1 ? '' : normalized.slice(0, slash + 1)
  }

  function fileIconColor(result: FileReferenceResult) {
    if (result.type === 'directory') return 'var(--color-warning)'

    const extension = pathLeaf(result.path).split('.').pop()?.toLowerCase()
    if (!extension || extension === pathLeaf(result.path).toLowerCase()) {
      return 'var(--color-muted-foreground)'
    }

    if (['ts', 'tsx', 'js', 'jsx', 'svelte'].includes(extension)) {
      return 'var(--color-ring)'
    }
    if (['css', 'scss', 'html'].includes(extension))
      return 'var(--color-success)'
    if (['json', 'md', 'yaml', 'yml', 'toml'].includes(extension)) {
      return 'var(--color-warning)'
    }
    return 'var(--color-muted-foreground)'
  }

  $effect(() => {
    if (draftStorageKey === loadedDraftStorageKey) return
    loadedDraftStorageKey = draftStorageKey ?? null
    resetHistoryNavigation()
    setInput(readComposerDraft(draftStorageKey) ?? '', { persist: false })
    setAttachments(
      readComposerDraftAttachments(draftStorageKey).map((attachment) => ({
        ...attachment,
        id: crypto.randomUUID(),
      })),
      { persist: false },
    )
    attachmentError = null
    previewAttachment = null
    previewOpen = false
    resetMention()
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
    setAttachments([])
    resetMention()

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

  $effect(() => {
    if (!previewOpen) previewAttachment = null
  })

  $effect(() => {
    const query = mentionQuery
    const open = mentionOpen
    const search = onFileSearch

    if (!open || !search) {
      fileSearchLoading = false
      fileResults = []
      fileSearchError = search ? null : 'File search is unavailable here.'
      return
    }

    const request = ++fileSearchRequest
    fileSearchLoading = true
    fileSearchError = null

    const id = setTimeout(() => {
      search(query)
        .then((results) => {
          if (request !== fileSearchRequest) return
          fileResults = results
          selectFileIndex(0, { scroll: false })
        })
        .catch((error) => {
          if (request !== fileSearchRequest) return
          fileResults = []
          fileSearchError = fileSearchErrorMessage(error)
        })
        .finally(() => {
          if (request !== fileSearchRequest) return
          fileSearchLoading = false
        })
    }, 80)

    return () => clearTimeout(id)
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

      {#if attachments.length > 0 || attachmentError}
        <div class="mb-2">
          {#if attachments.length > 0}
            <div
              class="flex w-full flex-wrap gap-2 py-1"
              role="group"
              aria-label="Message attachments"
            >
              {#each attachments as attachment (attachment.id)}
                <div class="group relative size-20 shrink-0 snap-start">
                  <button
                    type="button"
                    class="block size-full cursor-zoom-in overflow-hidden rounded-lg border border-border bg-background outline-none ring-offset-background transition-[border-color,box-shadow] hover:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    aria-label={`Preview ${attachment.fileName}`}
                    onclick={() => openAttachmentPreview(attachment)}
                  >
                    <img
                      src={attachment.data}
                      alt=""
                      class="size-full object-cover"
                    />
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    class="absolute -right-1.5 -top-1.5 size-5 rounded-full border border-border bg-popover text-popover-foreground opacity-0 shadow-sm shadow-shadow/30 transition-opacity hover:bg-base-hover group-hover:opacity-100 focus-visible:opacity-100"
                    aria-label={`Remove ${attachment.fileName}`}
                    onclick={() => removeAttachment(attachment.id)}
                  >
                    <XIcon />
                  </Button>
                </div>
              {/each}
            </div>
          {/if}
          {#if attachmentError}
            <div class="px-1 pt-1 text-xs text-danger">{attachmentError}</div>
          {/if}
        </div>
      {/if}

      <Textarea
        bind:ref={textarea}
        bind:value={input}
        onkeydown={handleKeydown}
        oninput={handleInput}
        onpaste={handlePaste}
        onclick={handleClick}
        onkeyup={handleKeyup}
        {disabled}
        {placeholder}
        rows={1}
        class="no-scrollbar relative z-10 min-h-[32px] w-full max-h-[220px] rounded-lg scroll-pb-4 overflow-y-auto border border-border bg-surface px-4 py-4 shadow-sm shadow-shadow/30 outline-none focus-visible:border-ring focus-visible:ring-0 md:text-sm"
      />

      {#if mentionOpen}
        <div
          class="absolute inset-x-0 bottom-full z-30 mb-2 overflow-hidden rounded-lg border border-border bg-surface text-sm shadow-lg shadow-shadow/40 ring-1 ring-border/40"
        >
          {#if fileSearchLoading && fileResults.length === 0}
            <div class="px-3 py-2 text-muted-foreground">Finding files…</div>
          {:else if fileSearchError}
            <div class="px-3 py-2 text-danger">{fileSearchError}</div>
          {:else if fileResults.length === 0}
            <div class="px-3 py-2 text-muted-foreground">No files found</div>
          {:else}
            <ScrollArea
              orientation="vertical"
              class={fileResults.length > 8 ? 'h-72' : 'max-h-72'}
              viewportClass="scroll-mask-y scroll-mask-y-from-92% scroll-py-1 overscroll-contain"
              bind:viewportRef={fileResultsViewport}
            >
              <div class="p-1">
                {#each fileResults as result, index (result.path)}
                  {@const leaf = pathLeaf(result.path)}
                  {@const prefix = pathPrefix(result.path)}
                  <button
                    type="button"
                    data-file-reference-index={index}
                    data-file-reference-selected={index === selectedFileIndex}
                    class="group flex min-h-9 w-full min-w-0 cursor-default items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left outline-none"
                    class:bg-base-hover={index === selectedFileIndex}
                    onmousedown={(event) => event.preventDefault()}
                    onmousemove={() =>
                      selectFileIndex(index, { scroll: false })}
                    onclick={() => insertFileReference(result)}
                  >
                    <span
                      class="shrink-0 [&_svg]:size-4"
                      style:color={fileIconColor(result)}
                      aria-hidden="true"
                    >
                      {#if result.type === 'directory'}
                        <svg viewBox="0 0 24 24" fill="currentColor">
                          <path
                            d="M3 6.75A2.75 2.75 0 0 1 5.75 4h4.1c.73 0 1.43.29 1.94.8l1.2 1.2h5.26A2.75 2.75 0 0 1 21 8.75v6.5A2.75 2.75 0 0 1 18.25 18H5.75A2.75 2.75 0 0 1 3 15.25v-8.5Z"
                          />
                        </svg>
                      {:else}
                        <svg viewBox="0 0 24 24" fill="currentColor">
                          <path
                            d="M6.75 3A2.75 2.75 0 0 0 4 5.75v12.5A2.75 2.75 0 0 0 6.75 21h10.5A2.75 2.75 0 0 0 20 18.25V9.6c0-.73-.29-1.43-.8-1.94L15.34 3.8A2.75 2.75 0 0 0 13.4 3H6.75Zm7.5 1.8L18.2 8.75h-2.45a1.5 1.5 0 0 1-1.5-1.5V4.8Z"
                          />
                        </svg>
                      {/if}
                    </span>
                    <span
                      class="flex min-w-0 flex-1 items-baseline font-mono text-xs"
                    >
                      {#if prefix}
                        <span class="truncate text-muted-foreground"
                          >@{prefix}</span
                        >
                      {:else}
                        <span class="text-muted-foreground">@</span>
                      {/if}
                      <span class="shrink-0 text-foreground">{leaf}</span>
                    </span>
                  </button>
                {/each}
              </div>
            </ScrollArea>
          {/if}
        </div>
      {/if}

      <div
        class="relative -mt-2 flex w-full flex-wrap items-center gap-2 rounded-b-lg border border-border bg-background px-1 pb-1 pt-3 text-muted-foreground shadow-sm shadow-shadow/30 sm:flex-nowrap"
      >
        <div class="flex min-w-0 flex-1 items-center gap-1">
          <Tooltip.Root>
            <Tooltip.Trigger>
              {#snippet child({ props })}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  class="shrink-0 text-muted-foreground"
                  aria-label="Attach image"
                  {disabled}
                  {...props}
                  onclick={handleAttachClick}
                >
                  <PlusIcon />
                </Button>
              {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content>Attach image</Tooltip.Content>
          </Tooltip.Root>

          <input
            bind:this={fileInput}
            type="file"
            accept="image/*"
            multiple
            class="hidden"
            onchange={handleFileChange}
            aria-hidden="true"
            tabindex="-1"
          />

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
              disabled={disabled ||
                submitting ||
                (!input.trim() && attachments.length === 0)}
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

<Dialog.Root bind:open={previewOpen}>
  <Dialog.Content
    class="w-fit max-w-[96vw] justify-items-center gap-2 bg-transparent p-0 shadow-none ring-0 sm:max-w-[96vw] [&_[data-slot='dialog-close']>button]:bg-background/60 [&_[data-slot='dialog-close']>button]:backdrop-blur-sm"
  >
    {#if previewAttachment}
      <Dialog.Title class="sr-only">Preview {previewAttachment.fileName}</Dialog.Title>
      <img
        src={previewAttachment.data}
        alt={previewAttachment.fileName}
        class="max-h-[88vh] w-auto max-w-full rounded-lg object-contain"
      />
      <Dialog.Description class="truncate px-1 text-center text-xs text-muted-foreground">
        {previewAttachment.fileName}
      </Dialog.Description>
    {/if}
  </Dialog.Content>
</Dialog.Root>
