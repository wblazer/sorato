export interface GroupedAgentRunBaseMessage {
  readonly id: string
  readonly parentId: string | null
  readonly runId: string | null
  readonly encoded: {
    readonly role: 'system' | 'user' | 'assistant' | 'tool'
  }
}

export function groupedAgentRunBase(
  messages: ReadonlyArray<GroupedAgentRunBaseMessage>,
  runId: string,
  baseNodeId: string | null,
  groupedRunIds: ReadonlySet<string>
): string | null {
  const byId = new Map(messages.map((message) => [message.id, message]))
  const isDescendantOfBase = (nodeId: string) => {
    if (baseNodeId === null) return true

    const seen = new Set<string>()
    let cursor: string | null = nodeId
    while (cursor !== null && !seen.has(cursor)) {
      if (cursor === baseNodeId) return true
      seen.add(cursor)
      cursor = byId.get(cursor)?.parentId ?? null
    }
    return false
  }
  const promptMessages = messages.filter(
    (message) =>
      message.runId === runId &&
      (message.encoded.role === 'system' || message.encoded.role === 'user') &&
      isDescendantOfBase(message.id)
  )
  const promptIds = new Set(promptMessages.map((message) => message.id))
  const promptParentIds = new Set(
    promptMessages
      .map((message) => message.parentId)
      .filter((id): id is string => id !== null && promptIds.has(id))
  )
  const latestPrompt = promptMessages
    .toReversed()
    .find((message) => !promptParentIds.has(message.id))
  if (latestPrompt) return latestPrompt.id

  const seen = new Set<string>()
  let cursor = baseNodeId
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor)
    const message = byId.get(cursor)
    if (!message) return null

    const hiddenGroupedAssistantStep =
      message.encoded.role === 'assistant' &&
      message.runId !== null &&
      groupedRunIds.has(message.runId)
    if (!hiddenGroupedAssistantStep) return message.id
    cursor = message.parentId
  }

  return null
}
