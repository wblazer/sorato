import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  ClientConfigSchema,
  defaultClientConfig,
  diffClientConfig,
  encodeClientConfig,
  mergeClientConfig,
  mirrorResolvedClientConfig,
  resolveClientConfig,
  shouldExpandToolBlock,
} from './client-config.ts'

describe('client config', () => {
  it('validates the canonical snake_case shape', () => {
    expect(
      Schema.decodeUnknownSync(ClientConfigSchema)({
        transcript_display_mode: 'raw',
        tool_block_expansion: { tools: { Bash: null } },
      })
    ).toEqual({
      transcript_display_mode: 'raw',
      tool_block_expansion: { tools: { Bash: null } },
    })
    expect(
      Schema.decodeUnknownSync(ClientConfigSchema)({
        transcriptDisplayMode: 'raw',
      })
    ).toEqual({})
    expect(() =>
      Schema.decodeUnknownSync(ClientConfigSchema)({
        transcript_display_mode: 'invalid',
      })
    ).toThrow()
  })
  it('merges defaults, file, and overrides in precedence order', () => {
    const result = resolveClientConfig(
      {
        transcript_display_mode: 'raw',
        tool_block_expansion: { tools: { Bash: true } },
      },
      {
        transcript_display_mode: 'pretty',
        tool_block_expansion: { tools: { Edit: null, Bash: false } },
      }
    )
    expect(result.resolved.transcript_display_mode).toBe('pretty')
    expect(result.resolved.tool_block_expansion.tools).toEqual({
      Write: true,
      Bash: false,
    })
  })
  it('migrates the deprecated default unless the new default is explicit', () => {
    expect(
      mergeClientConfig(defaultClientConfig(), {
        expand_tool_blocks_by_default: true,
      }).tool_block_expansion.default
    ).toBe(true)
    expect(
      mergeClientConfig(defaultClientConfig(), {
        expand_tool_blocks_by_default: true,
        tool_block_expansion: { default: false },
      }).tool_block_expansion.default
    ).toBe(false)
  })
  it('produces a minimal reversible diff including deletions', () => {
    const base = defaultClientConfig()
    const value = mergeClientConfig(base, {
      transcript_display_mode: 'raw',
      tool_block_expansion: {
        default: true,
        tools: { Edit: null, Bash: false },
      },
    })
    const diff = diffClientConfig(base, value)
    expect(diff).toEqual({
      tool_block_expansion: {
        default: true,
        tools: { Edit: null, Bash: false },
      },
      transcript_display_mode: 'raw',
    })
    expect(mergeClientConfig(base, diff)).toEqual(value)
    expect(diffClientConfig(base, base)).toEqual({})
  })
  it('selects per-tool expansion, mirrors resolved settings, and pretty prints with newline', () => {
    const resolved = defaultClientConfig()
    expect(shouldExpandToolBlock(resolved.tool_block_expansion, 'Edit')).toBe(
      true
    )
    expect(shouldExpandToolBlock(resolved.tool_block_expansion, 'Other')).toBe(
      false
    )
    expect(mirrorResolvedClientConfig(resolved)).toEqual({
      transcriptDisplayMode: 'pretty',
      toolBlockExpansion: resolved.tool_block_expansion,
      expandSystemMessagesByDefault: false,
    })
    expect(encodeClientConfig({ transcript_display_mode: 'raw' })).toBe(
      '{\n  "transcript_display_mode": "raw"\n}\n'
    )
  })
})
