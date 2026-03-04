# Roadmap

Building a coding agent with tree-structured conversations, tracked side effects, and decoupled execution.

## Phase 1: Foundation (done)

The bones. Tools work, the sandbox works, sessions persist, the server talks to the web UI.

- **Agent tools** — file read, file edit (hashline protocol), shell exec, file search, file write. `@effect/ai Toolkit` tools that delegate to `Shell`/`Files` services.
- **Sandbox** — local execution environment (`Shell` + `Files`). The harness dispatches tool calls; the sandbox executes them.
- **Session storage** — tree-structured conversation persistence via SQLite. Messages have parent pointers. Forking and branch switching work at the data layer.
- **Evals** — coding evals that exercise real sandbox access.
- **Server + Web UI** — agent server with HTTP API. SvelteKit web UI that can create sessions, send messages, stream responses via SSE. Basic sidebar + chat layout.

## Phase 2: Server & Streaming (current)

The server serves many clients running many sessions. It needs to be efficient.

- **Per-session event routing** — currently all events from all sessions stream to every client. Investigate and implement subscription-based routing so clients only receive events for sessions they care about.
- **Agent interruption** — ability to cancel a running agent loop mid-execution.
- **Message queuing** — queue inbound messages so the server handles bursts gracefully.
- **Configurable server connections** — clients connect to a named server (local or remote) and can switch between them. No more hardcoded localhost.

## Phase 3: UI Foundation

The frontend is currently a basic chat layout. It needs to become a configurable, keyboard-driven workspace.

- **Layout engine** — resizable panes with draggable borders. Tree view, conversation view, review view, session list — all configurable. This is foundational; everything else in the UI builds on it.
- **Keyboard-first navigation** — looks like a tasteful web app, fast and navigable like a TUI.
- **Tree view** — visualize and navigate the conversation tree. Branch, fork, switch.
- **Tool call display** — better rendering of tool call side effects, especially file diffs.
- **Session-level diffs** — review all changes across a session in one view.
- **Metadata surface** — cost, tokens, latency per message and per session.
- **Model selection UI** — pick model, set parameters (thinking level, temperature, etc).
- **Command palette** — once there are enough actions to warrant one.
- **Theme configuration** — client-side theme support.

## Phase 4: VCS & Tracked Side Effects

The key differentiator. Every message gets associated filesystem changes that can be checkpointed, branched, reverted, diffed, and merged. Probably using jj.

- **VCS-backed tracking** — each assistant message that causes file changes = a checkpoint. Branching the conversation branches the repo state.
- **State navigation** — not just conversation tree navigation, but tracked _state_ navigation. Undo, redo, revert to any point.
- **Merging** — combine results from different conversation branches.
- **External change detection** — auto-track untracked (user-triggered) sandbox mutations by committing them, then surface the external change as a message in the conversation.
- **Conversation branching UX** — fork at any point, try a different approach, compare results with visible diffs.

## Phase 5: Agent Intelligence & Configuration

- **Model selection** — backend support for multiple providers and models.
- **Automatic session naming** — name sessions with a cheap model after first exchange.
- **AGENTS.md & skills loading** — support for project-level agent instructions and skill plugins.
- **Configuration system** — split by concern: client config (theme, layout, keybindings, connections) vs server config (tools, hooks, plugins, model providers). Look to OpenCode for inspiration on architecture.
- **Permissions** — control what the agent can do.

## Phase 6: Polymorphic Execution

Agents leave localhost. The decoupled execution model pays off.

- **Polymorphic session directories** — refactor directory handling to support repos, branches, not just local paths. A local server uses directories; a company server uses repo+branch identifiers that spawn remote sandboxes.
- **Remote sandboxes** — SSH or API-based `Shell`/`Files` implementations. Same tool interfaces, different execution target.
- **Provisioning** — spin up VMs/containers on demand. Acquire on session start, tear down on close.
- **Connection switching** — switching server connections switches the execution model. Local server = directory sessions. Company server = repo/branch sessions with remote sandboxes.

## Phase 7: Product

Daily-driver for real coding work.

- **Background agents** — trigger infrastructure (webhooks, queues, cron), concurrency management, cost budgets.
- **Git integration** — agents clone, branch, commit, push, open PRs. Ephemeral credentials in sandboxes.
- **Continuous benchmarking** — eval suite runs on every tool/prompt change, CI integration.
- **Multi-session workflows** — multiple agents working on related tasks, sharing context, coordinating through git.
- **Collaboration** — multiple people working in the same session simultaneously.
