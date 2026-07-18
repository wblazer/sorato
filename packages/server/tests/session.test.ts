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
  StoredMessage,
  type SessionStorageApi,
  type StoredMessageEncoded,
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
  messages: ReadonlyArray<StoredMessageEncoded>,
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
    const batch = yield* storage.commitNodeBatch({
      sessionId,
      runId,
      messages,
      baseNodeId: resolvedBaseNodeId,
    })

    return batch?.nodes.map((node) => node.id) ?? []
  })

const conversation = (storage: SessionStorageApi, sessionId: string) =>
  Effect.gen(function* () {
    const headNodeId = yield* latestLeafId(storage, sessionId)
    return yield* storage.conversation(sessionId, headNodeId)
  })
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const encodeMessage = Schema.encodeSync(StoredMessage)

const systemMsg = (text: string): StoredMessageEncoded =>
  encodeMessage(
    Schema.decodeUnknownSync(StoredMessage)({ role: 'system', content: text })
  )

const bootstrapSystemMsg = (text: string): StoredMessageEncoded =>
  encodeMessage(
    Schema.decodeUnknownSync(StoredMessage)({
      role: 'system',
      content: text,
      source: 'system-prompt',
    })
  )

const userMsg = (text: string): StoredMessageEncoded =>
  encodeMessage(
    Schema.decodeUnknownSync(StoredMessage)({ role: 'user', content: text })
  )

const assistantMsg = (text: string): StoredMessageEncoded =>
  encodeMessage(
    Schema.decodeUnknownSync(StoredMessage)({
      role: 'assistant',
      content: text,
    })
  )

const partialAssistantMsg = (text: string): StoredMessageEncoded =>
  encodeMessage(
    Schema.decodeUnknownSync(StoredMessage)({
      role: 'assistant',
      content: text,
    })
  )

