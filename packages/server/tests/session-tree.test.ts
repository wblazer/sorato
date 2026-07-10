import { describe, expect, it } from '@effect/vitest'
import { groupedAgentRunBase } from '../../web/src/lib/components/session/grouped-agent-run-base.ts'

type TreeMessage = Parameters<typeof groupedAgentRunBase>[0][number]

const message = (
  id: string,
  parentId: string | null,
  runId: string | null,
  role: TreeMessage['encoded']['role']
): TreeMessage => ({ id, parentId, runId, encoded: { role } })

describe('groupedAgentRunBase', () => {
  it('keeps a selected run visible when compaction rebases it onto a hidden agent step', () => {
    const messages = [
      message('summary', null, 'summary-run', 'user'),
      message('cloned-assistant', 'summary', 'previous-agent', 'assistant'),
    ]

    expect(
      groupedAgentRunBase(
        messages,
        'current-agent',
        'cloned-assistant',
        new Set(['current-agent', 'previous-agent'])
      )
    ).toBe('summary')
  })

  it('attaches a grouped run after its latest visible prompt', () => {
    const messages = [
      message('summary', null, 'summary-run', 'user'),
      message('cloned-assistant', 'summary', 'previous-agent', 'assistant'),
      message('current-user', 'cloned-assistant', 'current-agent', 'user'),
      message(
        'current-assistant',
        'current-user',
        'current-agent',
        'assistant'
      ),
    ]

    expect(
      groupedAgentRunBase(
        messages,
        'current-agent',
        'cloned-assistant',
        new Set(['current-agent', 'previous-agent'])
      )
    ).toBe('current-user')
  })
})
