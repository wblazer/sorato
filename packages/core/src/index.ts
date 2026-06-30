/**
 * @sorato/core — agent primitives for building AI systems
 *
 * Re-exports the core agent primitives so consumers can do:
 *   import { Sandbox, run } from "@sorato/core"
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
  HarnessModelCall,
  HarnessResult,
  HarnessUsage,
} from './harness/harness.ts'
export { run } from './harness/run.ts'

// Tool display metadata
export {
  MessageHeaderDisplaySchema,
  MessageIconNameSchema,
  ToolOutputRegistry,
  ToolResultDisplaySchema,
  stringifyToolResult,
} from './tool/tool-output.ts'
export type {
  InlineDiffHunk,
  InlineDiffHunkLine,
  MessageHeaderDisplay,
  MessageIconName,
  ToolResultDisplay,
  ToolResultPresentation,
  ToolOutputRegistryApi,
} from './tool/tool-output.ts'

// Stored prompt messages
export {
  StoredAssistantMessage,
  StoredMessage,
  StoredPart,
  StoredSystemMessage,
  StoredToolCallPart,
  StoredToolMessage,
  StoredToolResultPart,
  StoredUserMessage,
  SystemMessageSource,
  UserMessageSource,
} from './message.ts'
export type { StoredMessageEncoded } from './message.ts'

// Tool — hashline bundle (content-hash anchored read + edit)
export { Toolkit } from 'effect/unstable/ai'
export { Read, ReadHandler, Edit, EditHandler } from './tool/hashline/index.ts'

// Tool — bash (shell command execution)
export { Bash, BashHandler } from './tool/bash.ts'

// Tool — write (file creation)
export { Write, WriteHandler } from './tool/write.ts'

// Tool — glob (file pattern matching)
export { Glob, GlobHandler } from './tool/glob.ts'

// Tool — grep (regex content search)
export { Grep, GrepHandler } from './tool/grep.ts'

// Tool — web fetch (web content retrieval)
export { WebFetch, WebFetchHandler, WebFetchError } from './tool/web-fetch.ts'