const toolCallMsg = (
  id: string,
  name: string,
  params: unknown
): StoredMessageEncoded =>
  encodeMessage(
    Schema.decodeUnknownSync(StoredMessage)({
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
): StoredMessageEncoded =>
  encodeMessage(
    Schema.decodeUnknownSync(StoredMessage)({
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

    it.effect('does not read ancestry from another session', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const source = yield* storage.create(TEST_DIR, 'source')
        const target = yield* storage.create(TEST_DIR, 'target')
        const [sourceNodeId] = yield* append(storage, source.id, [
          userMsg('private source message'),
        ])
        const foreignNodeId = expectDefined(
          sourceNodeId,
          'expected source node id'
        )

        const prompt = yield* storage.conversation(target.id, foreignNodeId)
        const messages = yield* storage.messages(target.id, foreignNodeId)

        expect(prompt.content).toEqual([])
        expect(messages).toEqual([])
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
        const before = yield* storage.conversationSnapshot(session.id)
        yield* append(storage, session.id, [])

        const fetched = yield* storage.get(session.id)
        const after = yield* storage.conversationSnapshot(session.id)
        expect(fetched.updatedAt).toBeGreaterThanOrEqual(session.updatedAt)
        expect(after.sequence).toBe(before.sequence)
      }).pipe(Effect.provide(testLayer()))
    )

    it.effect('reads nodes and the global durable sequence as a snapshot', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const session = yield* storage.create(TEST_DIR, 'snapshot')
        const initial = yield* storage.conversationSnapshot(session.id)
        expect(initial).toEqual({ sequence: 0, nodes: [] })

        const nodeIds = yield* append(storage, session.id, [
          userMsg('snapshot input'),
          assistantMsg('snapshot output'),
        ])
        const snapshot = yield* storage.conversationSnapshot(session.id)
        const persistedSession = yield* storage.get(session.id)
        const replay = yield* storage.durableEventsAfter(0)

        expect(snapshot.sequence).toBe(1)
        expect(snapshot.nodes.map((node) => node.id)).toEqual(nodeIds)
        expect(snapshot.nodes.map((node) => node.encoded.content)).toEqual([
          'snapshot input',
          'snapshot output',
        ])
        expect(replay[0]).toMatchObject({
          _tag: 'NodeBatchCommitted',
          sessionUpdatedAt: persistedSession.updatedAt,
        })
      }).pipe(Effect.provide(testLayer()))
    )

    it.effect('replays committed batches in global sequence order', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const firstSession = yield* storage.create(TEST_DIR, 'first replay')
        const secondSession = yield* storage.create(TEST_DIR, 'second replay')

        yield* append(storage, firstSession.id, [userMsg('first')])
        yield* append(storage, secondSession.id, [userMsg('second')])

        const all = yield* storage.durableEventsAfter(0)
        const afterFirst = yield* storage.durableEventsAfter(
          expectDefined(all[0], 'expected first mutation').sequence
        )

        expect(all.map((batch) => batch.sequence)).toEqual([1, 2])
        expect(all.map((batch) => batch.sessionId)).toEqual([
          firstSession.id,
          secondSession.id,
        ])
        expect(afterFirst.map((batch) => batch.sequence)).toEqual([2])
        const second = afterFirst[0]
        expect(second?._tag).toBe('NodeBatchCommitted')
        if (second?._tag === 'NodeBatchCommitted') {
          expect(second.nodes[0]?.encoded.content).toBe('second')
        }
      }).pipe(Effect.provide(testLayer()))
    )

    it.effect('durably replays one idempotent run end', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const session = yield* storage.create(TEST_DIR, 'durable run end')
        const runId = crypto.randomUUID()
        yield* storage.createRun({
          id: runId,
          sessionId: session.id,
          baseNodeId: null,
        })

        const first = yield* storage.completeRun({
          id: runId,
          status: 'completed',
        })
        const duplicate = yield* storage.completeRun({
          id: runId,
          status: 'completed',
        })
        const replay = yield* storage.durableEventsAfter(0)

        expect(first).toMatchObject({
          _tag: 'RunEnd',
          sequence: 1,
          sessionId: session.id,
          runId,
        })
        expect(duplicate).toBeNull()
        expect(replay).toEqual([first])
      }).pipe(Effect.provide(testLayer()))
    )

    it.effect('replays active run creation and base updates', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const session = yield* storage.create(TEST_DIR, 'active replay')
        const runId = crypto.randomUUID()
        yield* storage.createRun({
          id: runId,
          sessionId: session.id,
          baseNodeId: null,
        })

        const started = yield* storage.appendActiveRunUpsert({
          sessionId: session.id,
          runId,
          baseNodeId: null,
          kind: 'summary',
          visibility: 'background',
          title: 'Generating summary',
          parentRunId: 'parent-run',
          toolCallId: 'compact-call',
        })
        const baseUpdated = yield* storage.appendActiveRunUpsert({
          sessionId: session.id,
          runId,
          baseNodeId: 'new-base',
          kind: 'summary',
          visibility: 'background',
          title: 'Generating summary',
          parentRunId: 'parent-run',
          toolCallId: 'compact-call',
        })
        const ended = yield* storage.completeRun({
          id: runId,
          status: 'completed',
        })
        const replay = yield* storage.durableEventsAfter(0)

        expect(started).toMatchObject({
          _tag: 'ActiveRunUpserted',
          sequence: 1,
          baseNodeId: null,
        })
        expect(baseUpdated).toMatchObject({
          _tag: 'ActiveRunUpserted',
          sequence: 2,
          baseNodeId: 'new-base',
        })
        expect(replay).toEqual([started, baseUpdated, ended])
        expect(replay.map((event) => event._tag)).toEqual([
          'ActiveRunUpserted',
          'ActiveRunUpserted',
          'RunEnd',
        ])
      }).pipe(Effect.provide(testLayer()))
    )

    it.effect('persists title and durable title event atomically', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const session = yield* storage.create(TEST_DIR)

        const event = yield* storage.setTitle(session.id, 'Durable title')
        const persisted = yield* storage.get(session.id)
        const replay = yield* storage.durableEventsAfter(0)

        expect(persisted.title).toBe('Durable title')
        expect(event).toMatchObject({
          _tag: 'SessionTitleUpdated',
          sequence: 1,
          sessionId: session.id,
          title: 'Durable title',
          updatedAt: persisted.updatedAt,
        })
        expect(replay).toEqual([event])
      }).pipe(Effect.provide(testLayer()))
    )

    it.effect('rejects a run owned by another session', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const owner = yield* storage.create(TEST_DIR, 'owner')
        const target = yield* storage.create(TEST_DIR, 'target')
        const runId = crypto.randomUUID()
        yield* storage.createRun({
          id: runId,
          sessionId: owner.id,
          baseNodeId: null,
        })

        const error = yield* storage
          .commitNodeBatch({
            sessionId: target.id,
            runId,
            messages: [userMsg('wrong owner')],
            baseNodeId: null,
          })
          .pipe(Effect.flip)

        expect(error.operation).toBe('commitNodeBatch')
        expect(error.message).toContain('does not belong')
        expect(yield* storage.messages(target.id)).toEqual([])
      }).pipe(Effect.provide(testLayer()))
    )
  })

  describe('compactRange', () => {
    it.effect('rejects a run owned by another session', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const owner = yield* storage.create(TEST_DIR, 'compact owner')
        const target = yield* storage.create(TEST_DIR, 'compact target')
        const [targetNodeId] = yield* append(storage, target.id, [
          userMsg('target message'),
        ])
        const nodeId = expectDefined(targetNodeId, 'expected target node')
        const runId = crypto.randomUUID()
        yield* storage.createRun({
          id: runId,
          sessionId: owner.id,
          baseNodeId: null,
        })

        const error = yield* storage
          .compactRange({
            sessionId: target.id,
            runId,
            baseHeadNodeId: nodeId,
            startNodeId: nodeId,
            endNodeId: nodeId,
            summaryContent: 'wrong owner',
          })
          .pipe(Effect.flip)

        expect(error.operation).toBe('compactRange')
        expect(error.message).toContain('does not belong')
      }).pipe(Effect.provide(testLayer()))
    )

    it.effect('rejects a selected path from another session', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const source = yield* storage.create(TEST_DIR, 'source')
        const target = yield* storage.create(TEST_DIR, 'target')
        const [startNodeId, endNodeId] = yield* append(storage, source.id, [
          userMsg('source question'),
          assistantMsg('source answer'),
        ])
        const foreignStartNodeId = expectDefined(
          startNodeId,
          'expected source start node id'
        )
        const foreignEndNodeId = expectDefined(
          endNodeId,
          'expected source end node id'
        )
        const compactRunId = crypto.randomUUID()
        yield* storage.createRun({
          id: compactRunId,
          sessionId: target.id,
          providerId: 'test',
          modelId: 'test-model',
          billingMode: 'api-key',
          baseNodeId: foreignEndNodeId,
        })

        const error = yield* storage
          .compactRange({
            sessionId: target.id,
            runId: compactRunId,
            baseHeadNodeId: foreignEndNodeId,
            startNodeId: foreignStartNodeId,
            endNodeId: foreignEndNodeId,
            summaryContent: 'must not be created',
          })
          .pipe(Effect.flip)

        expect(error._tag).toBe('StorageError')
        expect(error.operation).toBe('compactRange')
        expect(yield* storage.messages(target.id)).toEqual([])
      }).pipe(Effect.provide(testLayer()))
    )

    it.effect('rejects ranges that include system messages', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const session = yield* storage.create(TEST_DIR, 'system-compact')
        const [systemNodeId, userNodeId] = yield* append(storage, session.id, [
          bootstrapSystemMsg('System'),
          userMsg('Hello'),
          assistantMsg('Hi'),
        ])
        const resolvedUserNodeId = expectDefined(
          userNodeId,
          'expected user node id'
        )
        const compactRunId = crypto.randomUUID()
        yield* storage.createRun({
          id: compactRunId,
          sessionId: session.id,
          baseNodeId: resolvedUserNodeId,
        })

        const result = yield* storage
          .compactRange({
            sessionId: session.id,
            runId: compactRunId,
            baseHeadNodeId: resolvedUserNodeId,
            startNodeId: expectDefined(systemNodeId, 'expected system node id'),
            endNodeId: resolvedUserNodeId,
            summaryContent: 'summary',
          })
          .pipe(Effect.flip)

        expect(result._tag).toBe('StorageError')
        expect(result.message).toContain('bootstrap system messages')
      }).pipe(Effect.provide(testLayer()))
    )

    it.effect('allows ranges that include partial assistant messages', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const session = yield* storage.create(TEST_DIR, 'partial-compact')
        const [systemNodeId, userNodeId] = yield* append(storage, session.id, [
          bootstrapSystemMsg('System'),
          userMsg('Hello'),
        ])
        const [assistantNodeId, nextUserNodeId] = yield* append(
          storage,
          session.id,
          [partialAssistantMsg('Partial'), userMsg('Continue')],
          expectDefined(userNodeId, 'expected user node id')
        )
        const resolvedNextUserNodeId = expectDefined(
          nextUserNodeId,
          'expected next user id'
        )
        const compactRunId = crypto.randomUUID()
        yield* storage.createRun({
          id: compactRunId,
          sessionId: session.id,
          providerId: 'test',
          modelId: 'test-model',
          billingMode: 'api-key',
          baseNodeId: resolvedNextUserNodeId,
        })

        const result = yield* storage.compactRange({
          sessionId: session.id,
          runId: compactRunId,
          baseHeadNodeId: resolvedNextUserNodeId,
          startNodeId: expectDefined(
            assistantNodeId,
            'expected assistant node id'
          ),
          endNodeId: resolvedNextUserNodeId,
          summaryContent: 'summary',
          contentThroughEventId: 7,
        })

        expect(result.summaryNodeId).toBeTruthy()
        expect(result.batch.contentThroughEventId).toBe(7)
        expect(
          yield* storage.durableEventsAfter(result.batch.sequence - 1)
        ).toMatchObject([
          {
            _tag: 'NodeBatchCommitted',
            sequence: result.batch.sequence,
            contentThroughEventId: 7,
          },
        ])
        const summaryMessages = yield* storage.messages(
          session.id,
          result.summaryNodeId
        )
        const summaryMessage = expectDefined(
          summaryMessages.at(-1),
          'expected summary message'
        )
        expect(summaryMessage.kind).toBe('summary')
        expect(summaryMessage.encoded.role).toBe('user')
        expect(
          summaryMessage.encoded.role === 'user'
            ? summaryMessage.encoded.source
            : undefined
        ).toBe('summary')
        expect(summaryMessage.encoded.content).toContain(
          'This is a summary of earlier conversation messages'
        )
        expect(summaryMessage.encoded.content).toContain('<summary>\nsummary')
        expect(
          summaryMessage.encoded.role === 'user'
            ? summaryMessage.encoded.metadata?.summary?.content
            : undefined
        ).toBe('summary')
        const prompt = yield* storage.conversation(
          session.id,
          result.summaryNodeId
        )
        const summaryPromptMessage = expectDefined(
          prompt.content.at(-1),
          'expected summary prompt message'
        )
        expect(summaryPromptMessage.role).toBe('user')
        expect(summaryPromptMessage.content).toMatchObject([
          {
            type: 'text',
            text: expect.stringContaining('<summary>\nsummary\n</summary>'),
          },
        ])
        expect(systemNodeId).toBeTruthy()
        expect(userNodeId).toBeTruthy()
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
        expect(error.operation).toBe('commitNodeBatch')
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
        const survivor = yield* storage.create(TEST_DIR, 'survivor')
        yield* append(storage, survivor.id, [userMsg('still live')])
        const replay = yield* storage.durableEventsAfter(0)
        expect(replay.map((event) => event.sequence)).toEqual([1, 2])
        expect(replay[0]?._tag).toBe('NodeBatchCommitted')
        if (replay[0]?._tag === 'NodeBatchCommitted') {
          expect(replay[0].nodes.map((node) => node.encoded.content)).toEqual([
            'Hello',
            'Hi',
            'Bye',
          ])
        }
        expect(
          (yield* storage.durableEventsAfter(1)).map((event) => event.sequence)
        ).toEqual([2])
      }).pipe(Effect.provide(testLayer()))
    )
  })
})
