import { homedir } from 'node:os'
import { tmpdir } from 'node:os'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Effect, Fiber } from 'effect'
import { describe, expect, it } from '@effect/vitest'
import {
  formatSkillsForPrompt,
  LocalSandboxLive,
  makeCurrentSkills,
  parseSkill,
  Sandbox,
  type Skill,
} from '@sorato/core'
import { resolveGlobPattern } from '@sorato/core/tool'
import { skillDirectories } from '../src/agent-config.ts'
import { configRoot } from '../src/runtime-config.ts'
import { makeRunScenario } from './support/run-scenario.ts'
import { TEST_PROJECT_ID } from './support/run-scenario.ts'
import { Scripted } from './support/scripted-model.ts'

const validSkill = `---
name: code-review
description: Reviews code for correctness. Use when reviewing a change.
license: MIT
compatibility: Requires git
metadata:
  author: example
  version: "1.0"
allowed-tools: Read Grep Bash(git:*)
---
# Code review

Read the diff before reviewing it.
`

describe('Agent Skills', () => {
  it('parses every standardized frontmatter field', () => {
    const result = parseSkill('.agents/skills/code-review/SKILL.md', validSkill)

    expect(result.diagnostics).toEqual([])
    expect(result.skills).toEqual([
      {
        name: 'code-review',
        description:
          'Reviews code for correctness. Use when reviewing a change.',
        location: '.agents/skills/code-review/SKILL.md',
        content: validSkill,
        license: 'MIT',
        compatibility: 'Requires git',
        metadata: { author: 'example', version: '1.0' },
        allowedTools: 'Read Grep Bash(git:*)',
      },
    ])
  })

  it('preserves arbitrary string metadata keys', () => {
    const result = parseSkill(
      '.agents/skills/code-review/SKILL.md',
      '---\nname: code-review\ndescription: Reviews code.\nmetadata:\n  __proto__: value\n---\nInstructions'
    )

    expect(result.diagnostics).toEqual([])
    expect(Object.hasOwn(result.skills[0]?.metadata ?? {}, '__proto__')).toBe(
      true
    )
    expect(result.skills[0]?.metadata?.['__proto__']).toBe('value')
  })

  it.each([
    ['missing frontmatter', '# Instructions'],
    [
      'missing name',
      '---\ndescription: Use this for reviews.\n---\nInstructions',
    ],
    ['missing description', '---\nname: code-review\n---\nInstructions'],
    [
      'invalid name characters',
      '---\nname: Code_Review\ndescription: Use this for reviews.\n---\nInstructions',
    ],
    [
      'consecutive hyphens',
      '---\nname: code--review\ndescription: Use this for reviews.\n---\nInstructions',
    ],
    [
      'directory mismatch',
      '---\nname: other\ndescription: Use this for reviews.\n---\nInstructions',
    ],
    [
      'non-string metadata values',
      '---\nname: code-review\ndescription: Use this for reviews.\nmetadata:\n  version: 1\n---\nInstructions',
    ],
    [
      'non-string metadata keys',
      '---\nname: code-review\ndescription: Use this for reviews.\nmetadata:\n  1: version\n---\nInstructions',
    ],
    [
      'non-string allowed-tools',
      '---\nname: code-review\ndescription: Use this for reviews.\nallowed-tools:\n  - Read\n---\nInstructions',
    ],
    [
      'unknown top-level fields',
      '---\nname: code-review\ndescription: Use this for reviews.\ncustom: value\n---\nInstructions',
    ],
    [
      'normalized names that are not exact',
      '---\nname: " code-review "\ndescription: Use this for reviews.\n---\nInstructions',
    ],
  ])('rejects %s', (_label, content) => {
    const result = parseSkill('.agents/skills/code-review/SKILL.md', content)
    expect(result.skills).toEqual([])
    expect(result.diagnostics.length).toBeGreaterThan(0)
  })

  it('enforces specification length limits', () => {
    const longName = 'a'.repeat(65)
    const longDescription = 'd'.repeat(1025)
    const longCompatibility = 'c'.repeat(501)
    const result = parseSkill(
      `.agents/skills/${longName}/SKILL.md`,
      `---\nname: ${longName}\ndescription: ${longDescription}\ncompatibility: ${longCompatibility}\n---\nInstructions`
    )

    expect(result.skills).toEqual([])
    expect(result.diagnostics.map((item) => item.message)).toEqual(
      expect.arrayContaining([
        'name must be between 1 and 64 characters',
        'description must be between 1 and 1024 characters',
        'compatibility must be between 1 and 500 characters',
      ])
    )
  })

  it('skips YAML that exceeds safe alias expansion limits', () => {
    const aliases = Array.from({ length: 101 }, () => '*value').join(', ')
    const result = parseSkill(
      '.agents/skills/code-review/SKILL.md',
      `---\nname: code-review\ndescription: Use this for reviews.\nvalue: &value [x]\nexpanded: [${aliases}]\n---\nInstructions`
    )

    expect(result.skills).toEqual([])
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        message: 'SKILL.md frontmatter is invalid YAML',
      }),
    ])
  })

  it('counts Unicode code points for specification length limits', () => {
    const description = '😀'.repeat(600)
    const result = parseSkill(
      '.agents/skills/code-review/SKILL.md',
      `---\nname: code-review\ndescription: "${description}"\n---\nInstructions`
    )

    expect(result.diagnostics).toEqual([])
    expect(result.skills[0]?.description).toBe(description)
  })

  it('rejects Unicode names outside the specification ASCII ranges', () => {
    const result = parseSkill(
      '.agents/skills/ревью/SKILL.md',
      '---\nname: ревью\ndescription: Проверяет изменения.\n---\nИнструкции'
    )

    expect(result.skills).toEqual([])
    expect(result.diagnostics).toHaveLength(1)
  })

  it('uses interoperable and Sorato-native global and project roots', () => {
    expect(skillDirectories(TEST_PROJECT_ID)).toEqual([
      { directory: join(homedir(), '.agents', 'skills') },
      { directory: join(configRoot(), 'skills') },
      { directory: join(TEST_PROJECT_ID, '.agents', 'skills') },
      { directory: join(TEST_PROJECT_ID, '.sorato', 'skills') },
    ])
  })

  it('deduplicates overlapping roots in favor of project access', () => {
    expect(skillDirectories(homedir())).toEqual([
      { directory: join(configRoot(), 'skills') },
      { directory: join(homedir(), '.agents', 'skills') },
      { directory: join(homedir(), '.sorato', 'skills') },
    ])
  })

  it('formats an escaped progressive-disclosure catalog', () => {
    const skill: Skill = {
      name: 'code-review',
      description: 'Use for <reviews> & "audits".',
      location: '.agents/skills/code-review/SKILL.md',
      content: validSkill,
    }

    expect(formatSkillsForPrompt([])).toBeUndefined()
    expect(formatSkillsForPrompt([skill])).toContain(
      '<description>Use for &lt;reviews&gt; &amp; &quot;audits&quot;.</description>'
    )
  })

  it('lets absolute glob patterns override an optional base path', () => {
    expect(resolveGlobPattern('/tmp/*.md', '/repo')).toBe('/tmp/*.md')
    expect(resolveGlobPattern('*.md', '/repo')).toBe('/repo/*.md')
  })

  it.effect(
    'reaches named hidden parents without matching hidden children',
    () =>
      Effect.gen(function* () {
        const root = yield* Effect.acquireRelease(
          Effect.tryPromise(() => mkdtemp(join(tmpdir(), 'sorato-glob-'))),
          (directory) =>
            Effect.tryPromise(() =>
              rm(directory, { recursive: true, force: true })
            ).pipe(Effect.orDie)
        )
        yield* Effect.tryPromise(() =>
          mkdir(join(root, '.config', '.hidden'), { recursive: true })
        )
        yield* Effect.tryPromise(() =>
          writeFile(join(root, '.config', 'visible.txt'), 'visible')
        )
        yield* Effect.tryPromise(() =>
          writeFile(join(root, '.config', '.hidden', 'secret.txt'), 'secret')
        )

        const sandbox = yield* Sandbox
        const session = yield* sandbox.acquire(root)
        const direct = yield* session.files.glob(`${root}/.config/*`)
        const recursive = yield* session.files.glob(`${root}/.config/**/*.txt`)

        expect(direct).toEqual([join(root, '.config', 'visible.txt')])
        expect(recursive).toEqual([join(root, '.config', 'visible.txt')])
      }).pipe(Effect.scoped, Effect.provide(LocalSandboxLive))
  )

  it.effect('loads the same skill repeatedly without session state', () =>
    Effect.gen(function* () {
      const parsed = parseSkill(
        '.agents/skills/code-review/SKILL.md',
        validSkill
      )
      const skills = makeCurrentSkills(parsed.skills)

      const first = yield* skills.load('code-review')
      const second = yield* skills.load('code-review')

      expect(second).toBe(first)
      expect(second).toContain(validSkill)
    })
  )

  it.effect('discovers and loads a skill through the running harness', () =>
    Effect.gen(function* () {
      const scenario = yield* makeRunScenario({
        files: {
          [join(homedir(), '.agents', 'skills', 'code-review', 'SKILL.md')]:
            '---\nname: code-review\ndescription: Global review instructions.\n---\n# Global review',
          '.agents/skills/SKILL.md':
            '---\nname: skills\ndescription: Invalid root skill.\n---\nIgnore this.',
          '.agents/skills/code-review/SKILL.md': validSkill,
          '.agents/skills/code-review/LICENSE.txt': 'MIT',
          '.agents/skills/code-review/nested/SKILL.md':
            '---\nname: nested\ndescription: Must not be discovered beneath a skill root.\n---\nIgnore this.',
          '.agents/skills/code-review/references/checklist.md':
            '# Review checklist',
          '.agents/skills/.hidden/secret/SKILL.md':
            '---\nname: secret\ndescription: Hidden skill.\n---\nIgnore this.',
          '.agents/skills/node_modules/dependency/SKILL.md':
            '---\nname: dependency\ndescription: Dependency skill.\n---\nIgnore this.',
          '.agents/skills/.git/hooks/SKILL.md':
            '---\nname: hooks\ndescription: Git internals skill.\n---\nIgnore this.',
        },
        model: [
          [
            Scripted.toolCall('load-skill', 'LoadSkill', {
              name: 'code-review',
            }),
            Scripted.finish('tool-calls'),
          ],
          [Scripted.text('Skill loaded.'), Scripted.finish()],
        ],
      })

      const run = yield* scenario.startRun({ input: 'Review this change' })
      if (run.fiber) yield* Fiber.join(run.fiber)

      const prompts = yield* scenario.model.prompts
      expect(prompts).toHaveLength(2)
      expect(JSON.stringify(prompts[0])).toContain('<available_skills>')
      expect(JSON.stringify(prompts[0])).toContain('code-review')
      expect(JSON.stringify(prompts[0])).not.toContain('Invalid root skill')
      expect(JSON.stringify(prompts[0])).not.toContain(
        'Global review instructions'
      )
      expect(JSON.stringify(prompts[0])).not.toContain(
        'Must not be discovered beneath a skill root'
      )
      expect(JSON.stringify(prompts[0])).not.toContain('Hidden skill')
      expect(JSON.stringify(prompts[0])).not.toContain('Dependency skill')
      expect(JSON.stringify(prompts[0])).not.toContain('Git internals skill')
      expect(JSON.stringify(prompts[1])).toContain(
        '<skill_content name=\\"code-review\\">'
      )
      expect(JSON.stringify(prompts[1])).toContain('# Code review')
      expect(JSON.stringify(prompts[1])).toContain(
        '.agents/skills/code-review/LICENSE.txt'
      )
      expect(JSON.stringify(prompts[1])).toContain(
        '.agents/skills/code-review/references/checklist.md'
      )

      const messages = yield* scenario.messagesForRun(run.runId)
      expect(messages.map((message) => message.encoded.role)).toEqual([
        'user',
        'assistant',
        'tool',
        'assistant',
      ])
    }).pipe(Effect.scoped)
  )

  it.effect('loads global Sorato skills and mounts their resources', () =>
    Effect.gen(function* () {
      const directory = join(configRoot(), 'skills', 'global-review')
      const skillPath = join(directory, 'SKILL.md')
      const reference = join(directory, 'references', 'guide.md')
      const scenario = yield* makeRunScenario({
        files: {
          [skillPath]:
            '---\nname: global-review\ndescription: Global review workflow.\n---\n# Global workflow\n\nRead references/guide.md.\n',
          [reference]: '# Global details\n\nCheck every boundary.',
        },
        model: [
          [
            Scripted.toolCall('load-global', 'LoadSkill', {
              name: 'global-review',
            }),
            Scripted.finish('tool-calls'),
          ],
          [
            Scripted.toolCall('write-global-skill', 'Write', {
              path: skillPath,
              content:
                '---\nname: global-review\ndescription: Global review workflow.\n---\n# Updated global workflow\n',
            }),
            Scripted.finish('tool-calls'),
          ],
          [
            Scripted.toolCall('reload-global', 'LoadSkill', {
              name: 'global-review',
            }),
            Scripted.finish('tool-calls'),
          ],
          [
            Scripted.toolCall('write-global-reference', 'Write', {
              path: reference,
              content: '# Updated global details',
            }),
            Scripted.finish('tool-calls'),
          ],
          [
            Scripted.toolCall('read-global-reference', 'Read', {
              path: reference,
            }),
            Scripted.finish('tool-calls'),
          ],
          [Scripted.text('Global skill used.'), Scripted.finish()],
        ],
      })

      const run = yield* scenario.startRun({
        input: 'Use the global workflow',
      })
      if (run.fiber) yield* Fiber.join(run.fiber)

      const prompts = yield* scenario.model.prompts
      expect(JSON.stringify(prompts[0])).toContain('Global review workflow')
      expect(JSON.stringify(prompts[1])).toContain('# Global workflow')
      expect(JSON.stringify(prompts[1])).toContain(reference)
      expect(JSON.stringify(prompts[3])).toContain('# Updated global workflow')
      expect(JSON.stringify(prompts[5])).toContain('Updated global details')
    }).pipe(Effect.scoped)
  )

  it.effect('allows file tools to use absolute paths outside the project', () =>
    Effect.gen(function* () {
      const outsidePath = join(homedir(), '.config', 'sorato-test-output.txt')
      const scenario = yield* makeRunScenario({
        files: {},
        model: [
          [
            Scripted.toolCall('write-outside-project', 'Write', {
              path: outsidePath,
              content: 'outside project',
            }),
            Scripted.finish('tool-calls'),
          ],
          [
            Scripted.toolCall('read-outside-project', 'Read', {
              path: outsidePath,
            }),
            Scripted.finish('tool-calls'),
          ],
          [Scripted.text('Done.'), Scripted.finish()],
        ],
      })

      const run = yield* scenario.startRun({
        input: 'Write outside the project',
      })
      if (run.fiber) yield* Fiber.join(run.fiber)

      const prompts = yield* scenario.model.prompts
      expect(JSON.stringify(prompts[1])).toContain(`Wrote ${outsidePath}`)
      expect(JSON.stringify(prompts[2])).toContain('outside project')
    }).pipe(Effect.scoped)
  )
})
