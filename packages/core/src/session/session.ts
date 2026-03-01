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
import { Context, Effect, Schema } from 'effect'
import type { Prompt } from '@effect/ai'

// ---------------------------------------------------------------------------
// Branded IDs
// ---------------------------------------------------------------------------

export const SessionId = Schema.String.pipe(Schema.brand('SessionId'))
export type SessionId = typeof SessionId.Type

export const MessageId = Schema.String.pipe(Schema.brand('MessageId'))
export type MessageId = typeof MessageId.Type

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class StorageError extends Schema.TaggedError<StorageError>()(
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

/** A session — a container for a tree of messages. */
export interface Session {
  readonly id: SessionId
  /** The working directory this session operates in. */
  readonly directory: string
  readonly title: string | null
  /** Points to the current active leaf. Null when the session is empty. */
  readonly headId: MessageId | null
  readonly createdAt: number
  readonly updatedAt: number
}

/** A node in the message tree. */
export interface MessageNode {
  readonly id: MessageId
  readonly sessionId: SessionId
  readonly parentId: MessageId | null
  /** The full encoded message — role, content/parts, options. */
  readonly encoded: Prompt.MessageEncoded
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
export interface SessionStorageApi {
  /** Create a new empty session. */
  readonly create: (
    directory: string,
    title?: string
  ) => Effect.Effect<Session, StorageError>

  /** Get a session by ID. */
  readonly get: (id: SessionId) => Effect.Effect<Session, StorageError>

  /** List all sessions, most recently updated first. */
  readonly list: () => Effect.Effect<ReadonlyArray<Session>, StorageError>

  /** Delete a session and all its messages. */
  readonly delete: (id: SessionId) => Effect.Effect<void, StorageError>

  /**
   * Reconstruct the current branch as a `Prompt.Prompt`.
   *
   * Walks from `headId` to the root via parent pointers, reverses to
   * chronological order, and decodes each message.
   */
  readonly conversation: (
    sessionId: SessionId
  ) => Effect.Effect<Prompt.Prompt, StorageError>

  /**
   * Append messages after the current head and advance it.
   *
   * Each message becomes a child of the previous one. The first message's
   * parent is the current head (or null if the session is empty). The last
   * message becomes the new head.
   */
  readonly append: (
    sessionId: SessionId,
    messages: ReadonlyArray<Prompt.MessageEncoded>
  ) => Effect.Effect<void, StorageError>

  /**
   * Move the head to any message in the tree.
   *
   * Use this to fork (set head to an earlier message, then append) or to
   * switch branches (set head to a different leaf).
   */
  readonly setHead: (
    sessionId: SessionId,
    messageId: MessageId
  ) => Effect.Effect<void, StorageError>

  /**
   * List all leaf messages in the session — the tips of every branch.
   *
   * A leaf is a message with no children. Each leaf represents a
   * branch that can be switched to via `setHead`.
   */
  readonly leaves: (
    sessionId: SessionId
  ) => Effect.Effect<ReadonlyArray<MessageNode>, StorageError>
}

// ---------------------------------------------------------------------------
// Context Tag
// ---------------------------------------------------------------------------

/**
 * Session storage factory — the primary tag consumers `yield*` to
 * interact with persistent conversation storage.
 */
export class SessionStorage extends Context.Tag('@agents/SessionStorage')<
  SessionStorage,
  SessionStorageApi
>() {}
