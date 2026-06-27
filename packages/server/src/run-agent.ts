/**
 * Agent run orchestration for the HTTP server.
 *
 * Bridges the harness `run()` function with server infrastructure:
 *   - Acquires a scoped sandbox session per run
 *   - Wires the event bus hook for SSE streaming
 *   - Persists the conversation to SessionStorage after completion
 *   - Runs as a daemon fiber (fire-and-forget from the HTTP handler)
 */
import { Cause, Duration, Effect, Layer, Match, Option, Stream } from 'effect'
import {
  AiError,
  Chat,
  LanguageModel,
  Prompt,
  type Response,
} from 'effect/unstable/ai'
import { CurrentFiles, CurrentShell, run, Sandbox } from '@sorato/core'
import { ProjectStorage } from './project/project.ts'
import {
  SessionStorage,
  type SessionId,
  type StoredMessageEncoded,
} from './session/session.ts'
import {
  AGENTS_MD_PATH,
  AllTools,
  SYSTEM_PROMPT,
  loadAgentsMd,
} from './agent-config.ts'
import { createBusHook, EventBus } from './event-bus.ts'
import {
  appendReplayEvent,
  endEventReplay,
  startEventReplay,
} from './event-replay.ts'
import { modelLayer, resolveModel } from './model-catalog.ts'
import { dataDir } from './data-dir.ts'
import { createPersistenceHook } from './run-persistence.ts'
import type { RunRequest } from './run-registry.ts'
import { generateSessionTitle } from './session-title.ts'
import { getAuth } from './provider-auth.ts'
import type { BillingMode } from './session/session.ts'

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
          return `[tool call: ${part.name}] ${JSON.stringify(part.params)}`
        case 'tool-result':
          return `[tool result: ${part.name}] ${part.result}`
        case 'tool-approval-request':
          return `[tool approval request: ${part.name}]`
        case 'tool-approval-response':
          return `[tool approval response: ${part.name}] ${part.approved ? 'approved' : 'rejected'}`
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

const runCompactRange = Effect.fn('RunAgent.compactRange')(function* (
  sessionId: SessionId,
  request: RunRequest,
  modelServices: Layer.Layer<LanguageModel.LanguageModel> | undefined
) {
  const compactRange = request.compactRange
  if (compactRange === undefined) return false

  const storage = yield* SessionStorage
  const bus = yield* EventBus

  startEventReplay(
    sessionId,
    request.runId,
    compactRange.baseHeadNodeId,
    'summary'
  )
  yield* bus.publish({
    _tag: 'RunStart',
    sessionId,
    runId: request.runId,
    baseNodeId: compactRange.baseHeadNodeId,
    kind: 'summary',
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

  const chat = yield* Chat.fromPrompt(
    summaryPrompt(
      path.slice(startIndex, endIndex + 1).map((message) => message.encoded),
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

  yield* storage.compactRange({
    sessionId,
    runId: request.runId,
    baseHeadNodeId: compactRange.baseHeadNodeId,
    startNodeId: compactRange.startNodeId,
    endNodeId: compactRange.endNodeId,
    summaryContent: summary.trim(),
  })
  yield* bus.publish({ _tag: 'MessagesAppended', sessionId })
  return true
})

export const runAgent = (sessionId: SessionId, request: RunRequest) => {
  const runId = request.runId
  let runFailed = false
  const finalizeRun = Effect.gen(function* () {
    endEventReplay(sessionId, runId, runFailed ? 'failed' : 'completed')
    const bus = yield* EventBus
    yield* bus.publish({ _tag: 'RunEnd', sessionId, runId })
  })

  return Effect.gen(function* () {
    yield* Effect.logInfo('Agent run starting', {
      runId,
      model: request.model,
      modelOptions: request.modelOptions,
      inputCount: request.inputs.length,
      inputLength: request.inputs.join('\n').length,
    })

    const storage = yield* SessionStorage
    const projects = yield* ProjectStorage
    const sandbox = yield* Sandbox
    const bus = yield* EventBus

    const session = yield* storage.get(sessionId)
    const projectPath = yield* projects.resolvePath(session.projectId)
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

    const modelServices = yield* modelLayer(dataDir, {
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
    }).pipe(
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
      request.inputs.join('\n')
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
              ...request.inputs.map((input) => ({
                role: 'user' as const,
                content: input,
              })),
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
          Effect.flatMap(({ appendBaseNodeId, conversation }) => {
            const messageCountBeforeRun = conversation.content.length
            return Effect.all([
              createBusHook(sessionId, runId),
              createPersistenceHook(
                sessionId,
                runId,
                messageCountBeforeRun,
                appendBaseNodeId,
                {
                  providerId: resolvedModel.providerId,
                  modelId: resolvedModel.modelId,
                  billingMode,
                  cost: resolvedModel.model.cost,
                }
              ),
            ]).pipe(
              Effect.flatMap(([busHook, persistHook]) =>
                Effect.provide(
                  run(conversation, {
                    toolkit: AllTools,
                    hooks: [busHook, persistHook],
                  }),
                  Layer.mergeAll(
                    Layer.succeed(CurrentShell, shell),
                    Layer.succeed(CurrentFiles, files),
                    modelServices
                  )
                )
              )
            )
          })
        )
      ),
      Effect.scoped
    )

    yield* Effect.logInfo('Agent run completed harness', { runId })
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.gen(function* () {
        if (Cause.hasInterruptsOnly(cause)) {
          yield* Effect.logInfo('Agent run interrupted', { runId })
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
