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
import { Config, Effect, Layer, Schema } from 'effect'
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

    yield* Effect.scoped(
      Effect.gen(function* () {
        const { shell, files } = yield* sandbox.acquire(session.directory)

        const config = {
          systemPrompt: SYSTEM_PROMPT,
          toolkit: AllTools,
          hooks: [createBusHook(sessionId)],
        }

        const result = yield* run(input, config).pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(CurrentShell, shell),
              Layer.succeed(CurrentFiles, files)
            )
          )
        )

        // Encode the conversation and persist to storage
        const encoded = yield* Schema.encode(Prompt.Prompt)(
          result.conversation
        ).pipe(
          Effect.mapError(
            (error) =>
              new StorageError({
                operation: 'run',
                message: `Failed to encode conversation: ${String(error)}`,
              })
          )
        )

        yield* storage.append(sessionId, encoded.content)

        // Notify clients that messages are available
        publish({ _tag: 'MessagesAppended', sessionId })
        publish({ _tag: 'SessionUpdated', sessionId })
      })
    )
  }).pipe(
    Effect.catchAllCause((cause) =>
      Effect.sync(() => {
        // Log the error and notify clients the run ended (even on failure)
        console.error(`Agent run failed for session ${sessionId}:`, cause)
        publish({ _tag: 'RunEnd', sessionId })
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
