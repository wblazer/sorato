<script lang="ts">
  import type { MessagePart } from '$lib/types.js'
  import { clientSettingsStore } from '$lib/stores/client-settings.svelte.js'
  import { projectTranscript, streamingSources } from '$lib/transcript.js'
  import * as Accordion from '$lib/components/ui/accordion/index.js'
  import AssistantTranscript from './assistant-transcript.svelte'
  import MessagePartComponent from './message-part.svelte'

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

  const systemAccordionKey = $derived(`${accordionKey}:system-streaming`)
  const systemAccordionValue = $derived(
    accordionState[systemAccordionKey] ?? ['content'],
  )

  function handleSystemAccordionValue(value: string[]) {
    accordionState[systemAccordionKey] = value
  }
</script>

{#if visible}
  {#if variant === 'system'}
    <div class="flex flex-col gap-2 py-1">
      <Accordion.Root
        type="multiple"
        value={systemAccordionValue}
        onValueChange={handleSystemAccordionValue}
        class="w-full overflow-hidden rounded-lg border border-border bg-surface text-foreground shadow-sm shadow-shadow/30"
      >
        <Accordion.Item value="content" class="bg-surface data-open:bg-surface">
          <Accordion.Trigger
            level={4}
            class="flex w-full items-center gap-x-2 gap-y-1 border-0 border-b border-border px-3 py-2 text-sm font-normal no-underline hover:bg-surface-hover hover:no-underline"
          >
            <span
              class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1"
            >
              <span class="font-semibold">Summary</span>
            </span>
          </Accordion.Trigger>

          <Accordion.Content>
            <div class="flex flex-col gap-3 px-3 py-3">
              {#each renderParts as item, index}
                {#if item.type === 'message'}
                  <MessagePartComponent
                    part={item.part}
                    monospace={true}
                    {accordionState}
                    accordionKey={`${systemAccordionKey}:part:${index}`}
                  />
                {/if}
              {/each}
            </div>
          </Accordion.Content>
        </Accordion.Item>
      </Accordion.Root>
    </div>
  {:else}
    <AssistantTranscript
      items={renderParts}
      {isRunning}
      reserveMetaSpace={parts.length > 0}
      {accordionState}
      {accordionKey}
    />
  {/if}
{/if}
