<script lang="ts">
  import type { MessageNode, MessagePart } from '$lib/types.js'
  import MessagePartComponent from './message-part.svelte'

  let { message }: { message: MessageNode } = $props()

  const role = $derived(message.encoded.role)

  /** Normalize content to an array of parts for uniform rendering. */
  const parts = $derived.by((): MessagePart[] => {
    const content = message.encoded.content
    if (typeof content === 'string') {
      return [{ type: 'text', text: content }]
    }
    if (Array.isArray(content)) {
      return content as MessagePart[]
    }
    return []
  })

  const isUser = $derived(role === 'user')
  const isSystem = $derived(role === 'system')
</script>

<div class="flex flex-col gap-2 py-2.5">
  {#if parts.length === 0}
    <span class="text-xs italic text-muted-foreground">(empty)</span>
  {:else if isUser}
    <div
      class="ml-auto w-fit max-w-[min(42rem,85%)] rounded-lg border border-primary/30 bg-primary text-primary-foreground shadow-sm"
    >
      <div class="flex flex-col gap-3 px-3 py-3">
        {#each parts as part}
          <MessagePartComponent {part} monospace={false} />
        {/each}
      </div>
    </div>
  {:else if isSystem}
    <div
      class="w-full overflow-hidden rounded-lg border border-border bg-muted text-foreground shadow-sm"
    >
      <div
        class="border-b border-border px-3 py-2 text-sm font-semibold text-foreground"
      >
        System
      </div>
      <div class="flex flex-col gap-3 px-3 py-3">
        {#each parts as part}
          <MessagePartComponent {part} monospace={true} />
        {/each}
      </div>
    </div>
  {:else}
    <div class="flex flex-col gap-3">
      {#each parts as part}
        <MessagePartComponent {part} monospace={false} />
      {/each}
    </div>
  {/if}
</div>
