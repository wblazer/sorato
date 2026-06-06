/**
 * Session — persistent conversation storage with tree-structured history.
 *
 * Conversations are not linear — they're trees. A user can fork at any
 * point, try a different prompt, and switch between branches. The data
 * model mirrors git: each message stores a `parentId`, and the session
 * has a `headId` pointing to the current leaf.
 *
 * **Reconstructing a conversation**: walk from `headId` up parent pointers
 * to the root, reverse to chronological order, decode into `Prompt.Prompt`.
 *
 * **Forking**: `setHead` to an earlier message, then `append` new messages.
 * The old branch's messages remain in the tree. The new messages chain off
 * the fork point, creating a new branch.
 *
 * **Branch switching**: `setHead` to a different leaf. The conversation
 * returned by `conversation()` reflects that branch.
 *
 * The storage layer is agnostic to VCS, tools, or any other domain concern.
 * It stores `Prompt.MessageEncoded` blobs faithfully and reconstitutes them
 * into `Prompt.Prompt` on read. Other systems (VCS, analytics) can join on
 * message IDs without coupling to this module.
 */
import { Context, Schema } from 'effect'
import type { Effect } from 'effect/Effect'
import type { Prompt } from 'effect/unstable/ai'
import { Prompt as PromptSchemas } from 'effect/unstable/ai'
import {
  MessageHeaderDisplaySchema,
  ToolResultDisplaySchema,
} from '@sorato/core'

// ---------------------------------------------------------------------------
// Branded IDs
// ---------------------------------------------------------------------------

export const SessionId = Schema.String
export type SessionId = string

export const MessageId = Schema.String
export type MessageId = string

export const RunId = Schema.String
export type RunId = string

export const RunStatus = Schema.Literals([
  'running',
  'completed',
  'interrupted',
  'failed',
])
export type RunStatus = typeof RunStatus.Type

export const BillingMode = Schema.Literals(['api-key', 'subscription'])
export type BillingMode = typeof BillingMode.Type

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class StorageError extends Schema.TaggedErrorClass<StorageError>()(
  'StorageError',
  {
    operation: Schema.String,
    message: Schema.String,
    error: Schema.optional(Schema.Defect),
  }
) {}

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

export interface RunUsage {
  readonly inputTokens: number | null
  readonly outputTokens: number | null
  readonly reasoningTokens: number | null
  readonly cacheReadTokens: number | null
  readonly cacheWriteTokens: number | null
  readonly totalTokens: number | null
  /** Latest model call's total context after response, not cumulative run usage. */
  readonly contextWindowTokens: number | null
  readonly actualCostMicrosUsd: number | null
  readonly listPriceMicrosUsd: number | null
}

export interface Run extends RunUsage {
  readonly id: RunId
  readonly sessionId: SessionId
  readonly status: RunStatus
  readonly providerId: string
  readonly modelId: string
  readonly billingMode: BillingMode
  readonly createdAt: number
  readonly completedAt: number | null
}

export interface CreateRunInput {
  readonly id: RunId
  readonly sessionId: SessionId
  readonly providerId: string
  readonly modelId: string
  readonly billingMode: BillingMode
  readonly createdAt?: number
}

export interface CompleteRunInput {
  readonly id: RunId
  readonly status: Exclude<RunStatus, 'running'>
  readonly usage?: RunUsage | undefined
  readonly completedAt?: number
}

/** A session — a container for a tree of messages. */
export interface Session {
  readonly id: SessionId
  /** The project this session operates in. */
  readonly projectId: string
  readonly title: string | null
  /** Points to the current active leaf. Null when the session is empty. */
  readonly headId: MessageId | null
  readonly archivedAt: number | null
  readonly lastUserMessageAt: number | null
  readonly createdAt: number
  readonly updatedAt: number
}

/** A node in the message tree. */
export interface MessageNode {
  readonly id: MessageId
  readonly sessionId: SessionId
  readonly parentId: MessageId | null
  readonly runId: RunId
  readonly run: Run
  /** The full encoded message — role, content/parts, options. */
  readonly encoded: StoredMessageEncoded
  readonly createdAt: number
}

export const SystemMessageSource = Schema.Literals([
  'system-prompt',
  'agents-md',
  'interruption',
])

export const StoredToolCallPart = Schema.Struct({
  ...PromptSchemas.ToolCallPart.fields,
  header: Schema.optionalKey(MessageHeaderDisplaySchema),
})

export const StoredToolResultPart = Schema.Struct({
  ...PromptSchemas.ToolResultPart.fields,
  header: Schema.optionalKey(MessageHeaderDisplaySchema),
  bodyDisplay: Schema.optionalKey(ToolResultDisplaySchema),
})

export const StoredPart = Schema.Union([
  PromptSchemas.TextPart,
  PromptSchemas.FilePart,
  PromptSchemas.ReasoningPart,
  StoredToolCallPart,
  StoredToolResultPart,
  PromptSchemas.ToolApprovalRequestPart,
  PromptSchemas.ToolApprovalResponsePart,
])

