# Vision

## The Problem

The AI agent tooling industry is finding local minima and declaring victory. Something as fundamental as an "edit file" tool has materially different implementations across Codex, Claude Code, OpenCode, and others. The pattern is: pick a plausible approach, RL the models to use it adequately, move on. Each implementation works well enough, but none are provably optimal, and the field is moving too fast to bet on any single one.

Meanwhile, the platforms emerging to run these agents (cloud development environments, agent sandboxes, orchestration layers) are shipping as monolithic, configured-not-composed products. You get their agent, their sandbox, their tools, their evaluation — or you get nothing. This is the wrong shape for a field undergoing exponential takeoff.

## The Bet

Code is getting cheaper. Glue code, integration work, implementing new research — all rapidly approaching zero marginal cost _given the right structure in place_. What remains expensive is architectural refactors. What remains catastrophic is falling behind because new paradigms arose and your system can't accommodate them.

The optimal response is a library of composable primitives for building agent systems. Not a product you configure — a toolkit you compose. The library provides:

1. **Stable abstractions** (traits/interfaces) that change rarely
2. **Default implementations** that ship with the library and work out of the box
3. **A composition model** (Effect Layers) that makes swapping implementations a type-safe operation

Architectural refactors become type errors. New paradigms become new Layer implementations.

## The Primitives

Each primitive is an Effect service (`Context.Tag`). The library ships default `Layer`s. Users provide their own when they outgrow the defaults.

| Primitive    | What it is                                                     | Ships default?   |
| ------------ | -------------------------------------------------------------- | ---------------- |
| **Sandbox**  | Isolated execution environment (exec, filesystem, network)     | `LocalSandbox`   |
| **Harness**  | System prompt + tools + hooks that constitute an agent         | Yes              |
| **Tool**     | Individual capability given to an agent (`@effect/ai Toolkit`) | Basic set        |
| **Rubric**   | Evaluates agent output against expectations                    | Several built-in |
| **Dataset**  | Collection of `Scenario<Input, Expected, Meta>`                | Loaders          |
| **Runner**   | Orchestrates scenarios through harnesses, evaluates results    | Yes              |
| **Reporter** | Formats and persists benchmark results                         | Console + JSON   |
| **Observer** | Tracing, logging, cost tracking across runs                    | Basic (future)   |

### What's NOT a primitive

- **Memory / Context**: This is a harness concern, implemented through hooks. The hook system is expressive enough for RAG, vector search, conversation history, etc. A separate Memory primitive would add indirection without buying anything.

- **Triggers / Work Dispatch**: How work arrives at an agent (webhooks, cron, ticket assignment, human input) is userland. The caller is the user's infrastructure.

- **Gateway / Router / Guardrails**: Rate limiting, approval gates, routing work to specific harness configurations — all userland orchestration that calls library primitives. Categorically different from the primitives themselves. Can be tacked on later if scope expands.

