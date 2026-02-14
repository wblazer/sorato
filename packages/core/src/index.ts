/**
 * @agents/core — agent primitives for building AI systems
 *
 * Re-exports the core agent primitives so consumers can do:
 *   import { Harness, Sandbox } from "@agents/core"
 *
 * Evaluation primitives live in @agents/bench.
 */

// Sandbox
export { Sandbox, CurrentSandbox, SandboxError } from './sandbox/sandbox.ts'
export type {
  ExecCommand,
  SandboxSession,
  SandboxFactory,
  ExecResult,
} from './sandbox/sandbox.ts'
export { LocalSandbox, LocalSandboxLive } from './sandbox/local-sandbox.ts'

// Harness
export type {
  HarnessEvent,
  HarnessHook,
  HarnessConfig,
  HarnessResult,
} from './harness/harness.ts'
export { run } from './harness/run.ts'

// Tool
export { ReadFile, AgentToolkit, AgentToolkitLive } from './tool/tool.ts'
