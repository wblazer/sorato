# Harness

The agent loop.

## Files

- `harness.ts` - event, hook, config, and result types
- `run.ts` - multi-turn `streamText` loop

## Boundary

Memory, observability, and persistence integration happen through hooks. Keep them out of the loop core unless they are part of running every agent.
