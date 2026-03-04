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
// per-session `eventId`. Session streams use it as a replay cursor.
// ---------------------------------------------------------------------------

export type ServerEvent =
  | { _tag: 'SessionUpdated'; sessionId: string }
  | { _tag: 'MessagesAppended'; sessionId: string }
  | { _tag: 'TextDelta'; sessionId: string; delta: string; eventId: number }
  | {
      _tag: 'ToolCall'
      sessionId: string
      id: string
      name: string
      params: unknown
      eventId: number
    }
  | {
      _tag: 'ToolResult'
      sessionId: string
      id: string
      name: string
      result: unknown
      isFailure: boolean
      eventId: number
    }
  | { _tag: 'RunStart'; sessionId: string }
  | { _tag: 'RunEnd'; sessionId: string }
