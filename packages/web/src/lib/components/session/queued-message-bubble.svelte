<script lang="ts">
  export interface QueuedMessageDraft {
    id: string
    content: string
    createdAt: number
  }

  let { message }: { message: QueuedMessageDraft } = $props()
</script>

<div
  class="ml-auto flex w-fit max-w-[min(42rem,85%)] flex-col gap-2 rounded-lg border border-primary/30 bg-primary px-3 py-3 text-primary-foreground opacity-80 shadow-sm"
>
  <div class="flex items-center gap-2">
    <span
      class="rounded-full bg-background/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground"
    >
      queued
    </span>
    <span class="text-[10px] text-muted-foreground">
      {new Date(message.createdAt).toLocaleTimeString()}
    </span>
  </div>

  <div class="whitespace-pre-wrap break-words text-sm leading-relaxed">
    {message.content}
  </div>
</div>
