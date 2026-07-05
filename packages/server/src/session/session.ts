/**
 * Session — persistent conversation storage with tree-structured history.
 *
 * Conversations are not linear — they're trees. A user can fork at any
 * point, try a different prompt, and switch between branches. Nodes form
 * the context tree; message and summary content live separately.
 *
 * **Reconstructing a conversation**: walk from an explicit selected node up
 * parent pointers to the root, reverse to chronological order, decode into
 * `Prompt.Prompt`.
 *
 * **Forking**: append at an explicit base node. The old branch's nodes remain
 * in the tree. The new nodes chain off the fork point, creating a branch.
 *
 * The storage layer is agnostic to VCS, tools, or any other domain concern.
 * It stores `Prompt.MessageEncoded` blobs faithfully and reconstitutes them
 * into `Prompt.Prompt` on read. Other systems (VCS, analytics) can join on
 * message IDs without coupling to this module.
 */
import { Context, Schema } from 'effect'
import type { Effect } from 'effect/Effect'
import type { Prompt } from 'effect/unstable/ai'
import { StoredMessage, type StoredMessageEncoded } from '@sorato/core/message'

export { StoredMessage }
export type { StoredMessageEncoded }

// ---------------------------------------------------------------------------
// Branded IDs
// ---------------------------------------------------------------------------

export const SessionId = Schema.String
export type SessionId = string

export const NodeId = Schema.String
export type NodeId = string

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
  /** Durable lifecycle status for this run. */
  readonly status: RunStatus
  readonly providerId: string
  readonly modelId: string
  readonly billingMode: BillingMode
  readonly baseNodeId: NodeId | null
  readonly createdAt: number
  readonly completedAt: number | null
}

export interface CreateRunInput {
  readonly id: RunId
  readonly sessionId: SessionId
  readonly providerId?: string
  readonly modelId?: string
  readonly billingMode?: BillingMode
  readonly baseNodeId: NodeId | null
  readonly createdAt?: number
}

export interface CompleteRunInput {
  readonly id: RunId
  readonly status: Exclude<RunStatus, 'running'>
  readonly completedAt?: number
}

/** A session — a container for a tree of messages. */
export interface Session {
  readonly id: SessionId
  /** The project this session operates in. */
  readonly projectId: string
  readonly title: string | null
  readonly archivedAt: number | null
  readonly lastUserMessageAt: number | null
  readonly createdAt: number
  readonly updatedAt: number
}

/** A node in the message tree. */
export interface ModelCall extends RunUsage {
  readonly id: string
  readonly sessionId: SessionId
  readonly runId: RunId | null
  readonly assistantNodeId: NodeId
  readonly providerId: string
  readonly modelId: string
  readonly billingMode: BillingMode
  readonly startedAt: number | null
  readonly finishedAt: number
}

export interface CreateModelCallInput extends RunUsage {
  readonly id?: string
  readonly sessionId: SessionId
  readonly runId: RunId | null
  readonly assistantNodeId: NodeId
  readonly providerId: string
  readonly modelId: string
  readonly billingMode: BillingMode
  readonly startedAt?: number | null
  readonly finishedAt?: number
}

export interface MessageNode {
  readonly id: NodeId
  readonly sessionId: SessionId
  readonly parentId: NodeId | null
  readonly kind: 'message' | 'summary'
  readonly messageId: MessageId | null
  readonly summaryId: string | null
  readonly sourceNodeId: NodeId | null
  readonly runId: RunId | null
  readonly run: Run | null
  readonly modelCall: ModelCall | null
  /** The full encoded message — role, content/parts, options. */
  readonly encoded: StoredMessageEncoded
  readonly createdAt: number
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * Persistent session storage with tree-structured conversation history.
 *
 * The `SessionStorage` tag resolves to this interface.
 */
export interface CompactRangeInput {
  readonly sessionId: SessionId
  readonly runId: RunId | null
  readonly baseHeadNodeId: NodeId
  readonly startNodeId: NodeId
  readonly endNodeId: NodeId
  readonly summaryContent: string
}

export interface CompactRangeResult {
  readonly summaryNodeId: NodeId
  readonly headNodeId: NodeId
}

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

  /** Get a persisted run. */
  readonly getRun: (id: RunId) => Effect<Run, StorageError>

  /** Mark a run as terminal. */
  readonly completeRun: (input: CompleteRunInput) => Effect<void, StorageError>

  /** Persist per-model-call usage/cost on the original assistant node. */
  readonly createModelCall: (
    input: CreateModelCallInput
  ) => Effect<void, StorageError>

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
   * Walks from the selected node to the root via parent pointers, reverses to
   * chronological order, and decodes each message.
   */
  readonly conversation: (
    sessionId: SessionId,
    headNodeId: NodeId | null
  ) => Effect<Prompt.Prompt, StorageError>

  /**
   * Return the message nodes for the current branch in chronological order.
   *
   * Walks from the selected node to the root via parent pointers, then reverses
   * to chronological order. Unlike `conversation()`, this preserves the
   * full `MessageNode` metadata (IDs, parent pointers, timestamps).
   */
  readonly messages: (
    sessionId: SessionId,
    headNodeId?: NodeId | null
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
    messages: ReadonlyArray<StoredMessageEncoded>,
    baseNodeId: NodeId | null
  ) => Effect<ReadonlyArray<NodeId>, StorageError>

  /**
   * Create a compacted alternate branch by replacing a contiguous range on
   * baseHeadNodeId's ancestry path with a summary node and shallow-cloned tail.
   */
  readonly compactRange: (
    input: CompactRangeInput
  ) => Effect<CompactRangeResult, StorageError>

  /**
   * Move the head to any message in the tree.
   *
   * Use this to fork (set head to an earlier message, then append) or to
   * switch branches (set head to a different leaf).
   */
  /**
   * List all leaf messages in the session — the tips of every branch.
   *
   * A leaf is a message with no children. Each leaf represents a
   * branch that can be selected by the frontend.
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
