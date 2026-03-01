import { Effect, Schema } from 'effect'
import { Prompt } from '@effect/ai'
import { describe, expect, it } from '@effect/vitest'
import { SessionStorage, SqliteSession } from '../src/index.ts'

// ---------------------------------------------------------------------------
// Test layer — in-memory sqlite per test
// ---------------------------------------------------------------------------

const testLayer = SqliteSession({ path: ':memory:' })

const TEST_DIR = '/tmp/test-project'

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
        expect(session.directory).toBe(TEST_DIR)
        expect(session.title).toBe('test session')
        expect(session.headId).toBeNull()
      }).pipe(Effect.provide(testLayer))
    )

    it.effect('creates a session with null title by default', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const session = yield* storage.create(TEST_DIR)

        expect(session.title).toBeNull()
      }).pipe(Effect.provide(testLayer))
    )

    it.effect('gets a session by ID', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const created = yield* storage.create(TEST_DIR, 'test')
        const fetched = yield* storage.get(created.id)

        expect(fetched.id).toBe(created.id)
        expect(fetched.title).toBe('test')
      }).pipe(Effect.provide(testLayer))
    )

    it.effect('fails to get a nonexistent session', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const result = yield* storage
          .get('nonexistent' as any)
          .pipe(Effect.flip)

        expect(result._tag).toBe('StorageError')
        expect(result.operation).toBe('get')
      }).pipe(Effect.provide(testLayer))
    )

    it.effect('lists sessions ordered by updated_at desc', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const s1 = yield* storage.create(TEST_DIR, 'first')
        yield* storage.create(TEST_DIR, 'second')

        // Append to s1 so it gets a newer updated_at than s2
        yield* storage.append(s1.id, [userMsg('bump')])

        const sessions = yield* storage.list()
        expect(sessions.length).toBe(2)
        // s1 was updated most recently (via append), so it comes first
        expect(sessions[0]!.title).toBe('first')
        expect(sessions[1]!.title).toBe('second')
      }).pipe(Effect.provide(testLayer))
    )

    it.effect('deletes a session', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const session = yield* storage.create(TEST_DIR, 'doomed')
        yield* storage.delete(session.id)

        const result = yield* storage.get(session.id).pipe(Effect.flip)
        expect(result._tag).toBe('StorageError')
      }).pipe(Effect.provide(testLayer))
    )
  })

  // -- Append + Conversation ------------------------------------------------

  describe('append / conversation', () => {
    it.effect('appends messages and reconstructs conversation', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const session = yield* storage.create(TEST_DIR, 'chat')

        yield* storage.append(session.id, [
          systemMsg('You are helpful.'),
          userMsg('Hello!'),
          assistantMsg('Hi there!'),
        ])

        const prompt = yield* storage.conversation(session.id)
        expect(prompt.content.length).toBe(3)

        // Check roles in order
        const roles = prompt.content.map((m) => m.role)
        expect(roles).toEqual(['system', 'user', 'assistant'])
      }).pipe(Effect.provide(testLayer))
    )

    it.effect('appends incrementally', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const session = yield* storage.create(TEST_DIR, 'incremental')

        // First turn
        yield* storage.append(session.id, [
          systemMsg('System prompt'),
          userMsg('First message'),
          assistantMsg('First response'),
        ])

        // Second turn
        yield* storage.append(session.id, [
          userMsg('Second message'),
          assistantMsg('Second response'),
        ])

        const prompt = yield* storage.conversation(session.id)
        expect(prompt.content.length).toBe(5)
      }).pipe(Effect.provide(testLayer))
    )

    it.effect('handles empty session conversation', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const session = yield* storage.create(TEST_DIR, 'empty')
        const prompt = yield* storage.conversation(session.id)

        expect(prompt.content.length).toBe(0)
      }).pipe(Effect.provide(testLayer))
    )

    it.effect('handles tool calls and results', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const session = yield* storage.create(TEST_DIR, 'tools')

        yield* storage.append(session.id, [
          systemMsg('You have tools.'),
          userMsg('Read foo.ts'),
          toolCallMsg('tc_1', 'ReadFile', { path: 'foo.ts' }),
          toolResultMsg('tc_1', 'ReadFile', 'contents of foo.ts'),
          assistantMsg('Here are the contents.'),
        ])

        const prompt = yield* storage.conversation(session.id)
        expect(prompt.content.length).toBe(5)

        // The conversation round-trips — we can re-encode it
        const json = yield* Schema.encode(Prompt.FromJson)(prompt)
        const decoded = yield* Schema.decode(Prompt.FromJson)(json)
        expect(decoded.content.length).toBe(5)
      }).pipe(Effect.provide(testLayer))
    )

    it.effect('no-ops on empty append', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const session = yield* storage.create(TEST_DIR, 'noop')
        yield* storage.append(session.id, [])

        const fetched = yield* storage.get(session.id)
        expect(fetched.headId).toBeNull()
      }).pipe(Effect.provide(testLayer))
    )
  })

  // -- Forking + Branching --------------------------------------------------

  describe('setHead / leaves / forking', () => {
    it.effect('lists leaves (single branch = one leaf)', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const session = yield* storage.create(TEST_DIR, 'linear')

        yield* storage.append(session.id, [
          userMsg('Hello'),
          assistantMsg('Hi'),
        ])

        const tips = yield* storage.leaves(session.id)
        expect(tips.length).toBe(1)
      }).pipe(Effect.provide(testLayer))
    )

    it.effect('forks conversation by setting head to earlier message', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const session = yield* storage.create(TEST_DIR, 'fork-test')

        // Build initial conversation: system -> user1 -> assistant1
        yield* storage.append(session.id, [
          systemMsg('System'),
          userMsg('First question'),
          assistantMsg('First answer'),
        ])

        // Get leaves to find the current tip, then walk back to find
        // the message we want to fork from (the system message)
        const beforeFork = yield* storage.conversation(session.id)
        expect(beforeFork.content.length).toBe(3)

        // Get all leaves to find messages. The head is at assistant1.
        const tips1 = yield* storage.leaves(session.id)
        expect(tips1.length).toBe(1)
        // The system message is the root — find it by walking from assistant1
        // We need to get the parent chain. Let's use leaves to get the tip,
        // then setHead to its grandparent (system msg).
        // Actually, we need the message IDs. Let's fork from the user message.
        // The user message is assistant1's grandparent (system -> user -> assistant).
        // We can get it from the parent chain.
        const systemMsgNode = tips1[0]!
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
        const user1Id = systemMsgNode.parentId!

        // Fork: set head to user1 (so next append branches from there)
        yield* storage.setHead(session.id, user1Id)

        // Verify conversation is now just system + user1
        const forked = yield* storage.conversation(session.id)
        expect(forked.content.length).toBe(2)
        expect(forked.content.map((m) => m.role)).toEqual(['system', 'user'])

        // Append a different assistant response on the new branch
        yield* storage.append(session.id, [assistantMsg('Different answer!')])

        // New conversation has 3 messages, but with the new response
        const newBranch = yield* storage.conversation(session.id)
        expect(newBranch.content.length).toBe(3)

        // Now we have TWO leaves (two branches)
        const tips2 = yield* storage.leaves(session.id)
        expect(tips2.length).toBe(2)
      }).pipe(Effect.provide(testLayer))
    )

    it.effect('switches between branches', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const session = yield* storage.create(TEST_DIR, 'switch-test')

        // Branch A: system -> user -> assistantA
        yield* storage.append(session.id, [
          systemMsg('System'),
          userMsg('Question'),
          assistantMsg('Answer A'),
        ])

        // Remember branch A's leaf
        const tipsA = yield* storage.leaves(session.id)
        const branchALeaf = tipsA[0]!.id

        // Fork from user message (parent of assistantA)
        const userMsgId = tipsA[0]!.parentId!
        yield* storage.setHead(session.id, userMsgId)

        // Branch B: system -> user -> assistantB
        yield* storage.append(session.id, [assistantMsg('Answer B')])

        // We're on branch B now
        const branchB = yield* storage.conversation(session.id)
        const lastMsgB = branchB.content[branchB.content.length - 1]!
        expect(lastMsgB.role).toBe('assistant')

        // Remember branch B's leaf
        const tipsB = yield* storage.leaves(session.id)
        const branchBLeaf = tipsB.find((t) => t.id !== branchALeaf)!.id

        // Switch back to branch A
        yield* storage.setHead(session.id, branchALeaf)
        const backToA = yield* storage.conversation(session.id)
        expect(backToA.content.length).toBe(3)

        // Switch to branch B
        yield* storage.setHead(session.id, branchBLeaf)
        const backToB = yield* storage.conversation(session.id)
        expect(backToB.content.length).toBe(3)
      }).pipe(Effect.provide(testLayer))
    )

    it.effect('fails to setHead to a message from another session', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const s1 = yield* storage.create(TEST_DIR, 'session 1')
        const s2 = yield* storage.create(TEST_DIR, 'session 2')

        yield* storage.append(s1.id, [userMsg('Hello from s1')])

        const tips = yield* storage.leaves(s1.id)
        const s1MsgId = tips[0]!.id

        // Try to set s2's head to s1's message
        const error = yield* storage.setHead(s2.id, s1MsgId).pipe(Effect.flip)
        expect(error._tag).toBe('StorageError')
        expect(error.operation).toBe('setHead')
      }).pipe(Effect.provide(testLayer))
    )

    it.effect('empty session has no leaves', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const session = yield* storage.create(TEST_DIR, 'empty')
        const tips = yield* storage.leaves(session.id)

        expect(tips.length).toBe(0)
      }).pipe(Effect.provide(testLayer))
    )
  })

  // -- Head tracking --------------------------------------------------------

  describe('head tracking', () => {
    it.effect('advances head on append', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const session = yield* storage.create(TEST_DIR, 'head-tracking')

        yield* storage.append(session.id, [userMsg('msg1')])
        const after1 = yield* storage.get(session.id)
        expect(after1.headId).not.toBeNull()
        const head1 = after1.headId

        yield* storage.append(session.id, [assistantMsg('msg2')])
        const after2 = yield* storage.get(session.id)
        expect(after2.headId).not.toBe(head1)
      }).pipe(Effect.provide(testLayer))
    )

    it.live('updates updatedAt on append', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const session = yield* storage.create(TEST_DIR, 'timestamps')
        const created = session.updatedAt

        // Small delay to ensure timestamp differs (it.live uses real clock)
        yield* Effect.sleep(15)
        yield* storage.append(session.id, [userMsg('Hello')])

        const after = yield* storage.get(session.id)
        expect(after.updatedAt).toBeGreaterThan(created)
      }).pipe(Effect.provide(testLayer))
    )
  })

  // -- Cascade delete -------------------------------------------------------

  describe('cascade delete', () => {
    it.effect('deleting session removes all messages', () =>
      Effect.gen(function* () {
        const storage = yield* SessionStorage
        const session = yield* storage.create(TEST_DIR, 'cascade')

        yield* storage.append(session.id, [
          userMsg('Hello'),
          assistantMsg('Hi'),
          userMsg('Bye'),
        ])

        yield* storage.delete(session.id)

        // Session is gone
        const err = yield* storage.get(session.id).pipe(Effect.flip)
        expect(err._tag).toBe('StorageError')
      }).pipe(Effect.provide(testLayer))
    )
  })
})
