# Vision

A coding agent with tree-structured conversations, tracked side effects, decoupled execution, and a web UI that shows you everything.

One server, many clients, many simultaneous agent loops. People can collaborate on sessions. The server/client separation makes this possible — and demands that we be thoughtful about efficiency from the start.

## Features

### Tree Conversations

Conversations are trees, not lists. Each message has a parent pointer (like a git commit). Forking is implicit: rewind to an earlier message, send something different, and you've created a branch.

```
System --- User_1 --- Assist_1 --+-- User_2  --- Assist_2  (branch A)
                                 |
                                 +-- User_2' --- Assist_2' (branch B)
```

Agents explore. They try things, hit walls, backtrack. A tree makes that structure visible and navigable. You can try N approaches in parallel, compare results, continue from the best one.

### Tracked Side Effects

Every message's filesystem changes are checkpointed via VCS (likely jj). Branching the conversation branches the repo state. Reverting checks out the earlier state.

```
Conversation Tree          Side-Effect Tree
-----------------          ----------------
System                     (initial state)
  +-- User_1                 +-- checkpoint_0
      +-- Assist_1               +-- checkpoint_1 (wrote file, ran build)
          |-- User_2                 |-- checkpoint_2a (refactored)
          |   +-- Assist_2           |   +-- checkpoint_3a (tests pass)
          +-- User_2'                +-- checkpoint_2b (different approach)
              +-- Assist_2'              +-- checkpoint_3b (tests fail)
```

- **Diff**: what did this message change?
- **Session diff**: review all changes across a session
- **Revert / Undo / Redo**: navigate tracked state, not just conversation state
- **Branch**: parallel exploration with isolated filesystem state
- **Merge**: combine results from different branches
- **External change detection**: untracked sandbox mutations (user edits outside the agent) are auto-committed and surfaced as messages in the conversation

### Decoupled Execution

The agent loop runs outside the sandbox. If the sandbox breaks (segfault, OOM, infinite loop), the agent survives to observe the failure and recover.

```
+-------------------------+
|      Orchestrator       |  <-- server, eval runner
|  +-------------------+  |
|  |   Agent Runtime   |  |  <-- LLM loop
|  +--------+----------+  |
|           | tool calls
+-----------+-------------+
            |
   +--------v--------+
   |     Sandbox      |  <-- Shell + Files (local or remote)
   +------------------+
```

Locally, the sandbox is your machine. Eventually, a container or cloud VM — same interface, different execution target. Session directories are polymorphic: a local directory today, a repo+branch on a remote sandbox tomorrow.

### Multi-Tenant Server

A single server hosts many agent loops for many clients simultaneously. Clients connect to a server (local or remote) and can switch between connections. A local server serves directory-based sessions; a company server serves repo/branch-based sessions with remote sandboxes.

Streaming is per-session, not firehose. The server routes events efficiently so clients only receive what they've subscribed to.

### Transparent Context

You see exactly what the model sees. System prompts are visible and editable. Tool calls show the full payload — what the model emitted, what the tool received, what it returned. Context injection is explicit. Token counts, cost, and truncation decisions are inspectable. No hidden magic.

### Web-First UI

Tree conversations need spatial navigation. Side-effect diffs need real rendering. Context inspection needs room. The UI is a SvelteKit web app, not a terminal.

The UI is keyboard-first — looks like a tasteful web app, navigable like a TUI. The layout is built on a configurable pane system with draggable borders. Tree view, conversation view, review view, sessions — all resizable, all rearrangeable.

### Configuration

Configuration is split by concern:

- **Client config**: theme, layout, keybindings, server connections
- **Server config**: custom tools, hooks, plugins, model providers, AGENTS.md / skills loading

Inspired by OpenCode's architecture where a similar client/server split exists.

## Related Reading

- [The Last Year of Localhost](https://ona.com/stories/the-last-year-of-localhost) — cloud dev environments as agent infrastructure
- [OpenCode](https://github.com/anomalyco/opencode) — reference implementation for agent tooling
- [Agent Communication Protocol](https://agentcommunicationprotocol.dev/) — standardized agent-to-client interface
