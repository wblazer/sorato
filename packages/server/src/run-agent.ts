/**
 * Agent run orchestration for the HTTP server.
 *
 * Bridges the harness `run()` function with server infrastructure:
 *   - Acquires a scoped sandbox session per run
 *   - Wires the event bus hook for SSE streaming
 *   - Persists the conversation to SessionStorage after completion
 *   - Runs as a daemon fiber (fire-and-forget from the HTTP handler)
 */
import {
  Cause,
  Duration,
  Effect,
  Layer,
  Match,
  Option,
  Ref,
  Stream,
} from 'effect'
import {
  AiError,
  Chat,
  LanguageModel,
  Prompt,
  type Response,
} from 'effect/unstable/ai'
import {
  CurrentFiles,
  CurrentShell,
  SandboxError,
  run,
  Sandbox,
  type Shell,
  type Files,
} from '@sorato/core'
import { ProjectStorage } from './project/project.ts'
import {
  SessionStorage,
  type MessageNode,
  type SessionId,
  type StoredMessageEncoded,
} from './session/session.ts'
import {
  AGENTS_MD_PATH,
  AllTools,
  type CompactBoundary,
  type CompactConversationInput,
  CurrentCompaction,
  SYSTEM_PROMPT,
  loadAgentsMd,
} from './agent-config.ts'
import { createBusHook, EventBus } from './event-bus.ts'
import {
  appendReplayEvent,
  endEventReplay,
  startEventReplay,
} from './event-replay.ts'
import { ModelLayerResolver, resolveModel } from './model-catalog.ts'
import { dataDir } from './data-dir.ts'
import { createPersistenceHook } from './run-persistence.ts'
import {
  clearActiveRunParent,
  updateActiveRunBase,
  updateActiveRunParent,
  type RunRequest,
} from './run-registry.ts'
import { runLifecycleCheckpoint } from './run-lifecycle-checkpoints.ts'
import { generateSessionTitle } from './session-title.ts'
import { getAuth } from './provider-auth.ts'
import { RuntimeConfigService } from './runtime-config.ts'
import {
  resolveRunEnvironment,
  runEnvironmentErrorToSandboxError,
  withRunEnvironment,
} from './run-environment.ts'
import type { BillingMode } from './session/session.ts'

interface RunSandboxServices {
  readonly shell: Shell
  readonly files: Files
}

const inputText = (input: RunRequest['inputs'][number]) => input.text
const inputTexts = (inputs: RunRequest['inputs']) => inputs.map(inputText)

const userInputMessage = (
  input: RunRequest['inputs'][number]
): StoredMessageEncoded => {
  if (input.attachments.length === 0) {
    return { role: 'user', content: input.text }
  }

  return {
    role: 'user',
    content: [
      ...(input.text.trim().length > 0
        ? [Prompt.makePart('text', { text: input.text })]
        : []),
      ...input.attachments.map((attachment) =>
        Prompt.makePart('file', {
          mediaType: attachment.mediaType,
          fileName: attachment.fileName,
          data: attachment.data,
        })
      ),
    ],
  }
}

type RunFailureMessage = {
  readonly title: string
  readonly message: string
  readonly detail?: string | undefined
  readonly retryable: boolean
}

const providerLabel = (provider: string | undefined): string =>
  Match.value(provider).pipe(
    Match.when('openai', () => 'OpenAI'),
    Match.when('anthropic', () => 'Anthropic'),
    Match.orElse(() => 'Provider')
  )

const aiProviderMetadata = (error: AiError.AiError) => {
  const metadata = 'metadata' in error.reason ? error.reason.metadata : {}
  for (const [provider, value] of Object.entries(metadata)) {
    if (value !== null && typeof value === 'object') {
      return { provider, facts: value as Record<string, unknown> }
    }
  }
  return { provider: undefined, facts: {} as Record<string, unknown> }
}

const stringFact = (
  facts: Readonly<Record<string, unknown>>,
  key: string
): string | undefined =>
  typeof facts[key] === 'string' && facts[key].length > 0
    ? facts[key]
    : undefined

const numberFact = (
  facts: Readonly<Record<string, unknown>>,
  key: string
): number | undefined =>
  typeof facts[key] === 'number' ? facts[key] : undefined

const isProviderOverloaded = (
  facts: Readonly<Record<string, unknown>>
): boolean => {
  const status = numberFact(facts, 'status')
  return status !== undefined && status >= 500
}