export const StoredSystemMessage = Schema.Struct({
  ...PromptSchemas.SystemMessage.fields,
  content: Schema.optionalKey(Schema.String),
  source: Schema.optionalKey(SystemMessageSource),
  display: Schema.optionalKey(MessageHeaderDisplaySchema),
})

export const StoredUserMessage = Schema.Struct({
  ...PromptSchemas.UserMessage.fields,
  content: Schema.Union([Schema.String, Schema.Array(StoredPart)]),
})

export const StoredAssistantMessage = Schema.Struct({
  ...PromptSchemas.AssistantMessage.fields,
  content: Schema.Union([Schema.String, Schema.Array(StoredPart)]),
})

export const StoredToolMessage = Schema.Struct({
  ...PromptSchemas.ToolMessage.fields,
  content: Schema.Array(
    Schema.Union([StoredToolResultPart, PromptSchemas.ToolApprovalResponsePart])
  ),
})

export const StoredMessage = Schema.Union([
  StoredSystemMessage,
  StoredUserMessage,
  StoredAssistantMessage,
  StoredToolMessage,
])

export type StoredMessageEncoded = typeof StoredMessage.Encoded

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * Persistent session storage with tree-structured conversation history.
 *
 * The `SessionStorage` tag resolves to this interface.
 */
export interface SessionStorageApi {
  /** Create a new empty session. */
  readonly create: (
    projectId: string,
    title?: string
  ) => Effect<Session, StorageError>

  /** Get a session by ID. */
  readonly get: (id: SessionId) => Effect<Session, StorageError>

  /** List all sessions, most recently updated first. */
  readonly list: () => Effect<ReadonlyArray<Session>, StorageError>

  /** Create a run envelope for messages and usage caused by one execution. */
  readonly createRun: (input: CreateRunInput) => Effect<void, StorageError>

  /** Persist provider-reported aggregate usage/cost for a still-running run. */
  readonly updateRunUsage: (
    id: RunId,
    usage: RunUsage
  ) => Effect<void, StorageError>

  /** Complete a run and persist provider-reported aggregate usage/cost. */
  readonly completeRun: (input: CompleteRunInput) => Effect<void, StorageError>

  /** Get a persisted run. */
  readonly getRun: (id: RunId) => Effect<Run, StorageError>

  /** Set or clear the session title. */
  readonly setTitle: (
    id: SessionId,
    title: string | null
  ) => Effect<void, StorageError>

  /** Delete a session and all its messages. */
  readonly delete: (id: SessionId) => Effect<void, StorageError>

  /** Archive all sessions in a project. Archived sessions are hidden from lists. */
  readonly archiveByProject: (projectId: string) => Effect<void, StorageError>

  /**
   * Reconstruct the current branch as a `Prompt.Prompt`.
   *
   * Walks from `headId` to the root via parent pointers, reverses to
   * chronological order, and decodes each message.
   */
  readonly conversation: (
    sessionId: SessionId
  ) => Effect<Prompt.Prompt, StorageError>

  /**
   * Return the message nodes for the current branch in chronological order.
   *
   * Walks from `headId` to the root via parent pointers, then reverses
   * to chronological order. Unlike `conversation()`, this preserves the
   * full `MessageNode` metadata (IDs, parent pointers, timestamps).
   */
  readonly messages: (
    sessionId: SessionId
  ) => Effect<ReadonlyArray<MessageNode>, StorageError>

  /**
   * Append messages after the current head and advance it.
   *
   * Each message becomes a child of the previous one. The first message's
   * parent is the current head (or null if the session is empty). The last
   * message becomes the new head.
   */
  readonly append: (
    sessionId: SessionId,
    runId: RunId,
    messages: ReadonlyArray<StoredMessageEncoded>
  ) => Effect<void, StorageError>

  /**
   * Move the head to any message in the tree.
   *
   * Use this to fork (set head to an earlier message, then append) or to
   * switch branches (set head to a different leaf).
   */
  readonly setHead: (
    sessionId: SessionId,
    messageId: MessageId
  ) => Effect<void, StorageError>

  /**
   * List all leaf messages in the session — the tips of every branch.
   *
   * A leaf is a message with no children. Each leaf represents a
   * branch that can be switched to via `setHead`.
   */
  readonly leaves: (
    sessionId: SessionId
  ) => Effect<ReadonlyArray<MessageNode>, StorageError>
}

// ---------------------------------------------------------------------------
// Context Tag
// ---------------------------------------------------------------------------

/**
 * Session storage factory — the primary tag consumers `yield*` to
 * interact with persistent conversation storage.
 */
export class SessionStorage extends Context.Service<
  SessionStorage,
  SessionStorageApi
>()('@sorato/SessionStorage') {}
