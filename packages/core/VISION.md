# Vision

## The Problem

The AI agent tooling industry is finding local minima and declaring victory. Something as fundamental as an "edit file" tool has materially different implementations across Codex, Claude Code, OpenCode, and others. The pattern is: pick a plausible approach, RL the models to use it adequately, move on. Each implementation works well enough, but none are provably optimal, and the field is moving too fast to bet on any single one.

Meanwhile, the platforms emerging to run these agents are shipping as monolithic, configured-not-composed products. You get their agent, their sandbox, their tools, their evaluation — or you get nothing. This is the wrong shape for a field undergoing exponential takeoff.

But there's a deeper problem. Every agent system today models conversations as flat lists of messages, side effects as an implementation detail of tool calls, and the relationship between the two as... nothing. There's no first-class representation of "the agent tried something, it didn't work, it tried something else." The conversation and the world-state it affected are entangled in a way that's invisible to the system. You can't branch, you can't revert, you can't diff. You can't even _see_ what happened without reading logs.

## The Bet

Code is getting cheaper. Glue code, integration work, implementing new research — all rapidly approaching zero marginal cost _given the right structure in place_. What remains expensive is architectural refactors. What remains catastrophic is falling behind because new paradigms arose and your system can't accommodate them.

The response is a product built on composable primitives — a system with genuinely good ideas at its architectural core that enable use cases other systems can't touch. The primitives remain swappable, the composition model remains Effect Layers, but the product has a point of view:

1. **Conversations are trees, not lists.** Forking, branching, and exploring are first-class.
2. **Side effects are just side effects.** Agent conversations are just conversations where some messages trigger side effects. The core doesn't assume those side effects are filesystem operations — that's a Sandbox concern.
3. **Side effects are tracked.** Every message's side effects can be checkpointed, forming a parallel tree that can be branched, reverted, and diffed alongside the conversation. For coding agents, git is the obvious implementation.
4. **The agent loop is decoupled from the execution environment.** The harness doesn't need to run on the same machine as its side effects. Tools can execute on a remote server, a container, a VM — the agent doesn't know or care.
5. **The text is the truth.** Too many agent products hide the actual context from the user — you `@` a file and have no idea if the full contents were injected or a summary, you see "running tool..." but not what the model actually emitted. This product exposes the underlying text. Thin abstractions, not opaque ones. The user should always be able to see exactly what the model sees and exactly what it produces.

## Core Architectural Concepts

### Conversation as a Tree

Every agent conversation is a tree of messages, not a list. Each message has a parent pointer (like a git commit). The session head points to the current leaf. Forking is implicit: move the head to an earlier message, append new messages, and you've created a branch.

This isn't a power-user feature bolted on after the fact — it's the data model. The session storage reconstructs any branch by walking parent pointers. Branch switching is just `setHead`.

```
System ─── User₁ ─── Assist₁ ─┬─ User₂  ─── Assist₂  (branch A — worked)
                                │
                                └─ User₂' ─── Assist₂' (branch B — tried something else)
```

Why this matters: agents explore. They try things, hit walls, backtrack. A tree makes this structure visible and navigable instead of burying it in a flat log. It also makes branching explorations a primitive — try N approaches in parallel, evaluate the results, continue from the best one.

### Tracked Side Effects

Agent messages cause side effects — file writes, shell commands, build processes. These side effects form their own parallel tree, synchronized with the conversation tree via message IDs. The side-effect tracker is a trait with operations like checkpoint, revert, diff, and branch. For coding agents, git is the natural first implementation — each message's filesystem changes become a commit.

```
Conversation Tree          Side-Effect Tree
─────────────────          ────────────────
System                     (initial state)
  └─ User₁                   └─ checkpoint₀
      └─ Assist₁                  └─ checkpoint₁ (wrote file, ran build)
          ├─ User₂                    ├─ checkpoint₂a (refactored)
          │   └─ Assist₂              │   └─ checkpoint₃a (tests pass)
          └─ User₂'                   └─ checkpoint₂b (tried different approach)
              └─ Assist₂'                 └─ checkpoint₃b (tests fail — abandon)
```

This gives you:

- **Diff**: what did this message change?
- **Revert**: undo the last N actions and try again
- **Branch**: explore multiple strategies in parallel with isolated state
- **Replay**: given a conversation branch, reproduce the exact state

### Side Effects Are Just Side Effects

The conversation tree and the harness loop don't assume side effects are filesystem operations. Side effects are whatever the tools do — the core just runs tools and records messages. This means the same conversation/harness/session architecture works for non-coding use cases (game-playing, REPL interaction, API orchestration) without needing to shoehorn them through `Shell` + `Files`.

`Sandbox` is specifically for filesystem/shell execution. It doesn't try to be a universal execution environment. Other domains define their own service interfaces for their own side effects. Git tracking is a Sandbox concern, not a core concern.

### Decoupled Execution

Three distinct execution contexts:

**1. The Orchestrator** — the process that says "run this agent on this input." Your CLI, a server, a Lambda, a long-running service. Where the Runner lives, where benchmarks are kicked off, where a web UI backend would sit.

