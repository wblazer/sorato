<script lang="ts">
  import { Button } from '$lib/components/ui/button/index.js'
      import * as Item from '$lib/components/ui/item/index.js'
      import { tick } from 'svelte'
      import { Textarea } from '$lib/components/ui/textarea/index.js'
      import * as Select from '$lib/components/ui/select/index.js'
      import type { AvailableModel, ModelOptions } from '$lib/types.js'
      import ArrowUpIcon from 'phosphor-svelte/lib/ArrowUpIcon'
      import PlusIcon from 'phosphor-svelte/lib/PlusIcon'
      import StopIcon from 'phosphor-svelte/lib/StopIcon'
      import XIcon from 'phosphor-svelte/lib/XIcon'
      import ModelSelector from './model-selector.svelte'

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
        placeholder,
        sessionError = null,
      }: {
        onSend: (input: string) => void
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
        placeholder?: string
        sessionError?: string | null
      } = $props()

      let input = $state('')
      let textarea: HTMLTextAreaElement | null = $state(null)

      const selectedModel = $derived(
        models.find((item) => item.id === model) ?? null
      )
      const thinkingLevel = $derived(
        modelOptions.thinkingLevel ?? selectedModel?.capabilities.thinkingLevels[0]
      )
      const selectedMode = $derived(modelOptions.mode)
      const status = $derived(
        sessionError
          ? {
              variant: 'danger' as const,
              title: 'Run failed',
              description: sessionError,
              dismissible: true,
            }
          : isStopping
            ? {
                variant: 'muted' as const,
                title: 'Stopping current run',
                description: 'Waiting for the server to confirm the stop request.',
                dismissible: false,
              }
            : null
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

      function handleSubmit() {
        const trimmed = input.trim()
        if (!trimmed || disabled) return
        onSend(trimmed)
        input = ''
      }

      function handleKeydown(e: KeyboardEvent) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          handleSubmit()
        }
      }

      $effect(() => {
        focusKey
        if (!autoFocus || disabled) return

        tick().then(() => {
          if (!disabled) textarea?.focus()
        })
      })

</script>

<div class="bg-background pb-5 pt-0">
  <div class="mx-auto w-full max-w-6xl px-4 sm:px-6">
    <div class="relative">
      {#if status}
        <Item.Root
          variant={status.variant}
          size="xs"
          class="relative z-0 rounded-b-none border-border border-b-0 px-3 py-2 shadow-sm shadow-shadow/30"
        >
          <Item.Content>
            <Item.Title>{status.title}</Item.Title>
            <Item.Description>{status.description}</Item.Description>
          </Item.Content>
          {#if status.dismissible}
            <Item.Actions class="ml-auto self-start">
              <Button
                variant="ghost-destructive"
                size="icon-sm"
                onclick={onDismissStatus}
                title="Dismiss error"
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
        {disabled}
        {placeholder}
        rows={1}
        class={`relative z-10 min-h-[32px] w-full max-h-[220px] scroll-pb-4 overflow-y-auto border border-border bg-surface px-4 py-4 shadow-sm shadow-shadow/30 outline-none focus-visible:border-ring focus-visible:ring-0 md:text-sm ${status ? 'rounded-b-lg rounded-t-none' : 'rounded-lg'}`}
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

          {#if selectedModel?.capabilities.reasoning}
            <Select.Root
              type="single"
              value={thinkingLevel}
              onValueChange={(value) =>
                selectThinking(value as NonNullable<ModelOptions['thinkingLevel']>)}
            >
              <Select.Trigger
                class="shrink-0 border-transparent bg-transparent shadow-none hover:bg-base-hover"
                disabled={disabled || modelDisabled}
                title="Select thinking level"
              >
                Think: {thinkingLevel}
              </Select.Trigger>
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
              onValueChange={(value) => selectMode(value === 'default' ? undefined : value)}
            >
              <Select.Trigger
                class="shrink-0 border-transparent bg-transparent shadow-none hover:bg-base-hover"
                disabled={disabled || modelDisabled}
                title="Select model mode"
              >
                Mode: {selectedMode ?? 'default'}
              </Select.Trigger>
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
          {#if isRunning}
            <Button
              onclick={onStop}
              disabled={isStopping}
              variant="destructive"
              size="icon-lg"
              title={isStopping ? 'Stopping...' : 'Stop'}
              aria-busy={isStopping}
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
</div>
