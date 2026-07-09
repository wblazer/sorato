<script lang="ts">
  import { stringifyToolResult } from '@sorato/core/presentation'
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
    accordionState,
    accordionKey,
  }: {
    call?: ToolCallPart | undefined
    part: ToolResultPart
    accordionState: Record<string, string[]>
    accordionKey: string
  } = $props()

  const summary = $derived(diffDisplaySummary(part.bodyDisplay))
  const shouldRenderPretty = $derived(
    clientSettingsStore.prettyTranscript && part.bodyDisplay !== undefined,
  )
  const header = $derived(call?.header ?? part.header)
  const title = $derived(header?.title ?? call?.name ?? `${part.name} Result`)
  const subtitle = $derived(header?.subtitle ?? summary?.fileName)
  const defaultAccordionValue = $derived(
    clientSettingsStore.shouldExpandTool(call?.name ?? part.name)
      ? ['content']
      : [],
  )
  const accordionValue = $derived(
    accordionState[accordionKey] ?? defaultAccordionValue,
  )

  function handleAccordionValue(value: string[]) {
    accordionState[accordionKey] = value
  }
</script>

<Accordion.Root
  type="multiple"
  value={accordionValue}
  onValueChange={handleAccordionValue}
  class="rounded-md border border-border bg-inset"
>
  <Accordion.Item value="content" class="bg-inset data-open:bg-inset">
    <Accordion.Trigger
      level={4}
      class="flex w-full items-start gap-x-2 gap-y-1 border-0 border-b border-border px-2.5 py-2 text-sm font-normal no-underline hover:no-underline {part.isFailure
        ? 'bg-danger-muted text-danger-muted-foreground hover:bg-danger-muted-hover data-open:bg-danger-muted'
        : 'bg-inset text-foreground hover:bg-inset-hover'}"
    >
      <span
        class="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,max-content)_minmax(0,1fr)] items-start gap-x-2 gap-y-1"
      >
        <MessageIcon
          name={header?.icon}
          class={part.isFailure
            ? 'mt-0.5 size-4 shrink-0 text-danger-muted-foreground'
            : 'mt-0.5 size-4 shrink-0 text-muted-foreground'}
        />
        <span class="whitespace-nowrap font-semibold leading-5">{title}</span>
        {#if subtitle}
          <span
            class="line-clamp-3 min-w-0 whitespace-normal break-words font-mono leading-5 [overflow-wrap:anywhere] {part.isFailure
              ? 'text-danger-muted-foreground/80'
              : 'text-muted-foreground'}"
          >
            {subtitle}
          </span>
        {/if}
      </span>
      {#if summary}
        <span
          class="flex shrink-0 items-start gap-1 pt-0.5 font-mono text-xs leading-5"
        >
          <span class="text-success-muted-foreground">+{summary.additions}</span
          >
          <span class="text-danger-muted-foreground">-{summary.deletions}</span>
        </span>
      {/if}
    </Accordion.Trigger>

    <Accordion.Content>
      {#if accordionValue.includes('content')}
        {#if shouldRenderPretty && part.bodyDisplay?.type === 'inline-diff'}
          <ToolDiff display={part.bodyDisplay} cacheKey={part.id} />
        {:else}
          <ScrollArea
            orientation="both"
            class="max-h-[32rem]"
            viewportClass="max-h-[32rem] rounded-none"
          >
            <pre class="min-w-max px-2.5 py-3 text-sm">{stringifyToolResult(
                part.result,
              )}</pre>
          </ScrollArea>
        {/if}
      {/if}
    </Accordion.Content>
  </Accordion.Item>
</Accordion.Root>
