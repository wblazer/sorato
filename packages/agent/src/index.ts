/**
 * @agents/agent — agent primitives for building AI systems
 *
 * Re-exports the core agent primitives so consumers can do:
 *   import { Sandbox, run } from "@agents/agent"
 *
 * Evaluation primitives live in packages/evals/bench.
 */

// Sandbox
export {
  Sandbox,
  CurrentShell,
  CurrentFiles,
  SandboxError,
} from './sandbox/sandbox.ts'
export type {
  ExecCommand,
  Shell,
  Files,
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

// Tool — hashline bundle (content-hash anchored read + edit)
export { Toolkit } from '@effect/ai'
export {
  ReadFile,
  ReadFileHandler,
  EditFile,
  EditFileHandler,
} from './tool/hashline/index.ts'

// Tool — bash (shell command execution)
export { Bash, BashHandler } from './tool/bash.ts'

// Tool — write (file creation)
export { WriteFile, WriteFileHandler } from './tool/write.ts'

// Tool — glob (file pattern matching)
export { Glob, GlobHandler } from './tool/glob.ts'

// Tool — grep (regex content search)
export { Grep, GrepHandler } from './tool/grep.ts'

// Session — persistent conversation storage with tree-structured history
export {
  SessionStorage,
  StorageError,
  SessionId,
  MessageId,
} from './session/session.ts'
export type {
  Session,
  MessageNode,
  SessionStorageApi,
} from './session/session.ts'
export { SqliteSession } from './session/sqlite-session.ts'

// Server — event bus for real-time streaming
export { publish, subscribe, createBusHook } from './server/event-bus.ts'
export type { ServerEvent } from './server/event-bus.ts'

// Server — in-memory run registry
export { isRunning, getRunningSessionIds } from './server/run-registry.ts'

// Server — in-memory event replay buffer
export { getReplayBufferSince } from './server/event-replay.ts'
