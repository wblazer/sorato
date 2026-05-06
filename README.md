# agents

A coding agent built on Effect and Bun.

What makes it different:

- **Conversations are trees, not lists.** Forking, branching, and exploring are first-class operations, not afterthoughts.
- **Tracked side effects.** Every message's filesystem changes are checkpointed via git — branchable, revertible, diffable.
- **Decoupled execution.** The agent loop runs outside the sandbox. If the sandbox breaks, the agent survives.
- **Transparent context.** You see exactly what the model sees. No hidden system prompts, no magic file injection, no spinners hiding tool output.
- **Web-first UI.** Tree conversations, side-effect diffs, and context inspection need a real rendering surface, not a terminal.

```bash
bun install
bun run --filter @agents/agent start    # run the agent
```
