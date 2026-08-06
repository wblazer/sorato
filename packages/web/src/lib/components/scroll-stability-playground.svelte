<script lang="ts">
  import { onDestroy } from 'svelte'
  import Markdown from '$lib/components/markdown.svelte'
  import { MessageScrollerController } from '$lib/components/message-scroller/message-scroller.svelte.js'
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js'

  let {
    onClose,
    useContainment = false,
  }: {
    onClose: () => void
    useContainment?: boolean
  } = $props()

  const scroller = new MessageScrollerController({
    autoScroll: true,
    defaultScrollPosition: 'end',
  })
  let viewport = $state<HTMLElement | null>(null)
  let streamStep = $state(0)
  let completed = $state(false)
  let responseCollapsed = $state(false)

  const history = Array.from({ length: 18 }, (_, index) => ({
    id: `history-${index}`,
    text: [
      `## Historical turn ${index + 1}`,
      ...Array.from(
        { length: index % 3 === 0 ? 18 : 4 },
        (_, paragraph) =>
          `Historical paragraph ${index + 1}.${paragraph + 1}: deterministic variable-height content used to expose cold intrinsic-size estimates.`,
      ),
      index % 4 === 0
        ? `\n\`\`\`ts\nexport const historical${index} = ${index}\n\`\`\``
        : '',
    ].join('\n\n'),
  }))

  const chunks = [
    Array.from(
      { length: 12 },
      (_, index) =>
        `Reader marker ${index + 1}: this paragraph remains byte-for-byte identical when the streamed response becomes durable.`,
    ).join('\n\n'),
    `\n\n## Long code result\n\n\`\`\`ts\n${Array.from(
      { length: 36 },
      (_, index) => `const measuredLine${index + 1} = ${index + 1}`,
    ).join('\n')}\n\`\`\``,
    `\n\n## Tool result\n\n${Array.from(
      { length: 16 },
      (_, index) =>
        `Tool output line ${index + 1}: stable geometry after the final stream handoff.`,
    ).join('\n\n')}`,
  ]
  const streamedResponse = $derived(chunks.slice(0, streamStep + 1).join(''))
  const response = $derived(
    responseCollapsed ? chunks[0].split('\n\n')[0] : streamedResponse,
  )

  function appendChunk() {
    if (streamStep < chunks.length - 1) streamStep += 1
  }

  function complete() {
    completed = true
  }

  function reset() {
    completed = false
    responseCollapsed = false
    streamStep = 0
  }

  $effect(() => {
    const element = viewport
    if (element === null) return
    const binding = scroller.viewport(element as HTMLDivElement)
    return () => binding.destroy()
  })

  onDestroy(() => scroller.destroy())
</script>

<div class="fixed inset-0 z-50 flex flex-col bg-background" data-scroll-fixture>
  <header class="flex h-12 shrink-0 items-center gap-2 border-b px-4">
    <strong class="mr-auto text-sm">Scroll stability diagnostics</strong>
    <span class="text-xs text-muted-foreground">
      containment: {useContainment ? 'legacy estimate' : 'stable geometry'}
    </span>
    <button class="rounded border px-2 py-1 text-xs" onclick={appendChunk}>
      Stream next chunk
    </button>
    <button class="rounded border px-2 py-1 text-xs" onclick={complete}>
      Complete response
    </button>
    <button
      class="rounded border px-2 py-1 text-xs"
      onclick={() => (responseCollapsed = true)}
    >
      Shrink response
    </button>
    <button
      class="rounded border px-2 py-1 text-xs"
      onclick={() => (responseCollapsed = false)}
    >
      Restore response
    </button>
    <button class="rounded border px-2 py-1 text-xs" onclick={reset}>
      Reset
    </button>
    <button class="rounded border px-2 py-1 text-xs" onclick={onClose}>
      Close
    </button>
  </header>

  <div use:scroller.root class="min-h-0 flex-1" data-fixture-scroller>
    <ScrollArea
      bind:viewportRef={viewport}
      orientation="vertical"
      class="h-full"
      viewportClass="overscroll-contain contain-content"
    >
      <div
        use:scroller.content
        class="mx-auto flex h-max min-h-full w-full max-w-3xl flex-col gap-1 px-6 py-5"
      >
        {#each history as item (item.id)}
          <div
            use:scroller.item={{ messageId: item.id }}
            class="shrink-0 py-2"
            class:legacy-containment={useContainment}
            data-fixture-row={item.id}
          >
            <Markdown text={item.text} />
          </div>
        {/each}

        <div
          use:scroller.item={{
            messageId: 'active-user-message',
            scrollAnchor: true,
          }}
          class="shrink-0 py-3 font-medium"
          data-fixture-row="active-user-message"
        >
          Diagnose scroll stability while preserving the reader's position.
        </div>

        <div
          use:scroller.item={{
            messageId: 'active-response',
          }}
          class="shrink-0 py-2"
          class:legacy-containment={useContainment}
          data-fixture-row="active-response"
          data-completed={completed}
        >
          {#if completed}
            <section data-response-branch="durable">
              <Markdown text={response} />
              <div class="min-h-5 text-xs text-muted-foreground">
                model · 1s
              </div>
            </section>
          {:else}
            <section data-response-branch="streaming">
              <Markdown text={response} />
              <div class="min-h-5 text-xs text-muted-foreground">streaming</div>
            </section>
          {/if}
        </div>

        <div
          use:scroller.spacer
          aria-hidden="true"
          data-message-scroller-spacer
          hidden
        ></div>
      </div>
    </ScrollArea>
  </div>
</div>

<style>
  .legacy-containment {
    contain-intrinsic-size: auto 10rem;
    content-visibility: auto;
  }
</style>