const aiRunFailureMessage = (error: AiError.AiError): RunFailureMessage => {
  const { provider, facts } = aiProviderMetadata(error)
  const providerName = providerLabel(provider)
  const code = stringFact(facts, 'code') ?? stringFact(facts, 'type')
  const requestId = stringFact(facts, 'requestId')
  const detail = [code, requestId && `request ${requestId}`]
    .filter(Boolean)
    .join(' · ')
  const detailValue = detail.length > 0 ? detail : undefined

  switch (error.reason._tag) {
    case 'RateLimitError':
      return {
        title: `${providerName} rate limit reached`,
        message: 'Try again in a bit.',
        detail: detailValue,
        retryable: true,
      }
    case 'QuotaExhaustedError':
      return {
        title: `${providerName} quota exhausted`,
        message: `${providerName} reported that the account or billing quota is exhausted. Check billing and usage limits before retrying.`,
        detail: detailValue,
        retryable: false,
      }
    case 'AuthenticationError':
      return {
        title: `${providerName} authentication failed`,
        message: `${providerName} rejected the configured credentials. Verify the API key or sign in again.`,
        detail: detailValue,
        retryable: false,
      }
    case 'InvalidRequestError':
      return {
        title: `${providerName} rejected the request`,
        message: error.reason.description
          ? `${providerName} rejected the request: ${error.reason.description}`
          : `${providerName} rejected the request as invalid.`,
        detail: detailValue,
        retryable: false,
      }
    case 'ContentPolicyError':
      return {
        title: `${providerName} blocked the request`,
        message: `${providerName} blocked the request for policy reasons: ${error.reason.description}`,
        detail: detailValue,
        retryable: false,
      }
    case 'InternalProviderError': {
      const overloaded = isProviderOverloaded(facts)
      return {
        title: overloaded
          ? `${providerName} is temporarily unavailable`
          : `${providerName} request failed`,
        message: overloaded
          ? 'Try again in a bit.'
          : `${error.reason.description} Try again in a bit.`,
        detail: detailValue,
        retryable: true,
      }
    }
    default:
      return {
        title: 'Agent run failed',
        message: error.message,
        detail: detailValue,
        retryable: error.isRetryable,
      }
  }
}

const aiRunRetryingMessage = (error: AiError.AiError): string => {
  const { provider, facts } = aiProviderMetadata(error)
  const providerName = providerLabel(provider)

  if (error.reason._tag === 'RateLimitError') {
    return `${providerName} rate limit reached`
  }
  if (isProviderOverloaded(facts)) {
    return `${providerName} is temporarily unavailable`
  }
  return `${providerName} request failed`
}

const runFailureMessage = (
  runId: string,
  cause: Cause.Cause<unknown>
): RunFailureMessage => {
  const error = Option.getOrUndefined(Cause.findErrorOption(cause))
  if (AiError.isAiError(error)) return aiRunFailureMessage(error)

  return {
    title: 'Agent run failed',
    message: 'Agent run failed because of an unexpected server error.',
    detail: `Run ${runId}`,
    retryable: false,
  }
}

const SUMMARY_SYSTEM_PROMPT = `You summarize ranges of coding-agent conversation context for future continuation.
Return only the summary. Do not include preambles or explanations.
Preserve the user's goals, constraints, decisions, code/file changes, tool results that matter, unresolved tasks, and exact facts needed to continue.
Omit redundant chatter and details that are not useful for future work.`

const compactionSuccessMessage = 'Compaction successful.'

const emptyMessageText = '[empty]'

const messageText = (message: StoredMessageEncoded): string => {
  const content = message.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return emptyMessageText
  return content
    .map((part) => {
      switch (part.type) {
        case 'text':
        case 'reasoning':
          return part.text
        case 'file':
          return part.fileName ? `[file: ${part.fileName}]` : '[file]'
        case 'tool-call':
          return `[tool call: ${part.name} id=${part.id}] ${JSON.stringify(part.params)}`
        case 'tool-result':
          return `[tool result: ${part.name} id=${part.id}] ${part.result}`
        case 'tool-approval-request':
          return `[tool approval request: ${part.name} id=${part.id}]`
        case 'tool-approval-response':
          return `[tool approval response: ${part.name} id=${part.id}] ${part.approved ? 'approved' : 'rejected'}`
      }
    })
    .join('\n')
}

const hasLoadedInstruction = (
  messages: ReadonlyArray<StoredMessageEncoded>,
  path: string
): boolean =>
  messages.some(
    (message) =>
      message.role === 'system' && message.metadata?.loaded?.path === path
  )

const summaryPrompt = (
  messages: ReadonlyArray<StoredMessageEncoded>,
  instructions: string | undefined
) =>
  Prompt.make([
    { role: 'system' as const, content: SUMMARY_SYSTEM_PROMPT },
    {
      role: 'user' as const,
      content: [
        instructions && instructions.trim().length > 0
          ? `<extra-instructions>\n${instructions.trim()}\n</extra-instructions>`
          : null,
        '<conversation-range>',
        ...messages.map(
          (message, index) =>
            `<message index="${index + 1}" role="${message.role}">\n${messageText(message)}\n</message>`
        ),
        '</conversation-range>',
      ]
        .filter((part): part is string => part !== null)
        .join('\n'),
    },
  ])

