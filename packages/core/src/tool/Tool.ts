/**
 * Agent tools — @effect/ai Toolkit tools that delegate to SandboxSession.
 *
 * Each tool is a schema declaration (what the LLM sees) paired with a handler
 * (what actually runs). Handlers access the sandbox through the `CurrentSandbox`
 * tag in their `R` parameter — Effect's type system propagates this requirement
 * all the way up to the runner, which provides it.
 *
 * Tools use `failureMode: "return"` so errors flow back to the LLM as tool
 * results rather than crashing the agent loop. The model can read the error
 * and try a different approach.
 */
import { Tool, Toolkit } from '@effect/ai'
import { Effect, Schema } from 'effect'
import { CurrentSandbox, SandboxError } from '../sandbox/Sandbox.ts'

// ---------------------------------------------------------------------------
// Tool declarations — what the LLM sees
// ---------------------------------------------------------------------------

export const ReadFile = Tool.make('ReadFile', {
  description: 'Read the contents of a file at the given path.',
  parameters: {
    path: Schema.String.annotations({
      description: 'Absolute or relative path to the file',
    }),
  },
  success: Schema.String,
  failure: SandboxError,
  failureMode: 'return',
  dependencies: [CurrentSandbox],
})

// ---------------------------------------------------------------------------
// Toolkit
// ---------------------------------------------------------------------------

/** The bundled toolkit of all agent tools. */
export const AgentToolkit = Toolkit.make(ReadFile)

// ---------------------------------------------------------------------------
// Handler implementations
// ---------------------------------------------------------------------------

/**
 * Layer that provides handler implementations for all agent tools.
 * Requires `CurrentSandbox` — the per-scenario sandbox session.
 */
export const AgentToolkitLive = AgentToolkit.toLayer({
  ReadFile: ({ path }) =>
    Effect.gen(function* () {
      const sandbox = yield* CurrentSandbox
      return yield* sandbox.readFile(path)
    }),
})
