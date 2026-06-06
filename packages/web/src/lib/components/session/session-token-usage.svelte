<script lang="ts">
  import type { AvailableModel, MessageNode, RunSummary } from '$lib/types.js'
  import * as Tooltip from '$lib/components/ui/tooltip/index.js'

  let {
    messages,
    headId,
    models,
  }: {
    messages: ReadonlyArray<MessageNode>
    headId: string | null
    models: ReadonlyArray<AvailableModel>
  } = $props()

  const compactNumber = (value: number): string =>
    Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(
      value
    )

  const fullNumber = (value: number): string => Intl.NumberFormat().format(value)

  const formatCost = (micros: number): string =>
    Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: micros === 0 ? 0 : 4,
    }).format(micros / 1_000_000)

  const visibleMessages = $derived.by((): ReadonlyArray<MessageNode> => {
    if (headId === null) return messages

    const byId = new Map(messages.map((message) => [message.id, message]))
    const path: MessageNode[] = []
    let cursor = byId.get(headId) ?? null

    while (cursor !== null) {
      path.push(cursor)
      cursor = cursor.parentId === null ? null : (byId.get(cursor.parentId) ?? null)
    }

    return path.length > 0 ? path.reverse() : messages
  })

  const usage = $derived.by(() => {
    const runs = new Map<string, RunSummary>()
    for (const message of visibleMessages) {
      runs.set(message.run.id, message.run)
    }

    let totalTokens = 0
    let totalInputTokens = 0
    let totalOutputTokens = 0
    let totalCostMicros = 0
    let latestContextTokens: number | null = null
    let latestModelKey: string | null = null

    for (const run of runs.values()) {
      totalTokens += run.usage.totalTokens ?? 0
      totalInputTokens +=
        (run.usage.inputTokens ?? 0) +
        (run.usage.cacheReadTokens ?? 0) +
        (run.usage.cacheWriteTokens ?? 0)
      totalOutputTokens +=
        (run.usage.outputTokens ?? 0) + (run.usage.reasoningTokens ?? 0)
      totalCostMicros += run.usage.actualCostMicrosUsd ?? 0

      if (run.usage.contextWindowTokens !== null) {
        latestContextTokens = run.usage.contextWindowTokens
        latestModelKey = `${run.providerId}/${run.modelId}`
      }
    }

    if (totalTokens === 0 && latestContextTokens === null) return null

    const model = models.find((item) => item.id === latestModelKey) ?? null
    const maxContextTokens = model?.capabilities.limits.context ?? null
    const contextPercent =
      latestContextTokens !== null && maxContextTokens !== null && maxContextTokens > 0
        ? Math.min(100, (latestContextTokens / maxContextTokens) * 100)
        : null

    return {
      currentContextTokens: latestContextTokens,
      maxContextTokens,
      contextPercent,
      totalTokens,
      totalInputTokens,
      totalOutputTokens,
      totalCostMicros,
    }
  })

  const percentNumberLabel = $derived.by(() => {
    if (usage?.contextPercent === null || usage?.contextPercent === undefined) return null
    return `${Math.round(usage.contextPercent)}`
  })

  const percentLabel = $derived(
    percentNumberLabel === null ? null : `${percentNumberLabel}%`
  )

  const normalizedPercent = $derived(
    Math.max(0, Math.min(100, usage?.contextPercent ?? 0))
  )
  const radius = 9.75
  const circumference = 2 * Math.PI * radius
  const dashOffset = $derived(circumference - (normalizedPercent / 100) * circumference)
</script>

{#if usage}
  <Tooltip.Provider delayDuration={0}>
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <span
            class="inline-flex cursor-default items-center justify-center rounded-full text-muted-foreground"
            aria-label={percentLabel
              ? `Context window ${percentLabel} used`
              : `${compactNumber(usage.currentContextTokens ?? usage.totalTokens)} tokens used`}
            {...props}
          >
            <span class="relative flex h-7 w-7 items-center justify-center">
              <svg
                viewBox="0 0 24 24"
                class="absolute inset-0 h-full w-full -rotate-90 transform-gpu"
                aria-hidden="true"
              >
                <circle
                  cx="12"
                  cy="12"
                  r={radius}
                  fill="none"
                  stroke="currentColor"
                  stroke-opacity="0.18"
                  stroke-width="3"
                />
                <circle
                  cx="12"
                  cy="12"
                  r={radius}
                  fill="none"
                  stroke="currentColor"
                  stroke-width="3"
                  stroke-linecap="round"
                  stroke-dasharray={circumference}
                  stroke-dashoffset={dashOffset}
                  class="transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none"
                />
              </svg>
              <span
                class="relative flex h-[17px] w-[17px] cursor-default items-center justify-center rounded-full bg-base text-[9px] font-bold text-muted-foreground"
              >
                {percentNumberLabel ?? ''}
              </span>
            </span>
          </span>
        {/snippet}
      </Tooltip.Trigger>

      <Tooltip.Content side="bottom" sideOffset={8} class="max-w-none px-3 py-2 text-sm">
        <div class="space-y-2 leading-tight">
          <div class="space-y-1">
            <div class="font-medium text-muted-foreground">
              Context Window
            </div>

            <div class="whitespace-nowrap font-medium text-foreground">
              {#if usage.currentContextTokens !== null && usage.maxContextTokens !== null && percentLabel}
                <span>{percentLabel}</span>
                <span class="mx-0.5">·</span>
                <span>{compactNumber(usage.currentContextTokens)}</span>
                <span>/</span>
                <span>{compactNumber(usage.maxContextTokens)} context used</span>
              {:else if usage.currentContextTokens !== null}
                <span>{fullNumber(usage.currentContextTokens)} tokens</span>
              {:else}
                <span>Context usage unknown</span>
              {/if}
            </div>
          </div>

          <div class="space-y-1">
            <div class="font-medium text-muted-foreground">
              Session Total
            </div>

            <div class="whitespace-nowrap font-medium text-foreground">
              {compactNumber(usage.totalInputTokens)} in · {compactNumber(usage.totalOutputTokens)} out · {formatCost(usage.totalCostMicros)}
            </div>
          </div>
        </div>
      </Tooltip.Content>
    </Tooltip.Root>
  </Tooltip.Provider>
{/if}
