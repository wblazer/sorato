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

  const roleColors: Record<string, string> = {
    system: 'text-yellow-500',
    user: 'text-emerald-400',
    assistant: 'text-blue-400',
    tool: 'text-purple-400',
  }

  const roleBorders: Record<string, string> = {
    system: 'border-l-yellow-500/30',
    user: 'border-l-emerald-500/30',
    assistant: 'border-l-blue-500/30',
    tool: 'border-l-purple-500/30',
  }
</script>

<div
  class="group flex flex-col gap-2 border-l-2 {roleBorders[role] ??
    'border-l-border'} py-2 pl-4"
>
  <!-- Role badge + metadata -->
  <div class="flex items-center gap-2">
    <span
      class="text-[10px] font-bold uppercase tracking-widest {roleColors[
        role
      ] ?? 'text-muted-foreground'}"
    >
      {role}
    </span>
    <span class="text-[10px] text-muted-foreground/50">
      {message.id.slice(0, 8)}
    </span>
    <span class="text-[10px] text-muted-foreground/50">
      {new Date(message.createdAt).toLocaleTimeString()}
    </span>
  </div>

  <!-- Message parts -->
  {#if parts.length === 0}
    <span class="text-xs italic text-muted-foreground">(empty)</span>
  {:else}
    <div class="flex flex-col gap-3">
      {#each parts as part}
        <MessagePartComponent {part} />
      {/each}
    </div>
  {/if}
</div>
