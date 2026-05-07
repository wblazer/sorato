# Server Session

Server-owned persistent conversation storage with tree-structured history. Conversations are trees, not lists — users can fork at any point, try a different prompt, and switch between branches.

This module is part of the coordinator layer, not agent core. Core exposes lifecycle hooks and returns conversations; the server decides how those conversations become durable product state.

## Data Model

Messages form a tree via `parentId` pointers (like git commits). Sessions have a `headId` pointing to the current leaf. Forking is implicit: `setHead` to an earlier message, then `append` creates a new branch.

```
System ─── User₁ ─── Assist₁ ─┬─ User₂  ─── Assist₂  (branch A)
                                │
                                └─ User₂' ─── Assist₂' (branch B)
```

## Files

- `session.ts` — trait/contract: `SessionStorageApi` interface, `SessionStorage` tag, `StorageError`, branded IDs (`SessionId`, `MessageId`), data types (`Session`, `MessageNode`). Stores `Prompt.MessageEncoded` blobs and reconstitutes `Prompt.Prompt` on read.
- `sqlite-session.ts` — default implementation using Effect SQL's `SqlClient`. Recursive CTE for conversation reconstruction. The concrete SQLite driver is provided at the application edge. `SqliteSession({ path })` returns the layer — use `":memory:"` with a matching in-memory SQL client for tests.

## Key Design Decisions

- **Messages store `Prompt.MessageEncoded` as JSON** — the storage layer is a faithful round-trip mechanism, not a query engine. It doesn't parse or interpret message content.
- **`setHead` is the only branching primitive** — there's no separate "fork" or "switch branch" operation. Setting head to a non-leaf and appending = fork. Setting head to a different leaf = switch. The semantics emerge from what you do next.
- **Agnostic to VCS** — no knowledge of commits, diffs, or sandbox state. Other systems join on message IDs.

## Never Do

- Never store domain-specific metadata in the message `encoded` blob — use a separate table
- Never assume messages are linear — always walk via `parentId`, never by insertion order

## Related Context

- `@agents/core` — produces conversations (`Prompt.Prompt`) that session storage persists through server hooks
- `@effect/ai` `Prompt` module — the message/part schema that session storage round-trips
