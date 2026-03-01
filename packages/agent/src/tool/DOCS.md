# Tool

Agent tools — `@effect/ai Toolkit` tools that delegate to sandbox services.

## Files

- `hashline/` — `ReadFile` + `EditFile` sharing the hashline protocol. Read returns `<line>:<hash>|<content>` annotations with offset/limit, truncation, and binary detection. Edit references lines by `<line>:<hash>` anchors. See `hashline/encoding.ts` for the hashing scheme.
- `bash.ts` — `Bash` tool for shell command execution. Handles output truncation (tail-keep, 2000 lines / 50KB) with spillover to sandbox files accessible via `ReadFile`. Timeout is forwarded to the sandbox; the tool owns display policy, the sandbox owns kill mechanics.
- `write.ts` — `WriteFile` tool for creating/overwriting files. Thin wrapper over `CurrentFiles.writeFile`. Parent directory creation is a sandbox concern.
- `glob.ts` — `Glob` tool for file pattern matching. Delegates to `CurrentFiles.glob` with result capping at 500 entries to prevent context window explosions.
- `grep.ts` — `Grep` tool for regex content search. Shells out to `rg` (ripgrep) via `CurrentShell`. Results sorted by file mtime (most recent first), capped at 100 matches. Requires `rg` in the sandbox — fails explicitly if missing.
- `tool.ts` — barrel export for `@agents/agent/tool` sub-path.

## How It Works

Each tool is two things: a **declaration** (schema the LLM sees) and a **handler** (Effect that runs when the LLM calls it). Handlers access sandbox services via `CurrentShell` and/or `CurrentFiles` tags in their `R` parameter — Effect's type system carries these requirements up to the caller, which provides them.

Tools use `failureMode: "return"` so errors flow back to the LLM as tool results (not crashes). The model can read the error and try a different approach.

The `dependencies` array on each tool declaration is what makes the `R`-parameter magic work — it tells `@effect/ai` which services the handler needs in scope, and the type system propagates those requirements through the toolkit, through the harness, all the way to the caller. File tools declare `dependencies: [CurrentFiles]`. The bash tool declares `dependencies: [CurrentShell, CurrentFiles]`. The grep tool declares `dependencies: [CurrentShell]` — it only needs to exec `rg`.

## Error Philosophy

**Make failure messages guide the model to success.** When a tool call fails, the error message is the model's only signal for what to do next. A good error message tells the model _what went wrong_, _what the correct state is_, and _how to recover_.

For example, a hash mismatch error should include the correct hash and the current line content — not just "mismatch, re-read the file." The model might be able to self-correct without a full re-read.

Similarly, tools should silently fix unambiguous mechanical artifacts (like echoed anchor prefixes in edit content) rather than failing on them. The line between "fix it silently" and "reject and explain" is whether the model's intent is unambiguous. `3:0e|return x;` in edit content is obviously not intended to be file content — strip it. But a wrong indentation level could be intentional — reject it.

## Never Do

- Never call filesystem or process APIs directly — go through `Shell`/`Files` services
- Never use `failureMode: "error"` for tools (crashes the agent loop on bad input)

## Related Context

- `src/sandbox/` — `CurrentShell`/`CurrentFiles` tags and `Shell`/`Files` interfaces
- `src/harness/` — consumes the resolved toolkit via `HarnessConfig`
- `packages/evals/bench/` — eval primitives; callers provide `CurrentShell`/`CurrentFiles` explicitly
