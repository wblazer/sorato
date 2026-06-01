import type { HarnessUsage } from '@sorato/core'
import type { BillingMode, RunUsage } from './session/session.ts'

export type CostInfo = {
  readonly input?: number
  readonly output?: number
  readonly cacheRead?: number
  readonly cacheWrite?: number
  readonly tiers?: ReadonlyArray<
    CostInfo & {
      readonly tier: {
        readonly type: string
        readonly size: number
      }
    }
  >
  readonly contextOver200K?: CostInfo
}

const microsUsd = (
  tokens: number,
  dollarsPerMillionTokens: number | undefined
) => Math.round(tokens * (dollarsPerMillionTokens ?? 0))

const effectiveCost = (
  cost: CostInfo | undefined,
  contextTokens: number
): CostInfo | undefined => {
  const tier = cost?.tiers
    ?.filter(
      (item) => item.tier.type === 'context' && contextTokens > item.tier.size
    )
    .sort((a, b) => b.tier.size - a.tier.size)[0]
  if (tier) return tier
  if (cost?.contextOver200K && contextTokens > 200_000)
    return cost.contextOver200K
  return cost
}

export const pricedUsage = (
  usage: HarnessUsage | undefined,
  billingMode: BillingMode,
  cost: CostInfo | undefined
): RunUsage | undefined => {
  if (!usage) return undefined

  const costInfo = effectiveCost(
    cost,
    usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
  )
  const listPriceMicrosUsd = costInfo
    ? microsUsd(usage.inputTokens, costInfo.input) +
      microsUsd(usage.outputTokens, costInfo.output) +
      microsUsd(usage.reasoningTokens, costInfo.output) +
      microsUsd(usage.cacheReadTokens, costInfo.cacheRead) +
      microsUsd(usage.cacheWriteTokens, costInfo.cacheWrite)
    : null

  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.reasoningTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    totalTokens: usage.totalTokens,
    actualCostMicrosUsd:
      billingMode === 'subscription' ? 0 : listPriceMicrosUsd,
    listPriceMicrosUsd,
  }
}