const compactNodeSearchText = (message: {
  readonly id: string
  readonly messageId: string | null
  readonly summaryId: string | null
  readonly kind: 'message' | 'summary'
  readonly encoded: StoredMessageEncoded
}) =>
  [
    message.id,
    message.messageId,
    message.summaryId,
    message.kind,
    message.encoded.role,
    messageText(message.encoded),
  ]
    .filter((part): part is string => typeof part === 'string')
    .join('\n')

const compactCandidatePreview = (message: StoredMessageEncoded): string =>
  messageText(message).replace(/\s+/g, ' ').trim().slice(0, 180)

const compactCandidateDescription = (message: MessageNode): string =>
  `node_id=${message.id} kind=${message.kind} role=${message.encoded.role} preview=${JSON.stringify(compactCandidatePreview(message.encoded))}`

const normalizedCompactMatch = (value: string): string =>
  value.trim().toLowerCase()

const compactToolCallSearchText = (part: {
  readonly id: string
  readonly name: string
  readonly params?: unknown
}): string =>
  [part.id, part.name, JSON.stringify(part.params ?? null)].join('\n')

const compactToolResultSearchText = (part: {
  readonly id: string
  readonly name: string
  readonly result: unknown
}): string => [part.id, part.name, String(part.result)].join('\n')

const compactSelectorMatches = (
  path: ReadonlyArray<MessageNode>,
  selector: CompactBoundary
): ReadonlyArray<MessageNode> => {
  if (selector.type === 'node') {
    return path.filter((message) => message.id === selector.nodeId)
  }

  const needle = normalizedCompactMatch(selector.match)
  if (needle.length === 0) return []

  if (selector.type === 'message') {
    return path.filter((message) => {
      const matchesRole =
        selector.role === 'any' ||
        (selector.role === 'summary'
          ? message.kind === 'summary' ||
            (message.encoded.role === 'user' &&
              message.encoded.source === 'summary')
          : message.kind === 'message' &&
            message.encoded.role === selector.role)
      return (
        matchesRole &&
        compactNodeSearchText(message).toLowerCase().includes(needle)
      )
    })
  }

  return path.filter((message) =>
    compactToolSelectorMatches(message, selector, needle)
  )
}

const compactToolSelectorMatches = (
  message: MessageNode,
  selector: Extract<CompactBoundary, { readonly type: 'tool' }>,
  needle: string
): boolean => {
  const content = message.encoded.content
  if (!Array.isArray(content)) return false

  return content.some((part) => {
    if (selector.role === 'tool_call') {
      return (
        part.type === 'tool-call' &&
        part.name === selector.toolName &&
        compactToolCallSearchText(part).toLowerCase().includes(needle)
      )
    }
    return (
      part.type === 'tool-result' &&
      part.name === selector.toolName &&
      compactToolResultSearchText(part).toLowerCase().includes(needle)
    )
  })
}

const compactSelectorLabel = (selector: CompactBoundary): string => {
  switch (selector.type) {
    case 'node':
      return `node_id ${JSON.stringify(selector.nodeId)}`
    case 'message':
      return `${selector.role} message matching ${JSON.stringify(selector.match)}`
    case 'tool':
      return `${selector.role} ${JSON.stringify(selector.toolName)} matching ${JSON.stringify(selector.match)}`
  }
}

const isCompactConversationToolMessage = (message: MessageNode): boolean => {
  const content = message.encoded.content
  if (!Array.isArray(content)) return false
  return content.some(
    (part) =>
      (part.type === 'tool-call' || part.type === 'tool-result') &&
      part.name === 'CompactConversation'
  )
}

const compactResolutionFailure = (
  input: CompactConversationInput,
  path: ReadonlyArray<MessageNode>
): string => {
  const describe = (
    label: 'start' | 'end',
    selector: CompactBoundary
  ): string => {
    const matches = compactSelectorMatches(path, selector)
    if (selector.type !== 'node' && selector.match.trim().length === 0) {
      return `${label}: empty match text.`
    }
    if (matches.length === 0) {
      return `${label}: no current-branch node matched ${compactSelectorLabel(selector)}.`
    }

    return [
      `${label}: ${matches.length} current-branch nodes matched ${compactSelectorLabel(selector)}; retry with type=node and an exact nodeId from these candidates.`,
      ...matches.slice(0, 8).map(compactCandidateDescription),
      matches.length > 8
        ? `... ${matches.length - 8} more matches omitted.`
        : null,
    ]
      .filter((line): line is string => line !== null)
      .join('\n')
  }

  return [
    'Compaction range boundaries must each match exactly one non-compaction node on the current branch.',
    describe('start', input.start),
    describe('end', input.end),
    'Retry with type=node and exact nodeId values when snippets are absent or ambiguous.',
  ].join('\n')
}

