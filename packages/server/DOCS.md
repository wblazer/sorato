# @sorato/server

Local coordinator for the agent product.

It wraps `@sorato/core` with product concerns: HTTP, sessions, model availability, runtime config, SSE, logging, and run lifecycle.

## Pointers

- `src/DOCS.md` - HTTP boundary and live runtime modules
- `src/session/DOCS.md` - persistent tree-structured conversations
- `src/provider-definitions.ts` - supported provider roster
- `src/provider-adapters.ts` - runtime model adapters and availability checks
- `src/model-catalog.ts` - usable model list
- `src/runtime-config.ts` - global/project config loading
- `src/session-title.ts` - automatic first-message titles
