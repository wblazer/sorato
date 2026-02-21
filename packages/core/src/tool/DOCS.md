# Tool

Agent tools — `@effect/ai Toolkit` tools that delegate to the sandbox.

## Files

- `hashline/` — `ReadFile` + `EditFile` sharing the hashline protocol. Read returns `<line>:<hash>|<content>` annotations with offset/limit, truncation, and binary detection. Edit references lines by `<line>:<hash>` anchors. See `hashline/encoding.ts` for the hashing scheme.
- `bash.ts` — `Bash` tool for shell command execution. Handles output truncation (tail-keep, 2000 lines / 50KB) with spillover to sandbox files accessible via `ReadFile`. Timeout is forwarded to the sandbox; the tool owns display policy, the sandbox owns kill mechanics.
- `tool.ts` — barrel export for `@agents/core/tool` sub-path.

## How It Works

Each tool is two things: a **declaration** (schema the LLM sees) and a **handler** (Effect that runs when the LLM calls it). Handlers access the sandbox via the `CurrentSandbox` tag in their `R` parameter — Effect's type system carries this requirement up to the caller, which provides it.

Tools use `failureMode: "return"` so errors flow back to the LLM as tool results (not crashes). The model can read the error and try a different approach.

The `dependencies: [CurrentSandbox]` on each tool declaration is what makes the `R`-parameter magic work — it tells `@effect/ai` that the handler needs `CurrentSandbox` in scope, and the type system propagates that requirement through the toolkit, through the harness, all the way to the caller.

## Error Philosophy

**Make failure messages guide the model to success.** When a tool call fails, the error message is the model's only signal for what to do next. A good error message tells the model _what went wrong_, _what the correct state is_, and _how to recover_.

For example, a hash mismatch error should include the correct hash and the current line content — not just "mismatch, re-read the file." The model might be able to self-correct without a full re-read.

Similarly, tools should silently fix unambiguous mechanical artifacts (like echoed anchor prefixes in edit content) rather than failing on them. The line between "fix it silently" and "reject and explain" is whether the model's intent is unambiguous. `3:0e|return x;` in edit content is obviously not intended to be file content — strip it. But a wrong indentation level could be intentional — reject it.

## Never Do

- Never call filesystem or process APIs directly — go through `SandboxSession`
- Never use `failureMode: "error"` for tools (crashes the agent loop on bad input)

## Related Context

- `src/sandbox/` — `CurrentSandbox` tag and `SandboxSession` interface
- `src/harness/` — consumes the resolved toolkit via `HarnessConfig`
- `packages/bench/` — eval primitives; callers provide `CurrentSandbox` explicitly
