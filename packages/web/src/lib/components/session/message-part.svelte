<script lang="ts">
  import type { MessagePart } from '$lib/types.js'

      let { part, monospace = false }: { part: MessagePart; monospace?: boolean } =
        $props()

</script>

{#if part.type === 'text'}
  <div
    class="whitespace-pre-wrap break-words text-sm leading-relaxed"
    class:font-mono={monospace}
  >
    {part.text}
  </div>
{:else if part.type === 'reasoning'}
  <details class="group">
    <summary
      class="cursor-pointer select-none text-sm font-medium text-muted-foreground hover:text-foreground"
    >
      <span class="inline-flex items-center gap-1.5">
        <span class="inline-block h-1.5 w-1.5 rounded-full bg-surface"></span>
        reasoning
      </span>
    </summary>
    <div
      class="mt-2 whitespace-pre-wrap break-words border-l border-border pl-3 text-sm text-muted-foreground"
    >
      {part.text}
    </div>
  </details>
{:else if part.type === 'tool-call'}
  <div class="overflow-hidden rounded-md border border-border bg-surface">
    <div class="border-b border-border px-2.5 py-2 text-sm text-foreground">
      <span class="font-semibold">{part.name}</span>
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
  <div
    class="overflow-hidden rounded-md border {part.isFailure
      ? 'border-danger bg-surface'
      : 'border-border bg-surface'}"
  >
    <div
      class="border-b px-2.5 py-2 text-sm {part.isFailure
        ? 'border-danger text-danger'
        : 'border-border text-foreground'}"
    >
      <span class="font-semibold">{part.name} Result</span>
    </div>
    {#if part.result != null}
      <pre
        class="max-h-64 overflow-auto px-2.5 py-3 text-sm leading-relaxed">{typeof part.result ===
        'string'
          ? part.result
          : JSON.stringify(part.result, null, 2)}</pre>
    {/if}
  </div>
{:else if part.type === 'file'}
  <div class="flex items-center gap-2">
    <span class="inline-block h-1.5 w-1.5 rounded-full bg-surface"></span>
    <span class="text-sm font-medium text-muted-foreground">file</span>
    {#if part.fileName}
      <code class="text-sm text-muted-foreground">{part.fileName}</code>
    {/if}
    <span class="text-sm text-muted-foreground">{part.mediaType}</span>
  </div>
{/if}
