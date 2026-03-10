/**
 * Agent — in-process harness execution for the HTTP server.
 *
 * Bridges the harness `run()` function with server infrastructure:
 *   - Acquires a scoped sandbox session per run
 *   - Wires the event bus hook for SSE streaming
 *   - Persists the conversation to SessionStorage after completion
 *   - Runs as a daemon fiber (fire-and-forget from the HTTP handler)
 *
 * Layers required (provided at server level):
 *   - LanguageModel (via AnthropicLanguageModel)
 *   - Sandbox (via LocalSandboxLive)
 *   - Tool handlers (via AllToolsLayer)
 *   - SessionStorage (via SqliteSession)
 */
import { Prompt } from '@effect/ai'
import { AnthropicClient, AnthropicLanguageModel } from '@effect/ai-anthropic'
import { FetchHttpClient } from '@effect/platform'
import { Cause, Config, Effect, Layer, Schema } from 'effect'
import { StorageError } from '../session/session.ts'
import {
  run,
  Sandbox,
  CurrentShell,
  CurrentFiles,
  LocalSandboxLive,
  Toolkit,
  ReadFile,
  ReadFileHandler,
  EditFile,
  EditFileHandler,
  WriteFile,
  WriteFileHandler,
  Bash,
  BashHandler,
  Glob,
  GlobHandler,
  Grep,
  GrepHandler,
  SessionStorage,
  type HarnessEvent,
  type HarnessHook,
  type SessionId,
} from '../index.ts'
import { createBusHook, publish } from './EventBus.ts'

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a helpful coding agent. You have access to tools for reading, editing, writing, and searching files, as well as running shell commands. Use them as needed to help the user.

When the user asks you to do something:
1. Think about what needs to be done
2. Use the appropriate tools to accomplish the task
3. Explain what you did

Be concise and direct.`

// ---------------------------------------------------------------------------
// Toolkit
// ---------------------------------------------------------------------------

/** All available tools, bundled as a single toolkit. */
export const AllTools = Toolkit.make(
  ReadFile,
  EditFile,
  WriteFile,
  Bash,
  Glob,
  Grep
)

/** Layer that provides tool handler implementations. */
export const AllToolsLayer = AllTools.toLayer({
  ...ReadFileHandler,
  ...EditFileHandler,
  ...WriteFileHandler,
  ...BashHandler,
  ...GlobHandler,
  ...GrepHandler,
})

// ---------------------------------------------------------------------------
// Model layer
// ---------------------------------------------------------------------------

export const ModelLive = AnthropicLanguageModel.layer({
  model: 'claude-sonnet-4-20250514',
}).pipe(
  Layer.provide(
    AnthropicClient.layerConfig({
      apiKey: Config.redacted('ANTHROPIC_API_KEY'),
    })
  ),
  Layer.provide(FetchHttpClient.layer)
)

// ---------------------------------------------------------------------------
// Agent run
// ---------------------------------------------------------------------------

/**
 * Run the agent for a session. Fire-and-forget — returns immediately,
 * streams events via the event bus, persists messages when done.
 *
 * Call this from the HTTP handler via `Effect.forkDaemon`.
 */
export const runAgent = (sessionId: SessionId, input: string) =>
  Effect.gen(function* () {
    const storage = yield* SessionStorage
    const sandbox = yield* Sandbox

    const session = yield* storage.get(sessionId)

    // ---------------------------------------------------------------
    // Phase 1: Persist the user message (+ system prompt if first)
    // BEFORE starting the harness. This way the user's message shows
    // up in the UI immediately via MessagesAppended, regardless of
    // how long the model takes to respond.
    // ---------------------------------------------------------------
    const existingConversation = yield* storage.conversation(sessionId)
    const isFirstMessage = existingConversation.content.length === 0

    const preamble: Array<Prompt.MessageEncoded> = isFirstMessage
      ? [
          { role: 'system' as const, content: SYSTEM_PROMPT },
          { role: 'user' as const, content: input },
        ]
      : [{ role: 'user' as const, content: input }]

    yield* storage.append(sessionId, preamble)
    publish({ _tag: 'MessagesAppended', sessionId })

    // Notify clients the run is live — drives the "running" indicator.
    publish({ _tag: 'RunStart', sessionId })

    // ---------------------------------------------------------------
    // Phase 2: Load the full conversation (now includes user message)
    // and run the harness. run() continues from the conversation as-is.
    //
    // run() manages interruptibility internally via its own
    // uninterruptibleMask — the agent loop is interruptible (so the
    // user can stop mid-stream) but cleanup always completes.
    //
    // Persistence happens via a RunResult hook that fires inside
    // run()'s uninterruptible cleanup region — guaranteed on both
    // normal completion and interrupt. No Ref side-channel needed.
    // ---------------------------------------------------------------
    const conversation = yield* storage.conversation(sessionId)
    const messageCountBeforeRun = conversation.content.length

    // Hook that persists new messages when run() completes (or is
    // interrupted). Fires inside run()'s uninterruptible region,
    // so it's guaranteed to execute in all cases.
    const persistHook: HarnessHook<StorageError> = {
      name: 'persist',
      handle: (event: HarnessEvent) =>
        Effect.gen(function* () {
          if (event._tag !== 'RunResult') return

          const encoded = yield* Schema.encode(Prompt.Prompt)(
            event.result.conversation
          ).pipe(
            Effect.mapError(
              (error) =>
                new StorageError({
                  operation: 'run',
                  message: `Failed to encode conversation: ${String(error)}`,
                })
            )
          )

          const newMessages = encoded.content.slice(messageCountBeforeRun)
          if (newMessages.length === 0) return

          yield* storage.append(sessionId, newMessages)
          publish({ _tag: 'MessagesAppended', sessionId })
          publish({ _tag: 'SessionUpdated', sessionId })
        }),
    }

    yield* Effect.scoped(
      Effect.gen(function* () {
        const { shell, files } = yield* sandbox.acquire(session.directory)

        const config = {
          toolkit: AllTools,
          hooks: [createBusHook(sessionId), persistHook],
        }

        yield* run(conversation, config).pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(CurrentShell, shell),
              Layer.succeed(CurrentFiles, files)
            )
          )
        )
      })
    )
  }).pipe(
    // RunEnd fires unconditionally — success, failure, or interrupt.
    // This is the single source of truth for "the run is done".
    Effect.ensuring(Effect.sync(() => publish({ _tag: 'RunEnd', sessionId }))),
    Effect.catchAllCause((cause) =>
      Effect.sync(() => {
        if (Cause.isInterruptedOnly(cause)) {
          console.log(`Agent run interrupted for session ${sessionId}`)
        } else {
          console.error(`Agent run failed for session ${sessionId}:`, cause)
        }
      })
    ),
    Effect.annotateLogs('sessionId', sessionId)
  )

// ---------------------------------------------------------------------------
// Composite layer for the server
// ---------------------------------------------------------------------------

/**
 * All agent-related layers merged. Provide this to the server
 * to enable the run endpoint.
 */
export const AgentLive = Layer.mergeAll(
  AllToolsLayer,
  LocalSandboxLive,
  ModelLive
)
