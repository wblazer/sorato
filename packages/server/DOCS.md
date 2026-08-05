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

## Configuration

Server settings are loaded from the global Sorato config and then the active
project's `.sorato/config.json` or `.sorato/config.jsonc`:

```jsonc
{
  "default_model": "anthropic/claude-sonnet-4-6",
  "environment_command": "nix develop --command env",
  "instructions": "Additional ambient instructions.",
  "roles": {
    "summary": {
      "model": "openai/gpt-5.4-mini",
      "instructions": "Preserve architectural decisions.",
    },
    "title": {
      "model": "openai/gpt-5-nano",
      "instructions": "Prefer concrete technical nouns.",
    },
  },
}
```

Project models override global models. Global and project instructions append.
The main agent's configured instructions and `AGENTS.md` are combined with the
built-in prompt into one immutable prompt for each run.
