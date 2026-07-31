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

## Development scenario lab

`bun run --filter @sorato/server dev` explicitly enables the scenario lab. A UI
can use `GET /dev/scenarios`, `PUT /dev/scenarios/:scenario`, and
`DELETE /dev/scenarios` to list, activate, and deactivate scenarios while the
server is running. Activating one adds the credential-free
`mock/streaming-demo` model to the ordinary model catalog. Runs still use the
normal session persistence, harness, tools, EventBus, and SSE paths.

Released scenarios include streamed reasoning, real tool use, a long paced
interruptible stream, and a conspicuous deterministic branching response.
`SORATO_MOCK_AGENT_SCENARIO` remains available as an optional startup selection
for automation, but requires `SORATO_DEV_SCENARIOS=true`.

This is an explicit safety boundary: `start` does not enable the guard. When
`SORATO_DEV_SCENARIOS` is absent or false, the mock model is not listed or
resolvable and every scenario-control endpoint returns the typed 404
`DevScenariosUnavailable` response. Production deployment must not set this
flag.
