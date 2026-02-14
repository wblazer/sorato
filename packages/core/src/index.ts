/**
 * @agents/core — agent primitives for building AI systems
 *
 * Re-exports the core agent primitives so consumers can do:
 *   import { Harness, Sandbox } from "@agents/core"
 *
 * Evaluation primitives live in @agents/bench.
 */

// Sandbox
export { Sandbox, CurrentSandbox, SandboxError } from './sandbox/Sandbox.ts'
export type {
  ExecCommand,
  SandboxSession,
  SandboxFactory,
  ExecResult,
} from './sandbox/Sandbox.ts'
export { LocalSandbox, LocalSandboxLive } from './sandbox/LocalSandbox.ts'

// Harness
export type {
  HarnessEvent,
  HarnessHook,
  HarnessConfig,
  HarnessResult,
} from './harness/Harness.ts'
export { run } from './harness/run.ts'

// Tool
export { ReadFile, AgentToolkit, AgentToolkitLive } from './tool/Tool.ts'
