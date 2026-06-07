/**
 * Agent run orchestration for the HTTP server.
 *
 * Bridges the harness `run()` function with server infrastructure:
 *   - Acquires a scoped sandbox session per run
 *   - Wires the event bus hook for SSE streaming
 *   - Persists the conversation to SessionStorage after completion
 *   - Runs as a daemon fiber (fire-and-forget from the HTTP handler)
 */
import { Cause, Effect, Layer, Match, Option } from 'effect'
import type { Prompt } from 'effect/unstable/ai'
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
    startEventReplay(sessionId, runId)
    publish({ _tag: 'RunStart', sessionId, runId })
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
    const modelCallStartedAt = Date.now()

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
                  startedAt: modelCallStartedAt,
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
          const storage = yield* SessionStorage
          yield* storage
            .completeRun({ id: runId, status: 'failed' })
            .pipe(Effect.catch(() => Effect.void))
          yield* Effect.logError('Agent run failed', {
            runId,
            cause: Cause.pretty(cause),
          })
          publish({
            _tag: 'RunFailed',
            sessionId,
            runId,
            message: 'Agent run failed. Check the server logs for details.',
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
