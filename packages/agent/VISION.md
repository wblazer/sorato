# Vision

A coding agent with tree-structured conversations, tracked side effects, decoupled execution, and a web UI that shows you everything.

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

Every message's filesystem changes are checkpointed via git. Branching the conversation branches the repo state. Reverting checks out the earlier state.

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
- **Revert**: undo the last N actions
- **Branch**: parallel exploration with isolated filesystem state
- **Replay**: reproduce the exact working directory from any conversation branch

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

Locally, the sandbox is your machine. Eventually, a container or cloud VM — same interface, different execution target.

### Transparent Context

You see exactly what the model sees. System prompts are visible and editable. Tool calls show the full payload — what the model emitted, what the tool received, what it returned. Context injection is explicit. Token counts and truncation decisions are inspectable. No hidden magic.

### Web-First UI

Tree conversations need spatial navigation. Side-effect diffs need real rendering. Context inspection needs room. The UI is a SvelteKit web app, not a terminal.

## Related Reading

- [The Last Year of Localhost](https://ona.com/stories/the-last-year-of-localhost) — cloud dev environments as agent infrastructure
- [OpenCode](https://github.com/anomalyco/opencode) — reference implementation for agent tooling
- [Agent Communication Protocol](https://agentcommunicationprotocol.dev/) — standardized agent-to-client interface