- **IaC / Cloud Provisioning**: Infrastructure-as-Code (Alchemy, Terraform, Pulumi, Nix) provisions the resources that _satisfy_ sandbox Layer implementations. The library defines what a sandbox needs; IaC provides it. See [Execution Model](#execution-model) below.

## Execution Model

Three distinct execution contexts exist when running agents:

### 1. The Orchestrator

The process that says "run this agent on this input." Today: your CLI on your laptop. In production: a server, a Lambda, a long-running service. This is where the Runner lives, where benchmarks are kicked off, where a web UI backend would sit.

### 2. The Agent Runtime (Harness)

The process that sends messages to an LLM, receives tool calls, and dispatches them to the sandbox. This is the Harness. It _should run outside the sandbox_. If the environment breaks (corrupted filesystem, infinite loop eating resources, OOM), the agent loop must survive to observe the failure, recover, or report it. An agent that dies with its sandbox cannot self-correct.

### 3. The Sandbox

The isolated environment where tool calls execute. File writes, shell commands, build processes — all happen here. Today: `LocalSandbox` (your machine, no isolation). In production: a VM, a Firecracker microVM, a cloud container with kernel-level enforcement.

```
┌─────────────────────────┐
│      Orchestrator       │  ← Your CLI, server, Lambda
│  ┌───────────────────┐  │
│  │   Agent Runtime   │  │  ← Harness (LLM loop)
│  │   (Harness)       │  │
│  └────────┬──────────┘  │
│           │ exec/read/write (remoted via SandboxSession)
└───────────┼─────────────┘
            │
   ┌────────▼────────┐
   │     Sandbox      │  ← Isolated environment (VM, container, local)
   │  (tool execution)│
   └──────────────────┘
```

The `SandboxFactory` trait abstracts over all of this. The same interface works whether operations run locally or are remoted to a cloud VM. The harness doesn't know or care.

### How IaC fits

IaC lives in the orchestrator. It provisions sandboxes. Users write a `SandboxFactory` Layer backed by their IaC tool — the Layer provisions resources on acquire and tears them down when the scope closes. The library doesn't depend on any IaC tool. It defines what a sandbox needs (see `src/sandbox/Sandbox.ts`); IaC provides the implementation. Docs and guides bridge the gap.

## Industry Context

### The Cloud Environment Thesis

Dev environments are moving to the cloud. Not because cloud is inherently better for individual developers, but because fleets of background agents can't run on laptops. Each agent needs its own isolated, fully-provisioned environment with access to internal services. Companies that standardized their environments years ago (Stripe, Ramp) are now running agents at scale with minimal additional infrastructure. Everyone else is discovering they need to build the environment layer first.

Key properties of production agent environments:

- **VM-level isolation** (not containers) — agents executing untrusted code need kernel-level boundaries
- **Self-assembling** — no manual setup steps, environment bootstraps from declarative config
- **Full development loop** — clone, branch, install, build, test, iterate, commit, push
- **Network connectivity** — access to internal services, databases, staging environments
- **Assume compromise** — ephemeral credentials, kernel-level enforcement, blast radius containment

### Dev Containers vs Nix

The Dev Container spec (`devcontainer.json`) is the closest thing the industry has to a universal environment definition format. It's widely adopted (VS Code, GitHub Codespaces, Ona/Gitpod), vendor-neutral, and simple enough for any team to adopt.

However, Dev Containers are fundamentally imperative disguised as declarative. The JSON describes _how to set up_ an environment (base image + lifecycle shell scripts + "Features" which are packaged shell scripts). Reproducibility depends on image pinning and hoping `apt-get` returns the same versions across time. Composability means dumping Features into the same filesystem and hoping nothing conflicts.

Nix solves these problems correctly: content-addressed packages, conflict-free composition, declarative dependency closures, atomic rollbacks. But Nix has a brutal learning curve and no equivalent platform ecosystem.

For this library, the sandbox abstraction sidesteps the choice entirely. A `SandboxFactory` Layer can provision a Nix-based environment, a Dev Container, a raw VM, or anything else. The library doesn't enforce an opinion on environment definition — that's the user's infrastructure concern.

### The Local Minima Problem

Every agent harness today has locked in specific implementations for core capabilities: file editing, code search, terminal execution, context management. These implementations were chosen by plausible reasoning, validated by RL training, and shipped. They work well enough.

But "well enough" is a local minimum. The edit tool that Claude Code uses is not the edit tool that Codex uses. Both work. Neither is provably optimal. And both are deeply embedded in their respective systems, making experimentation expensive.

This library's value proposition: make experimentation cheap. Tools are `@effect/ai Toolkit` tools — swap one implementation for another and re-run your benchmark. The structure (harness, runner, rubric, sandbox) remains stable while the implementations compete on merit.

## What This Is Not

- **Not a product.** No hosted service, no SaaS, no dashboard (unless someone builds one as a consumer).
- **Not an agent.** The library provides the bones; the agent is a specific composition of harness + tools + system prompt.
- **Not an opinions factory.** Default implementations ship for convenience, not as prescriptions. Every default is swappable.
- **Not a framework.** Frameworks call your code. This is a library — you call it, you compose it, you own the main loop.

## Related Reading

- Ona (formerly Gitpod): [The Last Year of Localhost](https://ona.com/stories/the-last-year-of-localhost) — the case for cloud development environments as agent infrastructure
- [Dev Container Specification](https://containers.dev/) — the industry-standard environment definition format
- [alchemy-effect](https://github.com/alchemy-run/alchemy-effect) — Effect-native IaC, a natural fit for provisioning sandbox Layers
