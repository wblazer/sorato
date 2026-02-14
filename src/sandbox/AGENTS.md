# Sandbox

The execution environment boundary. Every tool call an agent makes goes through the sandbox. This indirection is what lets you swap local dev for cloud VMs without touching the tools.

## Files

- `Sandbox.ts` — trait/contract: `SandboxSession`, `SandboxFactory`, `Sandbox` tag, `SandboxError`. The interface any implementation must satisfy.
- `LocalSandbox.ts` — default implementation using `@effect/platform` CommandExecutor + Bun file APIs. No isolation. Fine for dev/benchmarks.

## Key Insight: Agent Loop Runs Outside the Sandbox

The harness (LLM loop) runs in the orchestrator process, NOT inside the sandbox. Tool calls are remoted into the sandbox via `SandboxSession`. If the sandbox environment breaks, the agent loop survives. See `VISION.md` for the full execution model diagram.

## Cloud Implementations (Userland)

The library doesn't ship cloud sandboxes. Users write `SandboxFactory` Layers backed by their IaC tool. The Layer's `acquire` provisions a resource, the `SandboxSession` remotes operations over SSH/HTTP/etc, scope cleanup tears it down.

## Never Do

- Never call `child_process` or Bun file APIs directly from tools — go through `SandboxSession`
- Never share a `SandboxSession` across scenarios — each gets its own from the factory

## Related Context

- `src/harness/` — dispatches tool calls through the sandbox
- `src/runner/` — acquires scoped sandbox sessions per scenario
- `VISION.md` — execution model, IaC relationship, industry context
