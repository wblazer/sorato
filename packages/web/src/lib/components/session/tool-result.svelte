<script lang="ts">
  import type { ToolCallPart, ToolResultPart } from '$lib/types.js'
  import { clientSettingsStore } from '$lib/stores/client-settings.svelte.js'
  import * as Accordion from '$lib/components/ui/accordion/index.js'
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js'
  import { diffDisplaySummary } from '$lib/tool-output.js'
  import MessageIcon from './message-icon.svelte'
  import ToolDiff from './tool-diff.svelte'

  let {
    call,
    part,
  }: { call?: ToolCallPart | undefined; part: ToolResultPart } = $props()

  const summary = $derived(diffDisplaySummary(part.bodyDisplay))
  const shouldRenderPretty = $derived(
    clientSettingsStore.prettyTranscript && part.bodyDisplay !== undefined
  )
  const header = $derived(call?.header ?? part.header)
  const title = $derived(header?.title ?? call?.name ?? `${part.name} Result`)
  const subtitle = $derived(header?.subtitle ?? summary?.fileName)
  let openItems = $state(['content'])
</script>

<Accordion.Root
  type="multiple"
  bind:value={openItems}
  class="overflow-hidden rounded-md border bg-inset {part.isFailure
    ? 'border-danger'
    : 'border-border'}"
>
  <Accordion.Item value="content" class="bg-inset data-open:bg-inset">
    <Accordion.Trigger
      level={4}
      class="flex w-full items-center gap-x-2 gap-y-1 border-0 border-b px-2.5 py-2 text-sm font-normal no-underline hover:bg-inset-hover hover:no-underline {part.isFailure
        ? 'border-danger text-danger-muted-foreground'
        : 'border-border text-foreground'}"
    >
      <span class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
        <MessageIcon name={header?.icon} />
        <span class="font-semibold">{title}</span>
        {#if subtitle}
          <span class="min-w-0 truncate font-mono text-muted-foreground">
            {subtitle}
          </span>
        {/if}
      </span>
      {#if summary}
        <span class="flex shrink-0 items-center gap-1 font-mono text-xs">
          <span class="text-success-muted-foreground">+{summary.additions}</span>
          <span class="text-danger-muted-foreground">-{summary.deletions}</span>
        </span>
      {/if}
    </Accordion.Trigger>

    <Accordion.Content>
      {#if shouldRenderPretty && part.bodyDisplay?.type === 'diff'}
        <ToolDiff display={part.bodyDisplay} />
      {:else}
        <ScrollArea
          orientation="both"
          class="max-h-64"
          viewportClass="max-h-64 rounded-none"
        >
          <pre class="min-w-max px-2.5 py-3 text-sm leading-relaxed"
            >{part.result}</pre
          >
        </ScrollArea>
      {/if}
    </Accordion.Content>
  </Accordion.Item>
</Accordion.Root>
