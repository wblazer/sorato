<script lang="ts">
  import type { AvailableModel } from '$lib/types.js'
  import ModelSelector from './model-selector.svelte'

  let {
    onSend,
    onStop,
    onAttach,
    onModelChange,
    models = [],
    model = null,
    modelLoading = false,
    modelDisabled = false,
    isRunning = false,
    isStopping = false,
    disabled = false,
    placeholder = 'Type a message...',
  }: {
    onSend: (input: string) => void
    onStop?: () => void
    onAttach?: () => void
    onModelChange?: (value: string) => void
    models?: ReadonlyArray<AvailableModel>
    model?: string | null
    modelLoading?: boolean
    modelDisabled?: boolean
    isRunning?: boolean
    isStopping?: boolean
    disabled?: boolean
    placeholder?: string
  } = $props()

  let input = $state('')
  let textarea: HTMLTextAreaElement | undefined = $state()

  function handleSubmit() {
    const trimmed = input.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    input = ''
    // Reset textarea height
    if (textarea) {
      textarea.style.height = 'auto'
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  // Auto-resize textarea
  function handleInput() {
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
    }
  }
</script>

<div class="bg-background px-4 py-5 sm:px-6">
  <div class="mx-auto w-full max-w-6xl">
    <div class="relative">
      <div
        class="relative z-10 rounded-2xl border-2 border-border/90 bg-card shadow-md"
      >
        <div class="rounded-2xl bg-background/95 px-4 py-3 sm:px-5 sm:py-4">
          <textarea
            bind:this={textarea}
            bind:value={input}
            onkeydown={handleKeydown}
            oninput={handleInput}
            {placeholder}
            {disabled}
            rows={1}
            class="max-h-[220px] min-h-[32px] w-full resize-none bg-transparent text-[15px] leading-7 text-foreground outline-none placeholder:text-muted-foreground/85 disabled:cursor-not-allowed disabled:opacity-50"
          ></textarea>
        </div>
      </div>

      <div
        class="relative -mt-2 flex w-full flex-wrap items-center gap-2 rounded-b-[1.15rem] border border-border/60 bg-secondary/72 px-2.5 pb-2 pt-3 text-secondary-foreground shadow-[0_12px_24px_-26px_rgba(15,23,42,0.3)] sm:flex-nowrap sm:px-3"
      >
        <div class="flex min-w-0 flex-1 items-center gap-1.5">
          <button
            onclick={onAttach}
            type="button"
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            title="Attach file"
            {disabled}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
          </button>

          <div class="min-w-0 max-w-[min(20rem,60vw)]">
            <ModelSelector
              {models}
              value={model}
              loading={modelLoading}
              disabled={disabled || modelDisabled}
              compact={true}
              onChange={onModelChange}
            />
          </div>
        </div>

        <div class="flex shrink-0 items-center gap-2">
          {#if isRunning}
            <button
              onclick={onStop}
              disabled={isStopping}
              class="flex h-8 min-w-8 items-center justify-center rounded-full bg-destructive px-2.5 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-50"
              title={isStopping ? 'Stopping...' : 'Stop (Esc)'}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="currentColor"
                stroke="none"
              >
                <rect x="4" y="4" width="16" height="16" rx="2" />
              </svg>
            </button>
          {:else}
            <button
              onclick={handleSubmit}
              disabled={disabled || !input.trim()}
              class="flex h-8 min-w-8 items-center justify-center rounded-md bg-primary px-2.5 text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              title="Send message"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="m5 12 7-7 7 7" />
                <path d="M12 19V5" />
              </svg>
            </button>
          {/if}
        </div>
      </div>
    </div>

    {#if isRunning}
      <div class="mt-2 flex items-center justify-end px-1">
        {#if isStopping}
          <span class="text-[11px] text-amber-500">Stopping...</span>
        {:else}
          <span class="text-[11px] text-muted-foreground">
            Press <kbd
              class="rounded border bg-muted px-1 py-0.5 font-mono text-[10px]"
              >Esc</kbd
            >
            to stop
          </span>
        {/if}
      </div>
    {/if}
  </div>
</div>
