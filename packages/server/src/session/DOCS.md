# Server Session

Persistent conversation storage for the coordinator.

Messages form a tree via `parentId`; `headId` points at the active leaf. Branching is `setHead` plus the next append.

## Files

- `session.ts` - storage contract, IDs, session/message types
- `sqlite-session.ts` - SQLite implementation

## Boundaries

- Store `Prompt.MessageEncoded` as opaque JSON.
- Do not assume linear history or insertion-order traversal.
- Keep domain-specific metadata in separate tables.
