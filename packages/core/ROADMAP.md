# Roadmap

From composable primitives to an agent system with tree-structured conversations, tracked side effects, and decoupled execution.

## Phase 1: Foundation (current)

The core primitives exist and compose. Evals exercise them. Make it actually usable.

- **CLI** — wire up `@effect/cli` so `bun run start` does something (run evals, list datasets, show results)
- **Real evals** — coding evals that exercise sandbox access in rubrics (write a function, fix a bug, refactor). Discovers if the abstractions hold.
- **Agent tools** — file read, file write, shell exec, file search. `@effect/ai Toolkit` tools that delegate to `Shell`/`Files` services. The local minima zone — start simple, benchmark, iterate.

## Phase 2: Tracked Side Effects

The architectural differentiator. Every message in the conversation tree gets associated side effects that can be checkpointed, branched, reverted, and diffed.

- **Side-Effect trait** — the service interface for tracking state changes associated with message IDs. Operations: checkpoint, revert, diff, branch.
- **Git implementation** — the first concrete implementation for coding agents. Each assistant message that causes file changes = a git commit. Branching the conversation branches the repo state. Reverting checks out the earlier state.
- **Session ↔ Side-Effect coordination** — the harness coordinates: after tool calls execute, side effects are checkpointed and linked to the message. On branch switch, state reverts to match.
- **Conversation branching UX** — fork at any point, try a different approach, compare results. The tree structure that already exists in `Session` becomes a user-facing feature.

## Phase 3: Capable Harness

Agent harness good enough to use for real coding work — and other domains.

- **System prompt + tool set** tuned for coding tasks
- **Observability hooks** — logging, cost tracking
- **Memory hooks** — DOCS.md injection, conversation history, vector search
- **Multi-turn robustness** — tool errors, context window limits, stuck loops
- **Non-coding sandbox experiments** — prove the architecture is domain-agnostic. A game-playing harness, a REPL agent, something that isn't files-and-shell.

## Phase 4: Remote Execution

Agents leave your laptop. The decoupled execution model pays off.

- **Remote `SandboxFactory` Layer** — SSH or API-based `Shell`/`Files` implementations that remote operations to a cloud VM
- **IaC for provisioning** — Alchemy, Terraform, or Nix to spin up VMs on demand. Layer acquires on start, tears down on scope close.
- **Environment definition** — what's in the VM (git, runtimes, deps). Nix, Dev Containers, or golden image — the sandbox abstraction doesn't care.

## Phase 5: Product

Daily use by you and your company.

- **Web UI** — launch agents, monitor runs, navigate the conversation tree, view side-effect diffs, inspect context. Web-first — TUIs are a limiting platform for what this product needs to show.
- **Background agents** — trigger infrastructure (webhooks, queues, cron), concurrency management, cost budgets
- **Git integration** — agents clone, branch, commit, push, open PRs. Ephemeral credentials in sandboxes.
- **Auth / multi-tenancy** — if/when multi-user becomes relevant
- **Continuous benchmarking** — eval suite on every tool/prompt change, CI integration
