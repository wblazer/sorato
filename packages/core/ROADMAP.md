# Roadmap

From composable primitives library to background agent infrastructure. Each phase unlocks the next.

## Phase 1: Foundation

The library primitives exist and compose. One working eval. Make it actually usable.

- **CLI** — wire up `@effect/cli` so `bun run start` does something (run evals, list datasets, show results)
- **Real evals** — coding evals that exercise sandbox access in rubrics (write a function, fix a bug, refactor). Discovers if the abstractions hold.
- **Agent tools** — file read, file write, shell exec, file search. `@effect/ai Toolkit` tools that delegate to `SandboxSession`. The local minima zone — start simple, benchmark, iterate.

## Phase 2: Capable Harness

Agent harness good enough to use for real coding work.

- **System prompt + tool set** tuned for coding tasks
- **Observability hooks** — logging, cost tracking
- **Memory hooks** — DOCS.md injection, conversation history, vector search
- **Multi-turn robustness** — tool errors, context window limits, stuck loops

This is the highest-risk phase. Benchmarking infrastructure from Phase 1 is how you measure progress.

## Phase 3: Remote Sandbox

Agents leave your laptop.

- **Remote `SandboxFactory` Layer** — SSH or API-based session that remotes operations to a cloud VM
- **IaC for provisioning** — Alchemy, Terraform, or Nix to spin up VMs on demand. Layer acquires on start, tears down on scope close.
- **Environment definition** — what's in the VM (git, runtimes, deps). Nix, Dev Containers, or golden image — the sandbox abstraction doesn't care.

## Phase 4: Background Agents

Agents run autonomously on behalf of your company.

- **Trigger infrastructure** — webhook handlers, queue consumers, cron jobs calling `Harness.run`. Userland code on top of the library.
- **Web UI** — launch agents, monitor runs, view results. Dashboard over Reporter output or full chat interface.
- **Concurrency / queue management** — parallel agents in isolated sandboxes. Rate limiting, cost budgets, approval gates.
- **Git integration** — agents clone, branch, commit, push, open PRs. Ephemeral credentials in sandboxes.

## Phase 5: Production

Daily use by your company.

- **Auth / multi-tenancy**
- **Observability at scale** — traces, metrics, cost dashboards, runaway agent alerts
- **Result diffing** — compare agent performance across runs, models, tool implementations
- **Continuous benchmarking** — eval suite on every tool/prompt change, CI integration
