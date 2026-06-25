# Tool

`@effect/ai Toolkit` declarations and handlers backed by sandbox services.

## Files

- `hashline/` - read/edit protocol with stable line anchors
- `bash.ts` - shell execution tool
- `write.ts` - file write tool
- `glob.ts` - file pattern search
- `grep.ts` - regex content search via `rg`
- `web-fetch.ts` - web content retrieval via Effect `HttpClient`

## Boundaries

- Filesystem/process handlers use `CurrentShell` and/or `CurrentFiles`; do not call process or filesystem APIs directly.
- Network handlers use Effect `HttpClient` so tests and callers can provide the transport layer.
- Tools should return actionable failures to the model instead of crashing the agent loop.
