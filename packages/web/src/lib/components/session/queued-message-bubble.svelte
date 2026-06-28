<script lang="ts">
  export interface QueuedMessageDraft {
    id: string
    content: string
    attachments: ReadonlyArray<{
      fileName: string
      data: string
    }>
    createdAt: number
  }

  let { message }: { message: QueuedMessageDraft } = $props()
</script>

<div
  class="ml-auto flex w-fit max-w-[min(42rem,85%)] flex-col gap-2 rounded-lg border border-accent bg-accent px-3 py-3 text-accent-foreground shadow-sm shadow-shadow/30"
>
  <div class="flex items-center gap-2">
    <span
      class="rounded-full bg-accent-foreground/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-accent-foreground/75"
    >
      queued
    </span>
    <span class="text-[10px] text-accent-foreground/75">
      {new Date(message.createdAt).toLocaleTimeString()}
    </span>
  </div>

  {#if message.attachments.length > 0}
    <div class="flex flex-wrap gap-2">
      {#each message.attachments as attachment}
        <img
          src={attachment.data}
          alt={attachment.fileName}
          class="max-h-40 rounded-md border border-accent-foreground/15 object-cover"
        />
      {/each}
    </div>
  {/if}

  {#if message.content.length > 0}
    <div class="whitespace-pre-wrap break-words">
      {message.content}
    </div>
  {/if}
</div>
