# Tool

Agent tools — `@effect/ai Toolkit` tools that delegate to the sandbox.

## Files

- `Tool.ts` — tool declarations (`ReadFile`), bundled toolkit (`AgentToolkit`), and handler implementations (`AgentToolkitLive`)

## How It Works

Each tool is two things: a **declaration** (schema the LLM sees) and a **handler** (Effect that runs when the LLM calls it). Handlers access the sandbox via the `CurrentSandbox` tag in their `R` parameter — Effect's type system carries this requirement up to the caller, which provides it.

Tools use `failureMode: "return"` so errors flow back to the LLM as tool results (not crashes). The model can read the error and try a different approach.

The `dependencies: [CurrentSandbox]` on each tool declaration is what makes the `R`-parameter magic work — it tells `@effect/ai` that the handler needs `CurrentSandbox` in scope, and the type system propagates that requirement through the toolkit, through the harness, all the way to the caller.

## Never Do

- Never call filesystem or process APIs directly — go through `SandboxSession`
- Never use `failureMode: "error"` for tools (crashes the agent loop on bad input)

## Related Context

- `src/sandbox/` — `CurrentSandbox` tag and `SandboxSession` interface
- `src/harness/` — consumes the resolved toolkit via `HarnessConfig`
- `packages/bench/` — eval primitives; callers provide `CurrentSandbox` explicitly
