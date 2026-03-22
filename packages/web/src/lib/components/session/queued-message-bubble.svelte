<script lang="ts">
  export interface QueuedMessageDraft {
    id: string
    content: string
    createdAt: number
  }

  let { message }: { message: QueuedMessageDraft } = $props()
</script>

<div
  class="flex flex-col gap-2 border-l-2 border-l-emerald-500/20 py-2 pl-4 opacity-80"
>
  <div class="flex items-center gap-2">
    <span
      class="text-[10px] font-bold uppercase tracking-widest text-emerald-400"
    >
      user
    </span>
    <span
      class="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300"
    >
      queued
    </span>
    <span class="text-[10px] text-muted-foreground/50">
      {new Date(message.createdAt).toLocaleTimeString()}
    </span>
  </div>

  <div
    class="whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-foreground/80"
  >
    {message.content}
  </div>
</div>
