# Sandbox

Execution boundary for tool calls.

## Services

- `CurrentShell` - command execution, timeouts, process cleanup
- `CurrentFiles` - filesystem access with project-relative defaults

## Files

- `sandbox.ts` - service contracts, tags, errors, factory types
- `local-sandbox.ts` - local implementation with a caller-provided default directory

## Boundaries

- The harness runs outside the sandbox; tool calls enter through services.
- Relative paths resolve from the acquired root; absolute paths remain absolute.
- Directory lifecycle belongs to the caller.
