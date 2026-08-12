import { describe, expect, it } from 'vitest'
import { AgentTools, AllTools } from '../src/agent-config.ts'

describe('agent tool configuration', () => {
  it('keeps explicit compaction available internally but hidden from the agent', () => {
    const agentToolNames = Object.keys(AgentTools.tools)

    expect(agentToolNames).toContain('update_plan')
    expect(agentToolNames).toContain('recall_summary')
    expect(agentToolNames).not.toContain('CompactConversation')
    expect(Object.keys(AllTools.tools)).toContain('CompactConversation')
  })
})
