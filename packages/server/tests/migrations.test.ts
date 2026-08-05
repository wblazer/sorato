import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BunServices } from '@effect/platform-bun'
import { SqliteClient } from '@effect/sql-sqlite-bun'
import { Effect } from 'effect'
import { describe, expect, it } from '@effect/vitest'
import { SqlClient } from 'effect/unstable/sql/SqlClient'
import { runMigrations } from '../src/db/migrations.ts'

describe('database migrations', () => {
  it.effect(
    'moves historical bootstrap prompts out of the conversation tree',
    () => {
      const path = join(tmpdir(), `sorato-migration-${crypto.randomUUID()}.db`)
      const test = Effect.gen(function* () {
        const sql = yield* SqlClient
        yield* runMigrations({ toMigrationInclusive: 4 })
        const now = new Date().toISOString()

        yield* sql`
        INSERT INTO projects (
          id, name, path, created_at, updated_at, last_opened_at
        ) VALUES ('project', 'Project', '/project', 0, 0, 0)
      `
        yield* sql`
        INSERT INTO sessions (id, project_id, title, created_at, updated_at)
        VALUES ('session', 'project', NULL, ${now}, ${now})
      `
        yield* sql`
        INSERT INTO runs (id, session_id, base_node_id, status, created_at)
        VALUES ('run-1', 'session', NULL, 'completed', ${now})
      `
        yield* sql`
        INSERT INTO messages (id, session_id, role, content, created_at)
        VALUES
          ('system-message', 'session', 'system', ${JSON.stringify({ role: 'system', content: 'Base prompt', source: 'system-prompt' })}, ${now}),
          ('agents-message', 'session', 'system', ${JSON.stringify({ role: 'system', content: 'Project instructions', source: 'agents-md' })}, ${now}),
          ('user-message', 'session', 'user', ${JSON.stringify({ role: 'user', content: 'Hello' })}, ${now})
      `
        yield* sql`
        INSERT INTO nodes (
          id, session_id, parent_node_id, kind, message_id, summary_id,
          source_node_id, run_id, created_at
        ) VALUES
          ('system-node', 'session', NULL, 'message', 'system-message', NULL, NULL, 'run-1', ${now}),
          ('agents-node', 'session', 'system-node', 'message', 'agents-message', NULL, NULL, 'run-1', ${now}),
          ('user-node', 'session', 'agents-node', 'message', 'user-message', NULL, NULL, 'run-1', ${now})
      `
        yield* sql`
        INSERT INTO runs (id, session_id, base_node_id, status, created_at)
        VALUES ('run-2', 'session', 'user-node', 'completed', ${now})
      `
        yield* sql`
        INSERT INTO runs (id, session_id, base_node_id, status, created_at)
        VALUES ('summary-run', 'session', 'user-node', 'failed', ${now})
      `
        yield* sql`
        INSERT INTO durable_sync_events (
          event_type, session_id, run_id, payload, created_at
        ) VALUES
          (
            'node_batch_committed',
            'session',
            'run-1',
            ${JSON.stringify({ _tag: 'NodeBatchCommitted' })},
            0
          ),
          (
            'active_run_upserted',
            'session',
            'summary-run',
            ${JSON.stringify({ _tag: 'ActiveRunUpserted', kind: 'summary' })},
            0
          )
      `

        yield* runMigrations()

        const nodes = yield* sql<{
          readonly id: string
          readonly parent_node_id: string | null
        }>`SELECT id, parent_node_id FROM nodes ORDER BY id`
        const runs = yield* sql<{
          readonly id: string
          readonly kind: 'agent' | 'summary'
          readonly system_prompt_id: string | null
        }>`SELECT id, kind, system_prompt_id FROM runs ORDER BY id`
        const prompts = yield* sql<{
          readonly content: string
        }>`SELECT content FROM system_prompts`
        const durableEvents = yield* sql<{ readonly count: number }>`
          SELECT count(*) AS count FROM durable_sync_events
        `
        const deleteTriggers = yield* sql<{ readonly count: number }>`
          SELECT count(*) AS count
          FROM sqlite_master
          WHERE type = 'trigger' AND name = 'durable_sync_events_no_delete'
        `

        expect(nodes).toEqual([{ id: 'user-node', parent_node_id: null }])
        expect(runs[0]?.system_prompt_id).toBeTruthy()
        expect(runs[1]?.system_prompt_id).toBe(runs[0]?.system_prompt_id)
        expect(runs).toContainEqual({
          id: 'summary-run',
          kind: 'summary',
          system_prompt_id: null,
        })
        expect(prompts).toEqual([
          { content: 'Base prompt\n\nProject instructions' },
        ])
        expect(durableEvents).toEqual([{ count: 0 }])
        expect(deleteTriggers).toEqual([{ count: 1 }])
      }).pipe(
        Effect.provide(SqliteClient.layer({ filename: path })),
        Effect.provide(BunServices.layer),
        Effect.ensuring(
          Effect.promise(() => rm(path, { force: true })).pipe(Effect.orDie)
        )
      )

      return test
    }
  )

  it.effect('discards old durable events without bootstrap nodes', () => {
    const path = join(tmpdir(), `sorato-migration-${crypto.randomUUID()}.db`)
    const test = Effect.gen(function* () {
      const sql = yield* SqlClient
      yield* runMigrations({ toMigrationInclusive: 4 })
      const now = new Date().toISOString()

      yield* sql`
        INSERT INTO projects (
          id, name, path, created_at, updated_at, last_opened_at
        ) VALUES ('project', 'Project', '/project', 0, 0, 0)
      `
      yield* sql`
        INSERT INTO sessions (id, project_id, title, created_at, updated_at)
        VALUES ('session', 'project', NULL, ${now}, ${now})
      `
      yield* sql`
        INSERT INTO runs (id, session_id, base_node_id, status, created_at)
        VALUES ('run', 'session', NULL, 'interrupted', ${now})
      `
      yield* sql`
        INSERT INTO durable_sync_events (
          event_type, session_id, run_id, payload, created_at
        ) VALUES (
          'node_batch_committed',
          'session',
          'run',
          ${JSON.stringify({ _tag: 'NodeBatchCommitted' })},
          0
        )
      `

      yield* runMigrations()

      const durableEvents = yield* sql<{ readonly count: number }>`
        SELECT count(*) AS count FROM durable_sync_events
      `
      expect(durableEvents).toEqual([{ count: 0 }])
    }).pipe(
      Effect.provide(SqliteClient.layer({ filename: path })),
      Effect.provide(BunServices.layer),
      Effect.ensuring(
        Effect.promise(() => rm(path, { force: true })).pipe(Effect.orDie)
      )
    )

    return test
  })

  it.effect('discards old durable events after migration 5 was applied', () => {
    const path = join(tmpdir(), `sorato-migration-${crypto.randomUUID()}.db`)
    const test = Effect.gen(function* () {
      const sql = yield* SqlClient
      yield* runMigrations({ toMigrationInclusive: 5 })

      yield* sql`
        INSERT INTO durable_sync_events (
          event_type, session_id, run_id, payload, created_at
        ) VALUES (
          'node_batch_committed',
          'session',
          'run',
          ${JSON.stringify({ _tag: 'NodeBatchCommitted' })},
          0
        )
      `

      yield* runMigrations()

      const durableEvents = yield* sql<{ readonly count: number }>`
        SELECT count(*) AS count FROM durable_sync_events
      `
      const deleteTriggers = yield* sql<{ readonly count: number }>`
        SELECT count(*) AS count
        FROM sqlite_master
        WHERE type = 'trigger' AND name = 'durable_sync_events_no_delete'
      `

      expect(durableEvents).toEqual([{ count: 0 }])
      expect(deleteTriggers).toEqual([{ count: 1 }])
    }).pipe(
      Effect.provide(SqliteClient.layer({ filename: path })),
      Effect.provide(BunServices.layer),
      Effect.ensuring(
        Effect.promise(() => rm(path, { force: true })).pipe(Effect.orDie)
      )
    )

    return test
  })
})
