import type { FileContents } from '@pierre/diffs'
import type { MessageIconName } from '@sorato/core/presentation'
import type { StoredMessageEncoded } from '@sorato/core/message'

export type { ServerEvent, StreamCursor } from '@sorato/api'

export interface MessageHeaderDisplay {
  title?: string
  subtitle?: string
  icon?: MessageIconName
}

export interface Project {
  id: string
  name: string
  path: string
  archivedAt: number | null
  createdAt: number
  updatedAt: number
  lastOpenedAt: number | null
}

export interface AppTab {
  id: string
  sessionId: string | null
  projectId: string | null
  title: string | null
  kind: 'new' | 'session'
  createdAt: number
  updatedAt: number
}

export interface Session {
  id: string
  projectId: string
  title: string | null
  /** Ephemeral run status — 'running' if an agent run is active. */
  status: 'idle' | 'running'
  archivedAt: number | null
  lastUserMessageAt: number | null
  createdAt: number
  updatedAt: number
}

export type ThinkingLevel =
  | 'off'
  | 'on'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'

export interface ModelOptions {
  thinkingLevel?: ThinkingLevel
  mode?: string
}

export interface AvailableModel {
  id: string
  name: string
  provider: string
  capabilities: {
    attachment: boolean
    reasoning: boolean
    temperature: boolean
    toolCall: boolean
    thinkingLevels: ReadonlyArray<ThinkingLevel>
    modes: ReadonlyArray<string>
    limits: {
      context: number
      input?: number
      output: number
    }
  }
}

export interface AvailableModelsResponse {
  models: ReadonlyArray<AvailableModel>
  defaultModel?: string
}

export type SessionRunStatus =
  | {
      readonly _tag: 'retrying'
      readonly title: string
      readonly message: string
      readonly retryAt: number
      readonly attempt: number
      readonly maxAttempts: number
    }
  | {
      readonly _tag: 'failed'
      readonly title: string
      readonly message: string
      readonly detail?: string
      readonly retryable: boolean
    }

// ---------------------------------------------------------------------------
// Message types — mirrors @effect/ai Prompt.MessageEncoded
// ---------------------------------------------------------------------------

/** A node in the message tree, as returned by the server. */
export interface RunUsage {
  inputTokens: number | null
  outputTokens: number | null
  reasoningTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  totalTokens: number | null
  contextWindowTokens: number | null
  actualCostMicrosUsd: number | null
  listPriceMicrosUsd: number | null
}

export interface RunSummary {
  id: string
  status: 'running' | 'completed' | 'interrupted' | 'failed'
  providerId: string
  modelId: string
  billingMode: 'api-key' | 'subscription'
  usage: RunUsage
  createdAt: number
  completedAt: number | null
}

export interface ModelCall extends RunUsage {
  id: string
  sessionId: string
  runId: string | null
  assistantNodeId: string
  providerId: string
  modelId: string
  billingMode: 'api-key' | 'subscription'
  startedAt: number | null
  finishedAt: number
}

export interface MessageNode {
  id: string
  sessionId: string
  parentId: string | null
  kind: 'message' | 'summary'
  messageId: string | null
  summaryId: string | null
  sourceNodeId: string | null
  runId: string | null
  run: RunSummary | null
  modelCall: ModelCall | null
  encoded: MessageEncoded
  createdAt: number
}

/** Discriminated union of persisted message roles. */
export type MessageEncoded = StoredMessageEncoded

export interface SystemMessage {
  role: 'system'
  content: string
  source?: 'system-prompt' | 'agents-md'
  display?: MessageHeaderDisplay
}

export interface SystemUiMessage {
  role: 'system'
  source?: 'system-prompt' | 'agents-md'
  content?: string
  display?: MessageHeaderDisplay
}

export interface UserMessage {
  role: 'user'
  content: string | ReadonlyArray<TextPart | FilePart>
  source?: 'summary'
  display?: MessageHeaderDisplay
}

export interface AssistantMessage {
  role: 'assistant'
  content:
    | string
    | ReadonlyArray<
        TextPart | FilePart | ReasoningPart | ToolCallPart | ToolResultPart
      >
  metadata?: {
    interrupted?: boolean
  }
}

export interface ToolMessage {
  role: 'tool'
  content: ReadonlyArray<ToolResultPart>
}

// ---------------------------------------------------------------------------
// Message parts — discriminated on `type`
// ---------------------------------------------------------------------------

export interface TextPart {
  type: 'text'
  text: string
}

export interface ReasoningPart {
  type: 'reasoning'
  text: string
}

export interface FilePart {
  type: 'file'
  mediaType: string
  fileName?: string
  data: string
}

export interface RunAttachment {
  mediaType: string
  fileName: string
  data: string
  size: number
}

export interface ToolCallPart {
  type: 'tool-call'
  id: string
  name: string
  params: unknown
  header?: MessageHeaderDisplay
}

export interface ToolResultPart {
  type: 'tool-result'
  id: string
  name: string
  isFailure: boolean
  /** Exact text fed back to the model. */
  result: string
  header?: MessageHeaderDisplay
  /** Optional structured human-facing body display payload. */
  bodyDisplay?: ToolResultDisplay
  metadata?: {
    interrupted?: boolean
  }
}

/** Structured display payloads for tool results. Absence means render result raw. */
export type ToolResultDisplay = {
  type: 'diff'
  /** Previous file contents, matching @pierre/diffs FileContents. */
  oldFile: FileContents
  /** New file contents, matching @pierre/diffs FileContents. */
  newFile: FileContents
  /** Precomputed result summary for the combined tool header. */
  summary: {
    additions: number
    deletions: number
  }
}

/** Union of all part types for pattern matching. */
export type MessagePart =
  | TextPart
  | ReasoningPart
  | FilePart
  | ToolCallPart
  | ToolResultPart

// Server event types are exported from @sorato/api and re-exported above.
