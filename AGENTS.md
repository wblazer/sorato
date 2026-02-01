# BlazerBench Agent Instructions

<!-- effect-solutions:start -->

## Effect Best Practices

**IMPORTANT:** Always consult effect-solutions before writing Effect code.

1. Run `effect-solutions list` to see available guides
2. Run `effect-solutions show <topic>...` for relevant patterns (supports multiple topics)
3. Search `.reference/effect/` for real implementations (run `effect-solutions setup` first)

Topics: quick-start, project-setup, tsconfig, basics, services-and-layers, data-modeling, error-handling, config, testing, cli.

Never guess at Effect patterns - check the guide first.

<!-- effect-solutions:end -->

## Project Overview

BlazerBench is an LLM benchmark tool built with Effect and Bun for experimenting with model behavior.

## Tech Stack

- **Runtime**: Bun
- **Framework**: Effect (functional programming)
- **CLI**: @effect/cli
- **AI**: @effect/ai
- **Editor**: Helix

## Development Commands

```bash
# Type check
bun run typecheck

# Run the CLI
bun run start

# Install dependencies
bun install
```

## Nix Setup

This project uses a Nix flake for reproducible development environments:

```bash
# Enter the dev shell (automatic with direnv)
nix develop

# Or with direnv:
direnv allow
```

## TypeScript Configuration

- Strict mode enabled with exact optional property types
- Effect Language Service plugin for compile-time diagnostics
- Module: Preserve (bundler handles transformation)
