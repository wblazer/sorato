<script lang="ts">
  import type { MessagePart } from '$lib/types.js'
  import * as Accordion from '$lib/components/ui/accordion/index.js'
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js'
  import MessageIcon from './message-icon.svelte'
  import ToolResult from './tool-result.svelte'

  let { part, monospace = false }: { part: MessagePart; monospace?: boolean } =
    $props()

  let toolCallOpenItems = $state(['content'])
</script>

{#if part.type === 'text'}
  <div
    class="whitespace-pre-wrap break-words leading-relaxed"
    class:text-sm={monospace}
    class:font-mono={monospace}
  >
    {part.text}
  </div>
{:else if part.type === 'reasoning'}
  <div class="text-muted-foreground">
    <div
      class="whitespace-pre-wrap break-words border-l-3 border-muted pl-3 leading-relaxed"
    >
      {part.text}
    </div>
  </div>
{:else if part.type === 'tool-call'}
  <Accordion.Root
    type="multiple"
    bind:value={toolCallOpenItems}
    class="overflow-hidden rounded-md border border-border bg-inset"
  >
    <Accordion.Item value="content" class="bg-inset data-open:bg-inset">
      <Accordion.Trigger
        level={4}
        class="flex w-full items-center gap-x-2 gap-y-1 border-0 border-b border-border px-2.5 py-2 text-sm font-normal text-foreground no-underline hover:bg-inset-hover hover:no-underline"
      >
        <span class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <MessageIcon name={part.header?.icon} />
          <span class="font-semibold">{part.header?.title ?? part.name}</span>
          {#if part.header?.subtitle}
            <span class="min-w-0 truncate font-mono text-muted-foreground">
              {part.header.subtitle}
            </span>
          {/if}
        </span>
      </Accordion.Trigger>

      <Accordion.Content>
        {#if part.params != null}
          <ScrollArea
            orientation="both"
            class="max-h-48"
            viewportClass="max-h-48 rounded-none"
          >
            <pre class="min-w-max px-2.5 py-3 text-sm leading-relaxed">{JSON.stringify(
              part.params,
              null,
              2
            )}</pre>
          </ScrollArea>
        {/if}
      </Accordion.Content>
    </Accordion.Item>
  </Accordion.Root>
{:else if part.type === 'tool-result'}
  <ToolResult {part} />
{:else if part.type === 'file'}
  <div class="flex items-center gap-2">
    <span class="inline-block h-1.5 w-1.5 rounded-full bg-inset"></span>
    <span class="text-sm font-medium text-muted-foreground">file</span>
    {#if part.fileName}
      <code class="text-sm text-muted-foreground">{part.fileName}</code>
    {/if}
    <span class="text-sm text-muted-foreground">{part.mediaType}</span>
  </div>
{/if}