const compactResolvedRange = (
  fullPath: ReadonlyArray<MessageNode>,
  resolutionPath: ReadonlyArray<MessageNode>,
  input: CompactConversationInput
):
  | {
      readonly _tag: 'Resolved'
      readonly startIndex: number
      readonly endIndex: number
    }
  | { readonly _tag: 'Failed'; readonly message: string } => {
  const startMatches = compactSelectorMatches(resolutionPath, input.start)
  const endMatches = compactSelectorMatches(resolutionPath, input.end)
  if (startMatches.length !== 1 || endMatches.length !== 1) {
    return {
      _tag: 'Failed',
      message: compactResolutionFailure(input, resolutionPath),
    }
  }

  const startNode = startMatches[0]
  const endNode = endMatches[0]
  if (startNode === undefined || endNode === undefined) {
    return {
      _tag: 'Failed',
      message: compactResolutionFailure(input, resolutionPath),
    }
  }

  const startBoundaryIndex = fullPath.findIndex(
    (message) => message.id === startNode.id
  )
  const endBoundaryIndex = fullPath.findIndex(
    (message) => message.id === endNode.id
  )
  if (startBoundaryIndex < 0 || endBoundaryIndex < 0) {
    return {
      _tag: 'Failed',
      message: 'Compaction range nodes were not found on the current branch.',
    }
  }

  const startIndex = startBoundaryIndex + (input.start.include ? 0 : 1)
  const endIndex = endBoundaryIndex - (input.end.include ? 0 : 1)

  if (
    startIndex < 0 ||
    endIndex < 0 ||
    startIndex >= fullPath.length ||
    endIndex >= fullPath.length
  ) {
    return {
      _tag: 'Failed',
      message: 'Compaction range is empty after applying include flags.',
    }
  }
  if (startIndex > endIndex) {
    return {
      _tag: 'Failed',
      message:
        'Compaction range must resolve in chronological order and be non-empty after applying include flags.',
    }
  }

  return { _tag: 'Resolved', startIndex, endIndex }
}

const runCompactRange = Effect.fn('RunAgent.compactRange')(function* (
  sessionId: SessionId,
  request: RunRequest,
  modelServices: Layer.Layer<LanguageModel.LanguageModel> | undefined
) {
  const compactRange = request.compactRange
  if (compactRange === undefined) return false

  const storage = yield* SessionStorage
  const bus = yield* EventBus

  const summaryTitle = 'Generating summary'
  startEventReplay(sessionId, request.runId, request.baseNodeId, 'summary', {
    visibility: 'background',
    title: summaryTitle,
  })
  yield* bus.publish({
    _tag: 'RunStart',
    sessionId,
    runId: request.runId,
    baseNodeId: request.baseNodeId,
    kind: 'summary',
    visibility: 'background',
    title: summaryTitle,
  })

  const path = yield* storage.messages(sessionId, compactRange.baseHeadNodeId)
  const startIndex = path.findIndex(
    (message) => message.id === compactRange.startNodeId
  )
  const endIndex = path.findIndex(
    (message) => message.id === compactRange.endNodeId
  )
  if (startIndex < 0 || endIndex < 0 || startIndex > endIndex) {
    return yield* Effect.die(
      new Error('Compact range must be ordered on the selected path')
    )
  }
  const compactedPath = path.slice(startIndex, endIndex + 1)
  if (
    compactedPath.some(
      (message) =>
        message.kind === 'message' &&
        message.encoded.role === 'system' &&
        (message.encoded.source === 'system-prompt' ||
          message.encoded.source === 'agents-md')
    )
  ) {
    return yield* Effect.die(
      new Error('Compact range cannot include bootstrap system messages')
    )
  }

  const chat = yield* Chat.fromPrompt(
    summaryPrompt(
      compactedPath.map((message) => message.encoded),
      compactRange.instructions
    )
  )

  if (modelServices === undefined) {
    return yield* Effect.die(
      new Error(`Model is not supported by this server: ${request.model}`)
    )
  }

  const summary = yield* chat.streamText({ prompt: [] }).pipe(
    Stream.filter(
      (
        part
      ): part is Extract<
        Response.StreamPart<Record<string, never>>,
        { type: 'text-delta' }
      > => part.type === 'text-delta'
    ),
    Stream.tap((part) =>
      Effect.sync(() =>
        appendReplayEvent(sessionId, request.runId, {
          _tag: 'TextDelta',
          sessionId,
          runId: request.runId,
          delta: part.delta,
        })
      ).pipe(Effect.flatMap((event) => bus.publish(event)))
    ),
    Stream.map((part) => part.delta),
    Stream.mkString,
    Effect.provide(modelServices)
  )

  const result = yield* storage.compactRange({
    sessionId,
    runId: request.runId,
    baseHeadNodeId: compactRange.baseHeadNodeId,
    startNodeId: compactRange.startNodeId,
    endNodeId: compactRange.endNodeId,
    summaryContent: summary.trim(),
  })
  updateActiveRunBase(request.runId, result.headNodeId)
  yield* bus.publish({
    _tag: 'RunBaseUpdated',
    sessionId,
    runId: request.runId,
    baseNodeId: result.headNodeId,
  })
  yield* bus.publish({ _tag: 'MessagesAppended', sessionId })
  return true
})

