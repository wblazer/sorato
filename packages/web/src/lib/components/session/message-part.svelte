<script lang="ts">
  import type { MessagePart } from '$lib/types.js'
  import MessageIcon from './message-icon.svelte'
  import ToolResult from './tool-result.svelte'

  let { part, monospace = false }: { part: MessagePart; monospace?: boolean } =
    $props()
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
  <div class="overflow-hidden rounded-md border border-border bg-inset">
    <div
      class="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-2.5 py-2 text-sm text-foreground"
    >
      <MessageIcon name={part.header?.icon} />
      <span class="font-semibold">{part.header?.title ?? part.name}</span>
      {#if part.header?.subtitle}
        <span class="min-w-0 truncate font-mono text-muted-foreground">
          {part.header.subtitle}
        </span>
      {/if}
    </div>
    {#if part.params != null}
      <pre
        class="max-h-48 overflow-auto px-2.5 py-3 text-sm leading-relaxed">{JSON.stringify(
          part.params,
          null,
          2
        )}</pre>
    {/if}
  </div>
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
