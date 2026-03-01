# Sandbox

The execution environment boundary. The sandbox provides fine-grained services that tools declare dependencies on:

- **Shell** (`CurrentShell`) — execute commands (process spawning, kill mechanics, timeout)
- **Files** (`CurrentFiles`) — read and write files (path resolution, isolation)

Tools depend on the specific services they need. File tools depend on `CurrentFiles`. The bash tool depends on `CurrentShell` + `CurrentFiles`. A game-state tool would depend on neither — it'd define its own service. The harness is agnostic; Effect's `R` type propagates requirements automatically.

## Files

- `sandbox.ts` — trait/contract: `Shell`, `Files`, `SandboxSession`, `SandboxFactory`, `Sandbox` tag, `CurrentShell` tag, `CurrentFiles` tag, `SandboxError`, `ExecCommand`. `ExecCommand` supports `timeout` — the sandbox owns kill mechanics (SIGTERM → SIGKILL escalation), the tool owns timeout policy.
- `local-sandbox.ts` — default implementation using `@effect/platform` CommandExecutor + FileSystem. No isolation beyond a per-session temp root. Bakes in non-interactive env defaults (pager/editor/prompt suppression) so agent-driven commands don't hang. Fine for dev/benchmarks.

## Key Insight: Agent Loop Runs Outside the Sandbox

The harness (LLM loop) runs in the orchestrator process, NOT inside the sandbox. Tool calls are remoted into the sandbox via the `Shell` and `Files` services. If the sandbox environment breaks, the agent loop survives. See `VISION.md` for the full execution model diagram.

## Factory Returns a Composite

`SandboxFactory.acquire` returns `{ shell, files }` — consumers destructure and provide `CurrentShell` + `CurrentFiles` tags separately. This keeps lifecycle management unified (one scope, one rootDir) while giving tools granular `R` types.

## Path Semantics

All file and working-directory paths are resolved relative to the sandbox root.
Absolute paths are treated as sandbox-relative to preserve isolation.

## Cloud Implementations (Userland)

The library doesn't ship cloud sandboxes. Users write `SandboxFactory` Layers backed by their IaC tool. The Layer's `acquire` provisions a resource, the `Shell`/`Files` implementations remote operations over SSH/HTTP/etc, scope cleanup tears it down.

## Never Do

- Never call `child_process` or Bun file APIs directly from tools — go through `Shell`/`Files`
- Don't accidentally share services across scenarios — reuse should be an explicit choice by the caller

## Related Context

- `src/tool/` — tools that require `CurrentShell`/`CurrentFiles` in their handlers
- `src/harness/` — dispatches tool calls through the sandbox services
- `packages/evals/bench/` — eval primitives; callers acquire sandbox sessions and provide services explicitly
- `VISION.md` — execution model, IaC relationship, industry context
