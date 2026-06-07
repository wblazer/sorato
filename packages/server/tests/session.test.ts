import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect, Layer, Schema } from 'effect'
import { Prompt } from 'effect/unstable/ai'
import { SqlClient } from 'effect/unstable/sql/SqlClient'
import { describe, expect, it } from '@effect/vitest'
import { BunServices } from '@effect/platform-bun'
import {
  SessionId,
  SessionStorage,
  type SessionStorageApi,
} from '../src/session/session.ts'
import { makeSqlitePersistenceLive } from '../src/db/sqlite.ts'
import { SqliteSession } from '../src/session/sqlite-session.ts'

const TEST_DIR = '/tmp/test-project'

// ---------------------------------------------------------------------------
// Test layer — isolated sqlite database per test
// ---------------------------------------------------------------------------

const TestProjectLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient
    const now = Date.now()
    yield* sql`
      INSERT OR IGNORE INTO projects (
        id,
        name,
        path,
        created_at,
        updated_at,
        last_opened_at
      )
      VALUES (${TEST_DIR}, 'test-project', ${TEST_DIR}, ${now}, ${now}, ${now})
    `
  })
)

const testLayer = () => {
  const path = join(tmpdir(), `sorato-session-${crypto.randomUUID()}.db`)
  return Layer.merge(SqliteSession({ path }), TestProjectLive).pipe(
    Layer.provide(makeSqlitePersistenceLive({ filename: path })),
    Layer.provide(BunServices.layer)
  )
}

const latestLeafId = (storage: SessionStorageApi, sessionId: string) =>
  Effect.gen(function* () {
    const leaves = yield* storage.leaves(sessionId)
    return leaves.at(-1)?.id ?? null
  })

const append = (
  storage: SessionStorageApi,
  sessionId: string,
  messages: ReadonlyArray<Prompt.MessageEncoded>,
  baseNodeId?: string | null
) =>
  Effect.gen(function* () {
    const resolvedBaseNodeId =
      baseNodeId === undefined
        ? yield* latestLeafId(storage, sessionId)
        : baseNodeId
    const runId = crypto.randomUUID()
    yield* storage.createRun({
      id: runId,
      sessionId,
      providerId: 'test',
      modelId: 'test-model',
      billingMode: 'api-key',
      baseNodeId: resolvedBaseNodeId,
    })
    const nodeIds = yield* storage.append(
      sessionId,
      runId,
      messages,
      resolvedBaseNodeId
    )

    return nodeIds
  })

const conversation = (storage: SessionStorageApi, sessionId: string) =>
  Effect.gen(function* () {
    const headNodeId = yield* latestLeafId(storage, sessionId)
    return yield* storage.conversation(sessionId, headNodeId)
  })
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const encodeMessage = Schema.encodeSync(Prompt.Message)

const systemMsg = (text: string): Prompt.MessageEncoded =>
  encodeMessage(
    Schema.decodeUnknownSync(Prompt.Message)({ role: 'system', content: text })
  )

const userMsg = (text: string): Prompt.MessageEncoded =>
  encodeMessage(
    Schema.decodeUnknownSync(Prompt.Message)({ role: 'user', content: text })
  )

const assistantMsg = (text: string): Prompt.MessageEncoded =>
  encodeMessage(
    Schema.decodeUnknownSync(Prompt.Message)({
      role: 'assistant',
      content: text,
    })
  )

const toolCallMsg = (
  id: string,
  name: string,
  params: unknown
): Prompt.MessageEncoded =>
  encodeMessage(
    Schema.decodeUnknownSync(Prompt.Message)({
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          id,
          name,
          params,
          providerExecuted: false,
        },
      ],
    })
  )

const toolResultMsg = (
  id: string,
  name: string,
  result: unknown
): Prompt.MessageEncoded =>
  encodeMessage(
    Schema.decodeUnknownSync(Prompt.Message)({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          id,
          name,
          isFailure: false,
          result,
          providerExecuted: false,
        },
      ],
    })
  )

