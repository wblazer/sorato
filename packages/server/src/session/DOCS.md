# Server Session

Persistent conversation storage for the coordinator.

Nodes form a tree via `parent_node_id`. The backend does not persist a global head; callers pass an explicit selected/base node when reconstructing context or starting a run.

## Files

- `session.ts` - storage contract, IDs, session/message types
- `sqlite-session.ts` - SQLite implementation

## Boundaries

- Store `Prompt.MessageEncoded` as opaque JSON.
- Do not assume linear history or insertion-order traversal.
- Keep domain-specific metadata in separate tables.
