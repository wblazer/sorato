# Sandbox

The execution environment boundary. Every tool call an agent makes goes through the sandbox. This indirection is what lets you swap local dev for cloud VMs without touching the tools.

## Files

- `Sandbox.ts` — trait/contract: `SandboxSession`, `SandboxFactory`, `Sandbox` tag, `CurrentSandbox` tag, `SandboxError`, `ExecCommand`. `CurrentSandbox` is the per-scenario session tag that tools require in their `R` parameter.
- `LocalSandbox.ts` — default implementation using `@effect/platform` CommandExecutor + FileSystem. No isolation beyond a per-session temp root. Fine for dev/benchmarks.

## Key Insight: Agent Loop Runs Outside the Sandbox

The harness (LLM loop) runs in the orchestrator process, NOT inside the sandbox. Tool calls are remoted into the sandbox via `SandboxSession`. If the sandbox environment breaks, the agent loop survives. See `VISION.md` for the full execution model diagram.

## Path Semantics

All file and working-directory paths are resolved relative to the sandbox root.
Absolute paths are treated as sandbox-relative to preserve isolation.

## Cloud Implementations (Userland)

The library doesn't ship cloud sandboxes. Users write `SandboxFactory` Layers backed by their IaC tool. The Layer's `acquire` provisions a resource, the `SandboxSession` remotes operations over SSH/HTTP/etc, scope cleanup tears it down.

## Never Do

- Never call `child_process` or Bun file APIs directly from tools — go through `SandboxSession`
- Don't accidentally share a `SandboxSession` across scenarios — reuse should be an explicit strategy in userland (see `packages/bench/src/runner/`)

## Related Context

- `src/tool/` — tools that require `CurrentSandbox` in their handlers
- `src/harness/` — dispatches tool calls through the sandbox
- `packages/bench/src/runner/` — acquires scoped sandbox sessions and provides `CurrentSandbox` per scenario
- `VISION.md` — execution model, IaC relationship, industry context
