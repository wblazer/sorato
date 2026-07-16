<script lang="ts">
  import type { MessagePart } from '$lib/types.js'
  import { clientSettingsStore } from '$lib/stores/client-settings.svelte.js'
  import * as Accordion from '$lib/components/ui/accordion/index.js'
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js'
  import MessageIcon from './message-icon.svelte'
  import ToolResult from './tool-result.svelte'
  import Markdown from '$lib/components/markdown.svelte'

  let {
    part,
    monospace = false,
    markdown = false,
    accordionState,
    accordionKey,
  }: {
    part: MessagePart
    monospace?: boolean
    markdown?: boolean
    accordionState: Record<string, string[]>
    accordionKey: string
  } = $props()

  const defaultAccordionValue = $derived.by(() => {
    if (part.type !== 'tool-call') return ['content']
    return clientSettingsStore.shouldExpandTool(part.name) ? ['content'] : []
  })
  const accordionValue = $derived(
    accordionState[accordionKey] ?? defaultAccordionValue,
  )

  function handleAccordionValue(value: string[]) {
    accordionState[accordionKey] = value
  }
</script>

{#if part.type === 'text'}
  {#if markdown}
    <Markdown text={part.text} />
  {:else}
    <div
      class="whitespace-pre-wrap break-words"
      class:text-sm={monospace}
      class:font-mono={monospace}
    >
      {part.text}
    </div>
  {/if}
{:else if part.type === 'reasoning'}
  <div class="text-muted-foreground">
    <div class="whitespace-pre-wrap break-words border-l-3 border-muted pl-3">
      {part.text}
    </div>
  </div>
{:else if part.type === 'tool-call'}
  <Accordion.Root
    type="multiple"
    value={accordionValue}
    onValueChange={handleAccordionValue}
    class="rounded-md border border-border bg-inset"
  >
    <Accordion.Item value="content" class="bg-inset data-open:bg-inset">
      <Accordion.Trigger
        level={4}
        class="flex w-full items-start gap-x-2 gap-y-1 border-0 border-b border-border bg-inset px-2.5 py-2 text-sm font-normal text-foreground no-underline hover:bg-inset-hover hover:no-underline"
      >
        <span
          class="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,max-content)_minmax(0,1fr)] items-start gap-x-2 gap-y-1"
        >
          <MessageIcon
            name={part.header?.icon}
            class="mt-0.5 size-4 shrink-0 text-muted-foreground"
          />
          <span class="whitespace-nowrap font-semibold leading-5">
            {part.header?.title ?? part.name}
          </span>
          {#if part.header?.subtitle}
            <span
              class="line-clamp-3 min-w-0 whitespace-normal break-words font-mono leading-5 text-muted-foreground [overflow-wrap:anywhere]"
            >
              {part.header.subtitle}
            </span>
          {/if}
        </span>
      </Accordion.Trigger>

      <Accordion.Content>
        {#if part.params != null}
          <ScrollArea
            orientation="both"
            class="max-h-[32rem]"
            viewportClass="max-h-[32rem] rounded-none"
          >
            <pre class="min-w-max px-2.5 py-3 text-sm">{JSON.stringify(
                part.params,
                null,
                2,
              )}</pre>
          </ScrollArea>
        {/if}
      </Accordion.Content>
    </Accordion.Item>
  </Accordion.Root>
{:else if part.type === 'tool-result'}
  <ToolResult {part} {accordionState} {accordionKey} />
{:else if part.type === 'file'}
  {#if part.mediaType.startsWith('image/') && typeof part.data === 'string'}
    <figure class="w-fit max-w-full space-y-1">
      <img
        src={part.data}
        alt={part.fileName ?? 'Image attachment'}
        class="max-h-80 max-w-full rounded-lg border border-border object-contain shadow-sm shadow-shadow/20"
      />
      <figcaption class="text-xs text-muted-foreground">
        {part.fileName ?? 'Image'} · {part.mediaType}
      </figcaption>
    </figure>
  {:else}
    <div class="flex items-center gap-2">
      <span class="inline-block h-1.5 w-1.5 rounded-full bg-inset"></span>
      <span class="text-sm font-medium text-muted-foreground">file</span>
      {#if part.fileName}
        <code class="text-sm text-muted-foreground">{part.fileName}</code>
      {/if}
      <span class="text-sm text-muted-foreground">{part.mediaType}</span>
    </div>
  {/if}
{/if}
