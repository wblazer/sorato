# Roadmap

Building a coding agent with tree-structured conversations, tracked side effects, and decoupled execution.

## Phase 1: Foundation (current)

The bones. Tools work, the sandbox works, sessions persist, evals run, the server talks to the web UI.

- **Agent tools** — file read, file edit (hashline protocol), shell exec, file search, file write. `@effect/ai Toolkit` tools that delegate to `Shell`/`Files` services. Start simple, benchmark, iterate.
- **Sandbox** — local execution environment (`Shell` + `Files`). The harness dispatches tool calls; the sandbox executes them.
- **Session storage** — tree-structured conversation persistence via SQLite. Messages have parent pointers. Forking and branch switching work at the data layer.
- **Evals** — coding evals that exercise real sandbox access (write a function, fix a bug, refactor). Discovers if the tools and harness actually work.
- **Server + Web UI** — basic agent server with HTTP/WebSocket API. SvelteKit web UI that can send messages and display responses. Enough to use the agent interactively.

## Phase 2: Tracked Side Effects

The key differentiator. Every message in the conversation tree gets associated filesystem changes that can be checkpointed, branched, reverted, and diffed.

- **Git-backed tracking** — each assistant message that causes file changes = a git commit. Branching the conversation branches the repo state. Reverting checks out the earlier state.
- **Session/side-effect coordination** — the harness coordinates: after tool calls execute, side effects are checkpointed and linked to the message. On branch switch, filesystem state reverts to match.
- **Conversation branching UX** — fork at any point in the web UI, try a different approach, compare results. The tree structure in session storage becomes a user-facing feature with visible diffs.

## Phase 3: Capable Agent

Good enough to use for real coding work, every day.

- **System prompt tuning** — iterating on the system prompt against the eval suite until the agent reliably handles common coding tasks.
- **Multi-turn robustness** — graceful handling of tool errors, context window limits, stuck loops, and model refusals.
- **Memory** — DOCS.md injection, conversation history summarization, project-level context that persists across sessions.
- **Context management** — smart truncation, token budgeting, knowing when to drop old context vs. summarize it.
- **Observability** — logging, cost tracking, token usage, latency. Visible in the web UI.

## Phase 4: Remote Execution

Agents leave localhost. The decoupled execution model pays off.

- **Remote sandbox** — SSH or API-based `Shell`/`Files` implementations that remote operations to a cloud VM. Same tool interfaces, different execution target.
- **Provisioning** — spin up VMs on demand. Acquire on session start, tear down on close.
- **Environment definition** — what's in the VM (git, runtimes, deps). Nix, Dev Containers, or golden image.

## Phase 5: Product

Daily-driver for real coding work.

- **Background agents** — trigger infrastructure (webhooks, queues, cron), concurrency management, cost budgets. Kick off a task and come back to it.
- **Git integration** — agents clone, branch, commit, push, open PRs. Ephemeral credentials in sandboxes.
- **Continuous benchmarking** — eval suite runs on every tool/prompt change, CI integration. Regressions are caught before they ship.
- **Multi-session workflows** — multiple agents working on related tasks, sharing context, coordinating through git.