export const runAgent = (sessionId: SessionId, request: RunRequest) => {
  const runId = request.runId
  let runFailed = false
  let runInterrupted = false
  let completedHarness = false
  const terminalRunStatus = () =>
    runFailed
      ? 'failed'
      : runInterrupted || !completedHarness
        ? 'interrupted'
        : 'completed'
  const finalizeRun = Effect.gen(function* () {
    const status = terminalRunStatus()
    yield* Effect.sync(() => {
      endEventReplay(sessionId, runId, runFailed ? 'failed' : 'completed')
    })
    const storage = yield* SessionStorage
    yield* storage.completeRun({ id: runId, status }).pipe(
      Effect.catch((error) =>
        Effect.logWarning('Failed to mark agent run terminal', {
          runId,
          status,
          error: error.message,
        })
      )
    )
    const bus = yield* EventBus
    yield* bus.publish({ _tag: 'RunEnd', sessionId, runId })
  })

  return Effect.gen(function* () {
    yield* Effect.logInfo('Agent run starting', {
      runId,
      model: request.model,
      modelOptions: request.modelOptions,
      inputCount: request.inputs.length,
      inputLength: inputTexts(request.inputs).join('\n').length,
    })

    const storage = yield* SessionStorage
    const projects = yield* ProjectStorage
    const sandbox = yield* Sandbox
    const bus = yield* EventBus
    const modelResolver = yield* ModelLayerResolver

    const session = yield* storage.get(sessionId)
    const projectPath = yield* projects.resolvePath(session.projectId)
    const runtimeConfig = yield* RuntimeConfigService
    const projectConfig = yield* runtimeConfig.get(projectPath)
    yield* Effect.logInfo('Agent run loaded session', {
      runId,
      projectId: session.projectId,
      projectPath,
      baseNodeId: request.baseNodeId ?? null,
    })

    const resolvedModel = resolveModel(request.model)
    if (!resolvedModel) {
      return yield* Effect.die(
        new Error(`Model is not supported by this server: ${request.model}`)
      )
    }
    const auth = yield* getAuth(resolvedModel.providerId)
    const billingMode: BillingMode =
      auth?.type === 'oauth' ? 'subscription' : 'api-key'

    yield* storage.createRun({
      id: runId,
      sessionId,
      providerId: resolvedModel.providerId,
      modelId: resolvedModel.modelId,
      billingMode,
      baseNodeId: request.baseNodeId ?? null,
    })

    const modelServices = yield* modelResolver
      .resolve(dataDir, {
        id: request.model,
        sessionId,
        onRetry: (info) => {
          const retryAt = Date.now() + Duration.toMillis(info.delay)
          Effect.runFork(
            bus.publish({
              _tag: 'RunRetrying',
              sessionId,
              runId,
              title: aiRunRetryingMessage(info.error),
              message: '',
              retryAt,
              attempt: info.attempt,
              maxAttempts: info.maxAttempts,
            })
          )
        },
        ...request.modelOptions,
      })
      .pipe(
        Effect.flatMap((layer) =>
          Effect.fromNullishOr(layer).pipe(
            Effect.mapError(
              () =>
                new Error(
                  `Model is not supported by this server: ${request.model}`
                )
            ),
            Effect.orDie
          )
        )
      )
    yield* Effect.logInfo('Agent run resolved model layer', { runId })

    const compacted = yield* runCompactRange(sessionId, request, modelServices)
    if (compacted) return

    const existingConversation = yield* storage.conversation(
      sessionId,
      request.baseNodeId
    )
    const isFirstMessage = existingConversation.content.length === 0
    const shouldSetTitle = Effect.succeed(
      isFirstMessage && session.title === null
    )
    const publishSessionUpdated = bus.publish({
      _tag: 'SessionUpdated',
      sessionId,
    })
    const maybeSetTitle = generateSessionTitle(
      projectPath,
      inputTexts(request.inputs).join('\n')
    ).pipe(
      Effect.flatMap((title) =>
        Option.match(title, {
          onNone: () => Effect.void,
          onSome: (title) => {
            const setTitle = storage.setTitle(sessionId, title)
            return setTitle.pipe(Effect.andThen(publishSessionUpdated))
          },
        })
      ),
      Effect.when(shouldSetTitle)
    )
    yield* sandbox.acquire(projectPath).pipe(
      Effect.tap(() =>
        Effect.logInfo('Agent run acquired sandbox', {
          runId,
          projectPath,
        })
      ),
      Effect.flatMap(({ shell, files }) =>
        resolveRunEnvironment(
          shell,
          projectPath,
          projectConfig.environment_command
        ).pipe(
          Effect.map(
            (environment) =>
              ({
                shell: withRunEnvironment(shell, environment),
                files,
              }) satisfies RunSandboxServices
          ),
          Effect.catchTag('RunEnvironmentError', (error) =>
            Effect.fail(runEnvironmentErrorToSandboxError(error))
          ),
          Effect.catchTag('SandboxError', (error) =>
            Effect.fail(
              new SandboxError({
                operation: 'resolveRunEnvironment',
                message: `Failed to run environment command: ${error.message}`,
                error,
              })
            )
          )
        )
      ),
      Effect.flatMap(({ shell, files }: RunSandboxServices) =>
        storage.messages(sessionId, request.baseNodeId).pipe(
          Effect.flatMap((storedHistory) => {
            const shouldLoadAgentsMd = !hasLoadedInstruction(
              storedHistory.map((message) => message.encoded),
              AGENTS_MD_PATH
            )
            return shouldLoadAgentsMd
              ? loadAgentsMd(files)
              : Effect.succeed(undefined)
          }),
          Effect.map((agentsMd) => {
            const preamble: Array<StoredMessageEncoded> = [
              ...(isFirstMessage
                ? [
                    {
                      role: 'system' as const,
                      content: SYSTEM_PROMPT,
                      source: 'system-prompt' as const,
                      display: { title: 'System Prompt' },
                    },
                  ]
                : []),
              ...(agentsMd === undefined
                ? []
                : [
                    {
                      role: 'system' as const,
                      content: agentsMd,
                      source: 'agents-md' as const,
                      display: { title: 'AGENTS.md' },
                      metadata: { loaded: { path: AGENTS_MD_PATH } },
                    },
                  ]),
              ...request.inputs.map(userInputMessage),
            ]
            return preamble
          }),
          Effect.flatMap((preamble) =>
            storage
              .append(sessionId, runId, preamble, request.baseNodeId)
              .pipe(
                Effect.map((preambleNodeIds) => ({ preamble, preambleNodeIds }))
              )
          ),
          Effect.tap(({ preamble }) =>
            Effect.logInfo('Agent run appended user input', {
              runId,
              appendedMessages: preamble.length,
              wasEmptySession: isFirstMessage,
            })
          ),
          Effect.tap(() =>
            runLifecycleCheckpoint('afterAgentPreambleAppended', runId)
          ),
          Effect.tap(() => {
            const startReplay = Effect.sync(() => {
              startEventReplay(sessionId, runId, request.baseNodeId, 'agent')
            })
            const publishRunStart = bus.publish({
              _tag: 'RunStart',
              sessionId,
              runId,
              baseNodeId: request.baseNodeId,
              kind: 'agent',
            })

            return bus
              .publish({ _tag: 'MessagesAppended', sessionId })
              .pipe(
                Effect.andThen(startReplay),
                Effect.andThen(publishRunStart)
              )
          }),
          Effect.tap(() => Effect.forkDetach(maybeSetTitle)),
          Effect.tap(() =>
            Effect.logInfo('Agent run published lifecycle start', { runId })
          ),
          Effect.flatMap(({ preambleNodeIds }) => {
            const appendBaseNodeId =
              preambleNodeIds.at(-1) ?? request.baseNodeId
            return storage.conversation(sessionId, appendBaseNodeId).pipe(
              Effect.map((conversation) => ({
                appendBaseNodeId,
                conversation,
              }))
            )
          }),
          Effect.tap(({ conversation }) =>
            Effect.logInfo('Agent run starting harness', {
              runId,
              messageCountBeforeRun: conversation.content.length,
            })
          ),
          Effect.flatMap(({ appendBaseNodeId, conversation }) =>
            // oxlint-disable-next-line sorato/no-nested-effect-gen -- diagnostics prefer Effect.gen over immediate Effect.fn here; extracting this large scoped closure is separate cleanup
            Effect.gen(function* () {
              const messageCountBeforeRun = conversation.content.length
              const appendBaseRef = yield* Ref.make(appendBaseNodeId)
              const compactToolCallIdRef = yield* Ref.make<string | null>(null)
              const busHook = yield* createBusHook(sessionId, runId)
              const trackedBusHook = {
                name: 'tracked-event-bus',
                handle: (event: Parameters<typeof busHook.handle>[0]) =>
                  (event._tag === 'ToolCall' &&
                  event.name === 'CompactConversation'
                    ? Ref.set(compactToolCallIdRef, event.id)
                    : Effect.void
                  ).pipe(Effect.andThen(busHook.handle(event))),
              }
              const persistHook = yield* createPersistenceHook(
                sessionId,
                runId,
                messageCountBeforeRun,
                appendBaseRef,
                {
                  providerId: resolvedModel.providerId,
                  modelId: resolvedModel.modelId,
                  billingMode,
                  cost: resolvedModel.model.cost,
                }
              )

              const compaction = {
                compactRange: (input: CompactConversationInput) =>
                  // oxlint-disable-next-line sorato/no-nested-effect-gen -- compact tool implementation is an effectful callback closed over run state
                  Effect.gen(function* () {
                    const baseHeadNodeId = yield* Ref.get(appendBaseRef)
                    if (baseHeadNodeId === null) {
                      return yield* Effect.fail(
                        'Cannot compact an empty conversation branch.'
                      )
                    }

                    const path = yield* storage.messages(
                      sessionId,
                      baseHeadNodeId
                    )
                    const resolutionPath = path.filter(
                      (message) => !isCompactConversationToolMessage(message)
                    )
                    const resolvedRange = compactResolvedRange(
                      path,
                      resolutionPath,
                      input
                    )
                    if (resolvedRange._tag === 'Failed') {
                      return yield* Effect.fail(resolvedRange.message)
                    }

                    const startNodeId = path[resolvedRange.startIndex]?.id
                    const endNodeId = path[resolvedRange.endIndex]?.id
                    if (startNodeId === undefined || endNodeId === undefined) {
                      return yield* Effect.fail(
                        'Compaction range could not be resolved.'
                      )
                    }

                    const compactToolCallId =
                      yield* Ref.get(compactToolCallIdRef)
                    if (compactToolCallId === null) {
                      return yield* Effect.fail(
                        'Compaction tool call could not be associated with the active run.'
                      )
                    }

                    const summaryRunId = crypto.randomUUID()
                    yield* storage.createRun({
                      id: summaryRunId,
                      sessionId,
                      providerId: resolvedModel.providerId,
                      modelId: resolvedModel.modelId,
                      billingMode,
                      baseNodeId: baseHeadNodeId,
                    })
                    updateActiveRunParent(
                      summaryRunId,
                      runId,
                      compactToolCallId
                    )

                    // oxlint-disable-next-line sorato/no-nested-effect-gen -- summary run finalization is intentionally sequenced after validation and run creation
                    return yield* Effect.gen(function* () {
                      let summaryStarted = false
                      let summaryFailed = false
                      let summaryCompleted = false
                      // oxlint-disable-next-line sorato/no-nested-effect-gen -- summary run cleanup must close over mutable terminal state for interruption-safe finalization
                      const finalizeSummaryRun = Effect.gen(function* () {
                        const summaryStatus = summaryFailed
                          ? 'failed'
                          : summaryCompleted
                            ? 'completed'
                            : 'interrupted'
                        yield* Effect.sync(() =>
                          endEventReplay(
                            sessionId,
                            summaryRunId,
                            summaryFailed ? 'failed' : 'completed'
                          )
                        )
                        yield* Effect.sync(() =>
                          clearActiveRunParent(summaryRunId)
                        )
                        yield* storage
                          .completeRun({
                            id: summaryRunId,
                            status: summaryStatus,
                          })
                          .pipe(
                            Effect.catch((error) =>
                              Effect.logWarning(
                                'Failed to mark summary run terminal',
                                {
                                  runId: summaryRunId,
                                  status: summaryStatus,
                                  error: error.message,
                                }
                              )
                            )
                          )
                        if (summaryStarted) {
                          yield* bus.publish({
                            _tag: 'RunEnd',
                            sessionId,
                            runId: summaryRunId,
                          })
                        }
                      })

                      const compactedPath = path.slice(
                        resolvedRange.startIndex,
                        resolvedRange.endIndex + 1
                      )
                      if (
                        compactedPath.some(
                          (message) =>
                            message.kind === 'message' &&
                            message.encoded.role === 'system' &&
                            (message.encoded.source === 'system-prompt' ||
                              message.encoded.source === 'agents-md')
                        )
                      ) {
                        return yield* Effect.fail(
                          'Compact range cannot include bootstrap system messages.'
                        )
                      }

                      // oxlint-disable-next-line sorato/no-nested-effect-gen -- summary run body needs an ensuring finalizer around the interruptible stream
                      return yield* Effect.gen(function* () {
                        const chat = yield* Chat.fromPrompt(
                          summaryPrompt(
                            compactedPath.map((message) => message.encoded),
                            input.instructions
                          )
                        )
                        const summaryTitle = 'Generating summary'
                        yield* Effect.sync(() =>
                          startEventReplay(
                            sessionId,
                            summaryRunId,
                            baseHeadNodeId,
                            'summary',
                            {
                              visibility: 'background',
                              title: summaryTitle,
                              parentRunId: runId,
                              toolCallId: compactToolCallId,
                            }
                          )
                        )
                        yield* bus.publish({
                          _tag: 'RunStart',
                          sessionId,
                          runId: summaryRunId,
                          baseNodeId: baseHeadNodeId,
                          kind: 'summary',
                          visibility: 'background',
                          title: summaryTitle,
                          parentRunId: runId,
                          toolCallId: compactToolCallId,
                        })
                        summaryStarted = true

                        const summary = yield* chat
                          .streamText({ prompt: [] })
                          .pipe(
                            Stream.filter(
                              (
                                part
                              ): part is Extract<
                                Response.StreamPart<Record<string, never>>,
                                { type: 'text-delta' }
                              > => part.type === 'text-delta'
                            ),
                            Stream.tap((part) =>
                              Effect.sync(() =>
                                appendReplayEvent(sessionId, summaryRunId, {
                                  _tag: 'TextDelta',
                                  sessionId,
                                  runId: summaryRunId,
                                  delta: part.delta,
                                })
                              ).pipe(
                                Effect.flatMap((event) => bus.publish(event))
                              )
                            ),
                            Stream.map((part) => part.delta),
                            Stream.mkString,
                            Effect.provide(modelServices)
                          )
                        const result = yield* storage.compactRange({
                          sessionId,
                          runId: summaryRunId,
                          baseHeadNodeId,
                          startNodeId,
                          endNodeId,
                          summaryContent: summary.trim(),
                        })
                        yield* Ref.set(appendBaseRef, result.headNodeId)
                        updateActiveRunBase(runId, result.headNodeId)
                        yield* bus.publish({
                          _tag: 'RunBaseUpdated',
                          sessionId,
                          runId,
                          baseNodeId: result.headNodeId,
                        })
                        yield* bus.publish({
                          _tag: 'MessagesAppended',
                          sessionId,
                          runId: summaryRunId,
                        })
                        summaryCompleted = true
                        return compactionSuccessMessage
                      }).pipe(
                        Effect.catchCause((cause) => {
                          const refail = Effect.failCause(cause)
                          return Effect.sync(() => {
                            summaryFailed = !Cause.hasInterruptsOnly(cause)
                          }).pipe(
                            // oxlint-disable-next-line sorato/no-nested-effect-call -- refail is named for readability in this cause-preserving handler
                            Effect.andThen(refail)
                          )
                        }),
                        Effect.ensuring(finalizeSummaryRun)
                      )
                    })
                  }).pipe(
                    Effect.catch((error) => {
                      const message =
                        typeof error === 'string'
                          ? error
                          : error instanceof Error
                            ? error.message
                            : String(error)
                      return Effect.fail(message).pipe(
                        Effect.tapError(() =>
                          Effect.logWarning('Compaction tool failed', {
                            message,
                          })
                        )
                      )
                    })
                  ),
              }

              return yield* Effect.provide(
                run(conversation, {
                  toolkit: AllTools,
                  hooks: [trackedBusHook, persistHook],
                }),
                Layer.mergeAll(
                  Layer.succeed(CurrentShell, shell),
                  Layer.succeed(CurrentFiles, files),
                  Layer.succeed(CurrentCompaction, compaction),
                  modelServices
                )
              )
            }).pipe(Effect.withSpan('RunAgent.runHarnessWithCompaction'))
          )
        )
      ),
      Effect.scoped
    )

    yield* Effect.logInfo('Agent run completed harness', { runId })
    completedHarness = true
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.gen(function* () {
        if (Cause.hasInterruptsOnly(cause)) {
          yield* Effect.logInfo('Agent run interrupted', { runId })
          runInterrupted = true
        } else {
          runFailed = true
          yield* Effect.logError('Agent run failed', {
            runId,
            cause: Cause.pretty(cause),
          })
          const bus = yield* EventBus
          const failure = runFailureMessage(runId, cause)
          yield* bus.publish({
            _tag: 'RunFailed',
            sessionId,
            runId,
            title: failure.title,
            message: failure.message,
            detail: failure.detail,
            retryable: failure.retryable,
          })
        }
      })
    ),
    Effect.ensuring(finalizeRun),
    Effect.annotateLogs({
      package: 'server',
      subsystem: 'run-agent',
      sessionId,
      runId,
    }),
    Effect.withLogSpan('server.runAgent')
  )
}
