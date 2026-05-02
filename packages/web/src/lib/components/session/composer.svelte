<script lang="ts">
  import { Button } from '$lib/components/ui/button/index.js'
      import { Textarea } from '$lib/components/ui/textarea/index.js'
      import type { AvailableModel } from '$lib/types.js'
      import ArrowUpIcon from 'phosphor-svelte/lib/ArrowUpIcon'
      import PlusIcon from 'phosphor-svelte/lib/PlusIcon'
      import StopIcon from 'phosphor-svelte/lib/StopIcon'
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
      let textarea: HTMLTextAreaElement | null = $state(null)

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

<div class="bg-background py-5">
  <div class="mx-auto w-full max-w-6xl px-4 sm:px-6">
    <div class="relative">
      <Textarea
        bind:ref={textarea}
        bind:value={input}
        onkeydown={handleKeydown}
        oninput={handleInput}
        {placeholder}
        {disabled}
        rows={1}
        class="relative z-10 min-h-[32px] w-full max-h-[220px] rounded-lg border border-border bg-surface px-4 py-4 shadow-sm shadow-shadow/30 outline-none focus-visible:border-ring focus-visible:ring-0 md:text-sm"
      />

      <div
        class="relative -mt-2 flex w-full flex-wrap items-center gap-2 rounded-b-lg border border-border bg-background px-1.5 pb-1 pt-3 text-muted-foreground shadow-sm shadow-shadow/30 sm:flex-nowrap"
      >
        <div class="flex min-w-0 flex-1 items-center gap-1">
          <Button
            onclick={onAttach}
            type="button"
            variant="ghost"
            size="icon"
            class="shrink-0 text-muted-foreground"
            title="Attach file"
            {disabled}
          >
            <PlusIcon />
          </Button>

          <div class="min-w-0 max-w-[min(20rem,60vw)]">
            <ModelSelector
              {models}
              value={model}
              loading={modelLoading}
              disabled={disabled || modelDisabled}
              onChange={onModelChange}
            />
          </div>
        </div>

        <div class="flex shrink-0 items-center gap-2">
          {#if isRunning}
            <Button
              onclick={onStop}
              disabled={isStopping}
              variant="destructive"
              size="icon-lg"
              class="rounded-full"
              title={isStopping ? 'Stopping...' : 'Stop (Esc)'}
            >
              <StopIcon weight="fill" />
            </Button>
          {:else}
            <Button
              onclick={handleSubmit}
              disabled={disabled || !input.trim()}
              size="icon-lg"
              title="Send message"
            >
              <ArrowUpIcon />
            </Button>
          {/if}
        </div>
      </div>
    </div>
  </div>

  {#if isRunning}
    <div class="mt-2 flex items-center justify-end px-1">
      {#if isStopping}
        <span class="text-[11px] text-muted-foreground">Stopping...</span>
      {:else}
        <span class="text-[11px] text-muted-foreground">
          Press <kbd
            class="rounded border bg-inset px-1 py-0.5 font-mono text-[10px]"
            >Esc</kbd
          >
          to stop
        </span>
      {/if}
    </div>
  {/if}
</div>
