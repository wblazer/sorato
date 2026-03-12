<script lang="ts">
  import type { MessagePart } from '$lib/types.js'

  let { parts, isRunning }: { parts: MessagePart[]; isRunning: boolean } =
    $props()

  // Show this component when the run is active OR when there's still
  // streaming content waiting to be replaced by persisted messages.
  // This prevents the flash on RunEnd: the content stays visible until
  // refreshMessages lands and clears streamingParts.
  const visible = $derived(isRunning || parts.length > 0)
</script>

{#if visible}
  <div class="flex flex-col gap-2 border-l-2 border-l-blue-500/30 py-2 pl-4">
    <div class="flex items-center gap-2">
      <span
        class="text-[10px] font-bold uppercase tracking-widest text-blue-400"
      >
        assistant
      </span>
      {#if isRunning}
        <span class="flex items-center gap-1">
          <span
            class="inline-block h-1 w-1 animate-pulse rounded-full bg-blue-400"
          ></span>
          <span class="text-[10px] text-muted-foreground">streaming</span>
        </span>
      {/if}
    </div>

    {#if parts.length > 0}
      {#each parts as part}
        {#if part.type === 'text'}
          <div
            class="whitespace-pre-wrap break-words font-mono text-sm leading-relaxed"
          >
            {part.text}{#if isRunning}<span
                class="inline-block h-4 w-0.5 animate-pulse bg-blue-400"
              ></span>{/if}
          </div>
        {:else if part.type === 'tool-call'}
          <div
            class="flex items-start gap-2 rounded border border-blue-500/20 bg-blue-500/5 px-3 py-2"
          >
            <span
              class="mt-0.5 inline-flex items-center rounded bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-400"
            >
              tool
            </span>
            <div class="min-w-0 flex-1">
              <span class="font-mono text-sm font-medium text-blue-300"
                >{part.name}</span
              >
              <pre
                class="mt-1 max-h-32 overflow-auto text-xs text-muted-foreground">{JSON.stringify(
                  part.params,
                  null,
                  2
                )}</pre>
            </div>
            {#if isRunning}
              <span
                class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400"
              ></span>
            {/if}
          </div>
        {:else if part.type === 'tool-result'}
          <div
            class="flex items-start gap-2 rounded border px-3 py-2 {part.isFailure
              ? 'border-red-500/20 bg-red-500/5'
              : 'border-emerald-500/20 bg-emerald-500/5'}"
          >
            <span
              class="mt-0.5 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider {part.isFailure
                ? 'bg-red-500/20 text-red-400'
                : 'bg-emerald-500/20 text-emerald-400'}"
            >
              {part.isFailure ? 'error' : 'result'}
            </span>
            <div class="min-w-0 flex-1">
              <span
                class="font-mono text-sm font-medium {part.isFailure
                  ? 'text-red-300'
                  : 'text-emerald-300'}">{part.name}</span
              >
              <pre
                class="mt-1 max-h-32 overflow-auto text-xs text-muted-foreground">{typeof part.result ===
                'string'
                  ? part.result
                  : JSON.stringify(part.result, null, 2)}</pre>
            </div>
          </div>
        {/if}
      {/each}
    {:else if isRunning}
      <div class="flex items-center gap-1.5">
        <span
          class="inline-block h-1 w-1 animate-pulse rounded-full bg-muted-foreground/40"
        ></span>
        <span
          class="inline-block h-1 w-1 animate-pulse rounded-full bg-muted-foreground/40"
          style="animation-delay: 150ms"
        ></span>
        <span
          class="inline-block h-1 w-1 animate-pulse rounded-full bg-muted-foreground/40"
          style="animation-delay: 300ms"
        ></span>
      </div>
    {/if}
  </div>
{/if}
