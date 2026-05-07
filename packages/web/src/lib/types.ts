export interface Session {
  id: string
  directory: string
  title: string | null
  headId: string | null
  /** Ephemeral run status — 'running' if an agent run is active. */
  status: 'idle' | 'running'
  createdAt: number
  updatedAt: number
}

export interface ModelOptions {
  thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
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
    thinkingLevels: Array<
      'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
    >
    modes: string[]
    limits: {
      context: number
      input?: number
      output: number
    }
  }
}

export interface AvailableModelsResponse {
  models: AvailableModel[]
  defaultModel?: string
}

// ---------------------------------------------------------------------------
// Message types — mirrors @effect/ai Prompt.MessageEncoded
// ---------------------------------------------------------------------------

/** A node in the message tree, as returned by the server. */
export interface MessageNode {
  id: string
  sessionId: string
  parentId: string | null
  encoded: MessageEncoded
  createdAt: number
}

/** Discriminated union of message roles. */
export type MessageEncoded =
  | SystemMessage
  | UserMessage
  | AssistantMessage
  | ToolMessage

export interface SystemMessage {
  role: 'system'
  content: string
}

export interface UserMessage {
  role: 'user'
  content: string | ReadonlyArray<TextPart | FilePart>
}

export interface AssistantMessage {
  role: 'assistant'
  content:
    | string
    | ReadonlyArray<
        TextPart | FilePart | ReasoningPart | ToolCallPart | ToolResultPart
      >
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

export interface ToolCallPart {
  type: 'tool-call'
  id: string
  name: string
  params: unknown
}

export interface ToolResultPart {
  type: 'tool-result'
  id: string
  name: string
  isFailure: boolean
  result: unknown
}

/** Union of all part types for pattern matching. */
export type MessagePart =
  | TextPart
  | ReasoningPart
  | FilePart
  | ToolCallPart
  | ToolResultPart

// ---------------------------------------------------------------------------
// Server event types — mirrors ServerEvent from the agent package
//
// Content events (TextDelta, ToolCall, ToolResult) carry a monotonic
// `eventId` within a single `runId`. Session streams use the pair as a
// replay cursor.
// ---------------------------------------------------------------------------

export interface StreamCursor {
  runId: string
  eventId: number
}

export type ServerEvent =
  | { _tag: 'SessionUpdated'; sessionId: string }
  | { _tag: 'MessagesAppended'; sessionId: string }
  | {
      _tag: 'TextDelta'
      sessionId: string
      runId: string
      delta: string
      eventId: number
    }
  | {
      _tag: 'ReasoningDelta'
      sessionId: string
      runId: string
      delta: string
      eventId: number
    }
  | {
      _tag: 'ToolCall'
      sessionId: string
      runId: string
      id: string
      name: string
      params: unknown
      eventId: number
    }
  | {
      _tag: 'ToolResult'
      sessionId: string
      runId: string
      id: string
      name: string
      result: unknown
      isFailure: boolean
      eventId: number
    }
  | { _tag: 'RunStart'; sessionId: string; runId: string }
  | { _tag: 'RunEnd'; sessionId: string; runId: string }
  | { _tag: 'RunFailed'; sessionId: string; runId: string; message: string }
