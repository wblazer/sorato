import type { AvailableModel, MessageNode, ModelCall } from '$lib/types.js'

export type SessionTokenUsage = {
  readonly currentContextTokens: number | null
  readonly maxContextTokens: number | null
  readonly contextPercent: number | null
  readonly totalTokens: number
  readonly totalInputTokens: number
  readonly totalOutputTokens: number
  readonly totalCostMicros: number
}

const originalModelCallForMessage = (
  message: MessageNode
): ModelCall | null => {
  if (message.sourceNodeId !== null) return null
  if (message.modelCall === null) return null
  if (message.modelCall.assistantNodeId !== message.id) return null
  return message.modelCall
}

export const sessionTokenUsage = (
  messages: ReadonlyArray<MessageNode>,
  models: ReadonlyArray<AvailableModel>
): SessionTokenUsage | null => {
  const modelCalls = messages.flatMap((message) => {
    const call = originalModelCallForMessage(message)
    return call === null ? [] : [call]
  })

  let totalTokens = 0
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let totalCostMicros = 0
  let latestContextTokens: number | null = null
  let latestModelKey: string | null = null

  for (const call of modelCalls) {
    totalTokens += call.totalTokens ?? 0
    totalInputTokens +=
      (call.inputTokens ?? 0) +
      (call.cacheReadTokens ?? 0) +
      (call.cacheWriteTokens ?? 0)
    totalOutputTokens += (call.outputTokens ?? 0) + (call.reasoningTokens ?? 0)
    totalCostMicros += call.actualCostMicrosUsd ?? 0

    if (call.contextWindowTokens !== null) {
      latestContextTokens = call.contextWindowTokens
      latestModelKey = `${call.providerId}/${call.modelId}`
    }
  }

  if (totalTokens === 0 && latestContextTokens === null) return null

  const model = models.find((item) => item.id === latestModelKey) ?? null
  const maxContextTokens = model?.capabilities.limits.context ?? null
  const contextPercent =
    latestContextTokens !== null &&
    maxContextTokens !== null &&
    maxContextTokens > 0
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
}
