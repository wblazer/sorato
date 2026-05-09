# Tool

`@effect/ai Toolkit` declarations and handlers backed by sandbox services.

## Files

- `hashline/` - read/edit protocol with stable line anchors
- `bash.ts` - shell execution tool
- `write.ts` - file write tool
- `glob.ts` - file pattern search
- `grep.ts` - regex content search via `rg`

## Boundaries

- Handlers use `CurrentShell` and/or `CurrentFiles`; do not call process or filesystem APIs directly.
- Tools should return actionable failures to the model instead of crashing the agent loop.
