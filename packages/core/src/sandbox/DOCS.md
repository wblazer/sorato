# Sandbox

Execution boundary for tool calls.

## Services

- `CurrentShell` - command execution, timeouts, process cleanup
- `CurrentFiles` - rooted file access

## Files

- `sandbox.ts` - service contracts, tags, errors, factory types
- `local-sandbox.ts` - local development implementation rooted at a caller-provided directory

## Boundaries

- The harness runs outside the sandbox; tool calls enter through services.
- Paths resolve under the sandbox root.
- Directory lifecycle belongs to the caller.