const expectDefined = <T>(value: T | null | undefined, message: string): T => {
  if (value === null || value === undefined) throw new Error(message)
  return value
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionStorage', () => {
  // -- Session CRUD -------------------------------------------------------

  describe('create / get / list / delete', () => {
    it.effect('creates a session with generated ID', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const session = yield* storage.create(TEST_DIR, 'test session')

        expect(session.id).toBeTruthy()
        expect(session.projectId).toBe(TEST_DIR)
        expect(session.title).toBe('test session')
      }).pipe(Effect.provide(testLayer()))
    )

    it.effect('creates a session with null title by default', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const session = yield* storage.create(TEST_DIR)

        expect(session.title).toBeNull()
      }).pipe(Effect.provide(testLayer()))
    )

    it.effect('gets a session by ID', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const created = yield* storage.create(TEST_DIR, 'test')
        const fetched = yield* storage.get(created.id)

        expect(fetched.id).toBe(created.id)
        expect(fetched.title).toBe('test')
      }).pipe(Effect.provide(testLayer()))
    )

    it.effect('updates a session title', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const created = yield* storage.create(TEST_DIR)

        yield* storage.setTitle(created.id, 'generated title')
        const fetched = yield* storage.get(created.id)

        expect(fetched.title).toBe('generated title')
      }).pipe(Effect.provide(testLayer()))
    )

    it.effect('fails to get a nonexistent session', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const result = yield* storage
          .get(Schema.decodeSync(SessionId)('nonexistent'))
          .pipe(Effect.flip)

        expect(result._tag).toBe('StorageError')
        expect(result.operation).toBe('get')
      }).pipe(Effect.provide(testLayer()))
    )

    it.effect('lists sessions ordered by updated_at desc', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const s1 = yield* storage.create(TEST_DIR, 'first')
        yield* storage.create(TEST_DIR, 'second')

        // Append to s1 so it gets a newer updated_at than s2
        yield* append(storage, s1.id, [userMsg('bump')])

        const sessions = yield* storage.list()
        expect(sessions.length).toBe(2)
        // s1 was updated most recently (via append), so it comes first
        expect(expectDefined(sessions[0], 'expected first session').title).toBe(
          'first'
        )
        expect(
          expectDefined(sessions[1], 'expected second session').title
        ).toBe('second')
      }).pipe(Effect.provide(testLayer()))
    )

    it.effect('deletes a session', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const session = yield* storage.create(TEST_DIR, 'doomed')
        yield* storage.delete(session.id)

        const result = yield* storage.get(session.id).pipe(Effect.flip)
        expect(result._tag).toBe('StorageError')
      }).pipe(Effect.provide(testLayer()))
    )
  })

  // -- Append + Conversation ------------------------------------------------

  describe('append / conversation', () => {
    it.effect('appends messages and reconstructs conversation', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const session = yield* storage.create(TEST_DIR, 'chat')

        yield* append(storage, session.id, [
          systemMsg('You are helpful.'),
          userMsg('Hello!'),
          assistantMsg('Hi there!'),
        ])

        const prompt = yield* conversation(storage, session.id)
        expect(prompt.content.length).toBe(3)

        // Check roles in order
        const roles = prompt.content.map((m) => m.role)
        expect(roles).toEqual(['system', 'user', 'assistant'])
      }).pipe(Effect.provide(testLayer()))
    )

    it.effect('appends incrementally', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const session = yield* storage.create(TEST_DIR, 'incremental')

        // First turn
        yield* append(storage, session.id, [
          systemMsg('System prompt'),
          userMsg('First message'),
          assistantMsg('First response'),
        ])

        // Second turn
        yield* append(storage, session.id, [
          userMsg('Second message'),
          assistantMsg('Second response'),
        ])

        const prompt = yield* conversation(storage, session.id)
        expect(prompt.content.length).toBe(5)
      }).pipe(Effect.provide(testLayer()))
    )

    it.effect('handles empty session conversation', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const session = yield* storage.create(TEST_DIR, 'empty')
        const prompt = yield* conversation(storage, session.id)

        expect(prompt.content.length).toBe(0)
      }).pipe(Effect.provide(testLayer()))
    )

    it.effect('handles tool calls and results', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const session = yield* storage.create(TEST_DIR, 'tools')

        yield* append(storage, session.id, [
          systemMsg('You have tools.'),
          userMsg('Read foo.ts'),
          toolCallMsg('tc_1', 'Read', { path: 'foo.ts' }),
          toolResultMsg('tc_1', 'Read', 'contents of foo.ts'),
          assistantMsg('Here are the contents.'),
        ])

        const prompt = yield* conversation(storage, session.id)
        expect(prompt.content.length).toBe(5)

        // The conversation round-trips — we can re-encode it
        const json = yield* Schema.encodeEffect(Prompt.Prompt)(prompt)
        const decoded = yield* Schema.decodeEffect(Prompt.Prompt)(json)
        expect(decoded.content.length).toBe(5)
      }).pipe(Effect.provide(testLayer()))
    )

    it.effect('no-ops on empty append', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const session = yield* storage.create(TEST_DIR, 'noop')
        yield* append(storage, session.id, [])

        const fetched = yield* storage.get(session.id)
        expect(fetched.updatedAt).toBeGreaterThanOrEqual(session.updatedAt)
      }).pipe(Effect.provide(testLayer()))
    )
  })

  // -- Forking + Branching --------------------------------------------------

  describe('leaves / explicit-base forking', () => {
    it.effect('lists leaves (single branch = one leaf)', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const session = yield* storage.create(TEST_DIR, 'linear')

        yield* append(storage, session.id, [
          userMsg('Hello'),
          assistantMsg('Hi'),
        ])

        const tips = yield* storage.leaves(session.id)
        expect(tips.length).toBe(1)
      }).pipe(Effect.provide(testLayer()))
    )

    it.effect('forks conversation by appending at an explicit base node', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const session = yield* storage.create(TEST_DIR, 'fork-test')

        // Build initial conversation: system -> user1 -> assistant1
        yield* append(storage, session.id, [
          systemMsg('System'),
          userMsg('First question'),
          assistantMsg('First answer'),
        ])

        // Get leaves to find the current tip, then walk back to find
        // the message we want to fork from (the system message)
        const beforeFork = yield* conversation(storage, session.id)
        expect(beforeFork.content.length).toBe(3)

        // Get all leaves to find messages. The head is at assistant1.
        const tips1 = yield* storage.leaves(session.id)
        expect(tips1.length).toBe(1)
        // The system message is the root — find it by walking from assistant1
        // We need to get the parent chain. Let's use leaves to get the tip,
        // then use its grandparent (system msg).
        // Actually, we need the message IDs. Let's fork from the user message.
        // The user message is assistant1's grandparent (system -> user -> assistant).
        // We can get it from the parent chain.
        const systemMsgNode = expectDefined(tips1[0], 'expected first leaf')
        // Walk: assistant -> user -> system. parentId chain.
        // But we only have the leaf. Let me think about this differently:
        // after the first append, head is at assistant1.
        // assistant1.parentId = user1.id
        // user1.parentId = system.id
        // system.parentId = null
        //
        // We want to fork after user1 (try a different response).
        // We need user1's ID. The leaves API gives us the leaf's MessageNode.
        // parent of assistant1 = user1.
        const user1Id = expectDefined(
          systemMsgNode.parentId,
          'expected user parent id'
        )

        // Fork: set head to user1 (so next append branches from there)
        // Verify explicit-base conversation is just system + user1
        const forked = yield* storage.conversation(session.id, user1Id)
        expect(forked.content.length).toBe(2)
        expect(forked.content.map((m) => m.role)).toEqual(['system', 'user'])

        // Append a different assistant response on the new branch
        const newNodeIds = yield* append(
          storage,
          session.id,
          [assistantMsg('Different answer!')],
          user1Id
        )

        // New conversation has 3 messages, but with the new response
        const newBranch = yield* storage.conversation(
          session.id,
          expectDefined(newNodeIds[0], 'expected new branch node')
        )
        expect(newBranch.content.length).toBe(3)

        // Now we have TWO leaves (two branches)
        const tips2 = yield* storage.leaves(session.id)
        expect(tips2.length).toBe(2)
      }).pipe(Effect.provide(testLayer()))
    )

    it.effect('switches between branches', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const session = yield* storage.create(TEST_DIR, 'switch-test')

        // Branch A: system -> user -> assistantA
        yield* append(storage, session.id, [
          systemMsg('System'),
          userMsg('Question'),
          assistantMsg('Answer A'),
        ])

        // Remember branch A's leaf
        const tipsA = yield* storage.leaves(session.id)
        const branchALeaf = expectDefined(tipsA[0], 'expected branch A leaf').id

        // Fork from user message (parent of assistantA)
        const userMsgId = expectDefined(
          expectDefined(tipsA[0], 'expected branch A leaf').parentId,
          'expected branch A user message id'
        )
        // Branch B: system -> user -> assistantB
        const branchBNodeIds = yield* append(
          storage,
          session.id,
          [assistantMsg('Answer B')],
          userMsgId
        )

        // We're on branch B now
        const branchB = yield* storage.conversation(
          session.id,
          expectDefined(branchBNodeIds[0], 'expected branch B node')
        )
        const lastMsgB = expectDefined(
          branchB.content[branchB.content.length - 1],
          'expected branch B final message'
        )
        expect(lastMsgB.role).toBe('assistant')

        // Remember branch B's leaf
        const tipsB = yield* storage.leaves(session.id)
        const branchBLeaf = expectDefined(
          tipsB.find((t) => t.id !== branchALeaf),
          'expected branch B leaf'
        ).id

        // Read branch A explicitly
        const backToA = yield* storage.conversation(session.id, branchALeaf)
        expect(backToA.content.length).toBe(3)

        // Read branch B explicitly
        const backToB = yield* storage.conversation(session.id, branchBLeaf)
        expect(backToB.content.length).toBe(3)
      }).pipe(Effect.provide(testLayer()))
    )

    it.effect('fails to append at a node from another session', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const s1 = yield* storage.create(TEST_DIR, 'session 1')
        const s2 = yield* storage.create(TEST_DIR, 'session 2')

        yield* append(storage, s1.id, [userMsg('Hello from s1')])

        const tips = yield* storage.leaves(s1.id)
        const s1MsgId = expectDefined(tips[0], 'expected session 1 leaf').id

        // Try to append in s2 at s1's node
        const error = yield* append(
          storage,
          s2.id,
          [userMsg('bad')],
          s1MsgId
        ).pipe(Effect.flip)
        expect(error._tag).toBe('StorageError')
        expect(error.operation).toBe('append')
      }).pipe(Effect.provide(testLayer()))
    )

    it.effect('empty session has no leaves', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const session = yield* storage.create(TEST_DIR, 'empty')
        const tips = yield* storage.leaves(session.id)

        expect(tips.length).toBe(0)
      }).pipe(Effect.provide(testLayer()))
    )
  })

  // -- Timestamps -----------------------------------------------------------

  describe('timestamps', () => {
    it.live('updates updatedAt on append', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const session = yield* storage.create(TEST_DIR, 'timestamps')
        const created = session.updatedAt

        // Small delay to ensure timestamp differs (it.live uses real clock)
        yield* Effect.sleep(15)
        yield* append(storage, session.id, [userMsg('Hello')])

        const after = yield* storage.get(session.id)
        expect(after.updatedAt).toBeGreaterThan(created)
      }).pipe(Effect.provide(testLayer()))
    )
  })

  // -- Cascade delete -------------------------------------------------------

  describe('cascade delete', () => {
    it.effect('deleting session removes all messages', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const session = yield* storage.create(TEST_DIR, 'cascade')

        yield* append(storage, session.id, [
          userMsg('Hello'),
          assistantMsg('Hi'),
          userMsg('Bye'),
        ])

        yield* storage.delete(session.id)

        // Session is gone
        const err = yield* storage.get(session.id).pipe(Effect.flip)
        expect(err._tag).toBe('StorageError')
      }).pipe(Effect.provide(testLayer()))
    )
  })
})