**2. The Agent Runtime (Harness)** — the process that sends messages to an LLM, receives tool calls, and dispatches them. This runs _outside_ the execution environment. If the environment breaks (corrupted state, infinite loop, OOM), the agent loop must survive to observe the failure, recover, or report it.

**3. The Execution Environment** — where tool calls produce side effects. For coding agents, this is the `Sandbox` (`Shell` + `Files`) — your local machine, a VM, a container. For other domains, it's whatever service interface fits the domain. The harness dispatches tool calls; it doesn't care where they execute or what kind of state they affect.

```
┌─────────────────────────┐
│      Orchestrator       │  ← CLI, server, Lambda
│  ┌───────────────────┐  │
│  │   Agent Runtime   │  │  ← Harness (LLM loop)
│  │   (Harness)       │  │
│  └────────┬──────────┘  │
│           │ tool calls (can be remoted)
└───────────┼─────────────┘
            │
   ┌────────▼────────┐
   │    Execution     │  ← Sandbox (Shell + Files), game engine, REPL, etc.
   │   Environment    │
   └──────────────────┘
```

For coding agents specifically, the `SandboxFactory` trait abstracts over where `Shell` + `Files` operations run — locally or remoted to a cloud VM. The same tool interfaces work regardless. Other domains provide their own service traits.

## The Primitives

Each primitive is an Effect service (`Context.Tag`). The library ships default `Layer`s. Users provide their own when they outgrow the defaults.

| Primitive       | What it is                                                           | Ships default?   |
| --------------- | -------------------------------------------------------------------- | ---------------- |
| **Session**     | Tree-structured conversation storage (branch, fork, switch)          | `SqliteSession`  |
| **Sandbox**     | Execution environment with fine-grained services (`Shell` + `Files`) | `LocalSandbox`   |
| **Harness**     | System prompt + tools + hooks = agent loop                           | Yes              |
| **Tool**        | Individual capability given to an agent (`@effect/ai Toolkit`)       | Basic set        |
| **Side-Effect** | Tracked state changes keyed to conversation tree messages            | TBD (git first)  |
| **Rubric**      | Evaluates agent output against expectations                          | Several built-in |
| **Dataset**     | Collection of `Scenario<Input, Expected, Meta>`                      | Loaders          |
| **Runner**      | Orchestrates scenarios through harnesses, evaluates results          | Yes              |
| **Reporter**    | Formats and persists benchmark results                               | Console + JSON   |

### Transparent Context

Agent UIs today hide the actual text from users behind layers of abstraction. You `@` a file and wonder whether the full contents were injected or a summary. You see "running tool..." but not what the model actually emitted or what the tool actually returned. The system prompt is invisible. The context window is a black box.

This is backwards. The conversation _is_ text. The model sees text and produces text. Every abstraction the UI introduces between the user and that text is a place where understanding breaks down and debugging becomes guesswork.

The product exposes the underlying text at every level:

- **System prompts are visible and editable.** You can see exactly what the agent is instructed to do.
- **Tool calls show the full payload** — what the model emitted, what the tool received, what it returned. Not a summary, not a spinner — the actual text.
- **Context injection is explicit.** When something enters the conversation (a file, a search result, a hook's output), you can see it in the message stream. No magic behind `@file` — if it's in context, it's visible.
- **The context window has a representation.** Token counts, truncation decisions, what was included and what was dropped — all inspectable.

This isn't a debug mode. It's the default. Abstractions that help the user navigate and organize the text are welcome. Abstractions that _hide_ it are not.

## What This Is

- **A product with an SDK heart.** Opinionated about architecture (tree conversations, tracked side effects, decoupled execution, transparent context), composable in implementation. The opinions enable use cases. The composability enables experimentation.
- **Not just for coding.** Coding is the first use case — `Sandbox` and git-based side-effect tracking reflect that. But the conversation tree and harness loop are domain-agnostic. Other domains plug in their own service interfaces and tracking implementations.
- **Not a framework.** You call it, you compose it, you own the main loop. But the product has a point of view about what agent systems _should_ look like.
- **Web-first UI.** TUIs are a limiting platform for agent interaction. Tree-structured conversations, side-effect diffs, context window inspection, branching UX — these need a real rendering surface. The product UI is a web application, not a terminal emulator pretending to be one.

## The Local Minima Problem

Every agent harness today has locked in specific implementations for core capabilities: file editing, code search, terminal execution, context management. These implementations were chosen by plausible reasoning, validated by RL training, and shipped. They work well enough.

But "well enough" is a local minimum. The edit tool that Claude Code uses is not the edit tool that Codex uses. Both work. Neither is provably optimal. And both are deeply embedded in their respective systems, making experimentation expensive.

This library's value: make experimentation cheap. Tools are `@effect/ai Toolkit` tools — swap one implementation for another and re-run your benchmark. The structure (session, harness, runner, rubric, sandbox) remains stable while the implementations compete on merit.

## Related Reading

- [The Last Year of Localhost](https://ona.com/stories/the-last-year-of-localhost) — the case for cloud development environments as agent infrastructure
- [OpenCode](https://github.com/anomalyco/opencode) — reference implementation for agent tooling and API design
- [Agent Communication Protocol](https://agentcommunicationprotocol.dev/) — standardized interface for agent-to-client communication
