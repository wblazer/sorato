/**
 * Agent run orchestration for the HTTP server.
 *
 * Bridges the harness `run()` function with server infrastructure:
 *   - Acquires a scoped sandbox session per run
 *   - Wires the event bus hook for SSE streaming
 *   - Persists the conversation to SessionStorage after completion
 *   - Runs as a daemon fiber (fire-and-forget from the HTTP handler)
 */
import { Cause, Duration, Effect, Layer, Match, Option } from 'effect'
import { AiError, type Prompt } from 'effect/unstable/ai'
import { CurrentFiles, CurrentShell, run, Sandbox } from '@sorato/core'
import { ProjectStorage } from './project/project.ts'
import { SessionStorage, type SessionId } from './session/session.ts'
import { AllTools, SYSTEM_PROMPT } from './agent-config.ts'
import { createBusHook, publish } from './event-bus.ts'
import { endEventReplay, startEventReplay } from './event-replay.ts'
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

export const runAgent = (sessionId: SessionId, request: RunRequest) => {
  const runId = request.runId
  let runFailed = false
  const finalizeRun = Effect.sync(() => {
    endEventReplay(sessionId, runId, runFailed ? 'failed' : 'completed')
    publish({ _tag: 'RunEnd', sessionId, runId })
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
        publish({
          _tag: 'RunRetrying',
          sessionId,
          runId,
          title: aiRunRetryingMessage(info.error),
          message: '',
          retryAt,
          attempt: info.attempt,
          maxAttempts: info.maxAttempts,
        })
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

    const existingConversation = yield* storage.conversation(
      sessionId,
      request.baseNodeId
    )
    const isFirstMessage = existingConversation.content.length === 0
    const shouldSetTitle = Effect.succeed(
      isFirstMessage && session.title === null
    )
    const publishSessionUpdated = Effect.sync(() =>
      publish({ _tag: 'SessionUpdated', sessionId })
    )
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
    const preamble: Array<Prompt.MessageEncoded> = Match.value(
      isFirstMessage
    ).pipe(
      Match.when(true, () => [
        {
          role: 'system' as const,
          content: SYSTEM_PROMPT,
          source: 'system-prompt' as const,
          display: { title: 'System Prompt' },
        },
        ...request.inputs.map((input) => ({
          role: 'user' as const,
          content: input,
        })),
      ]),
      Match.orElse(() =>
        request.inputs.map((input) => ({
          role: 'user' as const,
          content: input,
        }))
      )
    )

    const preambleNodeIds = yield* storage.append(
      sessionId,
      runId,
      preamble,
      request.baseNodeId
    )
    yield* Effect.logInfo('Agent run appended user input', {
      runId,
      appendedMessages: preamble.length,
      wasEmptySession: isFirstMessage,
    })
    publish({ _tag: 'MessagesAppended', sessionId })
    startEventReplay(sessionId, runId, request.baseNodeId)
    publish({
      _tag: 'RunStart',
      sessionId,
      runId,
      baseNodeId: request.baseNodeId,
    })
    yield* Effect.forkDetach(maybeSetTitle)
    yield* Effect.logInfo('Agent run published lifecycle start', { runId })

    const appendBaseNodeId = preambleNodeIds.at(-1) ?? request.baseNodeId
    const conversation = yield* storage.conversation(
      sessionId,
      appendBaseNodeId
    )
    const messageCountBeforeRun = conversation.content.length
    yield* Effect.logInfo('Agent run starting harness', {
      runId,
      messageCountBeforeRun,
    })

    yield* sandbox.acquire(projectPath).pipe(
      Effect.tap(() =>
        Effect.logInfo('Agent run acquired sandbox', {
          runId,
          projectPath,
        })
      ),
      Effect.flatMap(({ shell, files }) =>
        Effect.provide(
          run(conversation, {
            toolkit: AllTools,
            hooks: [
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
            ],
          }),
          Layer.mergeAll(
            Layer.succeed(CurrentShell, shell),
            Layer.succeed(CurrentFiles, files),
            modelServices
          )
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
          const failure = runFailureMessage(runId, cause)
          publish({
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
