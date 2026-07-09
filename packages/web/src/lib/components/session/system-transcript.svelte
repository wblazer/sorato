<script lang="ts">
  import type { Component } from 'svelte'
  import type { TranscriptItem } from '$lib/transcript.js'
  import * as Accordion from '$lib/components/ui/accordion/index.js'
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js'
  import MessagePartComponent from './message-part.svelte'
  import ToolCallResult from './tool-call-result.svelte'
  import { roleIcons } from './message-icons.js'

  let {
    items,
    title = 'System',
    subtitle = undefined,
    icon = roleIcons.system,
    defaultOpen = false,
    accordionState,
    accordionKey,
  }: {
    items: ReadonlyArray<TranscriptItem>
    title?: string
    subtitle?: string | undefined
    icon?: Component | undefined
    defaultOpen?: boolean
    accordionState: Record<string, string[]>
    accordionKey: string
  } = $props()

  const accordionValue = $derived(
    accordionState[accordionKey] ?? (defaultOpen ? ['content'] : []),
  )

  const headerGridClass = $derived(
    icon === undefined
      ? 'grid min-w-0 flex-1 grid-cols-[minmax(0,max-content)_minmax(0,1fr)] items-start gap-x-2 gap-y-1'
      : 'grid min-w-0 flex-1 grid-cols-[auto_minmax(0,max-content)_minmax(0,1fr)] items-start gap-x-2 gap-y-1',
  )

  const itemAccordionKey = (item: TranscriptItem, index: number): string => {
    if (item.type === 'combined-tool') return `tool:${item.call.id}`
    if (item.type === 'message' && 'id' in item.part) {
      return `part:${item.part.type}:${item.part.id}`
    }
    return `${accordionKey}:item:${index}`
  }

  function handleAccordionValue(value: string[]) {
    accordionState[accordionKey] = value
  }
</script>

<div class="flex flex-col gap-2 py-1">
  <Accordion.Root
    type="multiple"
    value={accordionValue}
    onValueChange={handleAccordionValue}
    class="w-full rounded-lg border border-border bg-surface text-foreground shadow-sm shadow-shadow/30"
  >
    <Accordion.Item value="content" class="bg-surface data-open:bg-surface">
      <Accordion.Trigger
        level={4}
        class="flex w-full items-start gap-x-2 gap-y-1 border-0 border-b border-border bg-surface px-3 py-2 text-sm font-normal no-underline hover:bg-surface-hover hover:no-underline"
      >
        <span class={headerGridClass}>
          {#if icon}
            {@const Icon = icon}
            <Icon class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          {/if}
          <span class="whitespace-nowrap font-semibold leading-5">{title}</span>
          {#if subtitle}
            <span
              class="line-clamp-3 min-w-0 whitespace-normal break-words font-mono leading-5 text-muted-foreground [overflow-wrap:anywhere]"
            >
              {subtitle}
            </span>
          {/if}
        </span>
      </Accordion.Trigger>

      <Accordion.Content>
        <ScrollArea
          orientation="vertical"
          class="max-h-[32rem]"
          viewportClass="max-h-[32rem] rounded-none"
        >
          <div class="flex flex-col gap-3 px-3 py-3">
            {#each items as item, index}
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
                  monospace={true}
                  {accordionState}
                  accordionKey={itemAccordionKey(item, index)}
                />
              {/if}
            {/each}
          </div>
        </ScrollArea>
      </Accordion.Content>
    </Accordion.Item>
  </Accordion.Root>
</div>
