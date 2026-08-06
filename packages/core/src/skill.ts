import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path'
import { Context, Effect, Schema } from 'effect'
import { Tool } from 'effect/unstable/ai'
import { parseDocument } from 'yaml'
import { SandboxError, type Files } from './sandbox/sandbox.ts'

const MAX_RESOURCE_FILES = 10
const MAX_NAME_LENGTH = 64
const MAX_DESCRIPTION_LENGTH = 1024
const MAX_COMPATIBILITY_LENGTH = 500
const MAX_WALK_DEPTH = 6
const MAX_VISITED_ENTRIES = 10_000
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules'])
const FRONTMATTER_FIELDS = new Set([
  'name',
  'description',
  'license',
  'compatibility',
  'metadata',
  'allowed-tools',
])

const FrontmatterRecord = Schema.Record(Schema.String, Schema.Unknown)
const MetadataRecord = Schema.Record(Schema.String, Schema.String)

export interface SkillSource {
  readonly directory: string
  readonly files: Files
}

export interface Skill {
  readonly name: string
  readonly description: string
  readonly location: string
  readonly content: string
  readonly license?: string | undefined
  readonly compatibility?: string | undefined
  readonly metadata?: Readonly<Record<string, string>> | undefined
  readonly allowedTools?: string | undefined
  readonly source?: SkillSource | undefined
  readonly sourceLocation?: string | undefined
}

export interface SkillDiagnostic {
  readonly path: string
  readonly message: string
}

export interface SkillDiscovery {
  readonly skills: ReadonlyArray<Skill>
  readonly diagnostics: ReadonlyArray<SkillDiagnostic>
}

const extractFrontmatter = (content: string) => {
  const match =
    /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(content)
  if (match === null || match[1] === undefined) return undefined
  return match[1]
}

const optionalString = (
  frontmatter: Readonly<Record<string, unknown>>,
  key: string,
  diagnostics: Array<SkillDiagnostic>,
  path: string
) => {
  const value = frontmatter[key]
  if (value === undefined) return undefined
  if (typeof value === 'string') return value
  diagnostics.push({ path, message: `${key} must be a string` })
  return null
}

export const parseSkill = (path: string, content: string): SkillDiscovery => {
  const diagnostics: Array<SkillDiagnostic> = []
  const source = extractFrontmatter(content)
  if (source === undefined) {
    return {
      skills: [],
      diagnostics: [
        { path, message: 'SKILL.md must start with YAML frontmatter' },
      ],
    }
  }

  let parsed: unknown
  try {
    const document = parseDocument(source)
    if (document.errors.length > 0) throw new Error('Invalid YAML')
    parsed = document.toJS({ mapAsMap: true, maxAliasCount: 100 })
  } catch {
    return {
      skills: [],
      diagnostics: [{ path, message: 'SKILL.md frontmatter is invalid YAML' }],
    }
  }

  if (!(parsed instanceof Map)) {
    return {
      skills: [],
      diagnostics: [
        { path, message: 'SKILL.md frontmatter must be a mapping' },
      ],
    }
  }

  const normalizedEntries: Array<readonly [string, unknown]> = []
  const unexpected: Array<string> = []
  for (const [key, value] of parsed) {
    if (typeof key !== 'string') {
      return {
        skills: [],
        diagnostics: [
          { path, message: 'SKILL.md frontmatter keys must be strings' },
        ],
      }
    }
    normalizedEntries.push([key, value])
    if (!FRONTMATTER_FIELDS.has(key)) unexpected.push(key)
  }
  if (unexpected.length > 0)
    diagnostics.push({
      path,
      message: `unexpected frontmatter fields: ${unexpected.toSorted().join(', ')}`,
    })

  const decoded = Schema.decodeUnknownOption(FrontmatterRecord)(
    Object.fromEntries(normalizedEntries)
  ).valueOrUndefined
  if (decoded === undefined) {
    return {
      skills: [],
      diagnostics: [
        { path, message: 'SKILL.md frontmatter must be a mapping' },
      ],
    }
  }

  const rawName = optionalString(decoded, 'name', diagnostics, path)
  const description = optionalString(decoded, 'description', diagnostics, path)
  const license = optionalString(decoded, 'license', diagnostics, path)
  const compatibility = optionalString(
    decoded,
    'compatibility',
    diagnostics,
    path
  )
  const allowedTools = optionalString(
    decoded,
    'allowed-tools',
    diagnostics,
    path
  )

  if (rawName === undefined)
    diagnostics.push({ path, message: 'name is required' })
  if (description === undefined)
    diagnostics.push({ path, message: 'description is required' })

  const name = rawName
  if (typeof name === 'string') {
    const nameLength = name.length
    if (nameLength === 0 || nameLength > MAX_NAME_LENGTH)
      diagnostics.push({
        path,
        message: `name must be between 1 and ${MAX_NAME_LENGTH} characters`,
      })
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))
      diagnostics.push({
        path,
        message:
          'name must contain only lowercase ASCII letters, numbers, and single hyphens',
      })
    if (name !== basename(dirname(path)))
      diagnostics.push({
        path,
        message: 'name must match the parent directory name',
      })
  }

  if (
    typeof description === 'string' &&
    (description.trim().length === 0 ||
      Array.from(description).length > MAX_DESCRIPTION_LENGTH)
  )
    diagnostics.push({
      path,
      message: `description must be between 1 and ${MAX_DESCRIPTION_LENGTH} characters`,
    })

  if (
    typeof compatibility === 'string' &&
    (compatibility.trim().length === 0 ||
      Array.from(compatibility).length > MAX_COMPATIBILITY_LENGTH)
  )
    diagnostics.push({
      path,
      message: `compatibility must be between 1 and ${MAX_COMPATIBILITY_LENGTH} characters`,
    })

  const metadataValue = decoded.metadata
  let metadata: Readonly<Record<string, string>> | undefined
  if (metadataValue instanceof Map) {
    const metadataEntries: Array<readonly [string, string]> = []
    let validMetadata = true
    for (const [key, value] of metadataValue) {
      if (typeof key !== 'string' || typeof value !== 'string') {
        validMetadata = false
        continue
      }
      metadataEntries.push([key, value])
    }
    if (validMetadata)
      metadata = Schema.decodeUnknownOption(MetadataRecord)(
        Object.fromEntries(metadataEntries)
      ).valueOrUndefined
  }
  if (metadataValue !== undefined && metadata === undefined)
    diagnostics.push({
      path,
      message: 'metadata must map string keys to string values',
    })

  if (
    diagnostics.length > 0 ||
    typeof name !== 'string' ||
    typeof description !== 'string' ||
    license === null ||
    compatibility === null ||
    allowedTools === null
  )
    return { skills: [], diagnostics }

  return {
    skills: [
      {
        name,
        description,
        location: path,
        content,
        ...(license === undefined ? {} : { license }),
        ...(compatibility === undefined ? {} : { compatibility }),
        ...(metadata === undefined ? {} : { metadata }),
        ...(allowedTools === undefined ? {} : { allowedTools }),
      },
    ],
    diagnostics,
  }
}

const ignoredDirectory = (name: string) =>
  name.startsWith('.') || IGNORED_DIRECTORIES.has(name)

const walkLimitDiagnostic = (
  source: SkillSource,
  kind: 'depth' | 'entries'
) => ({
  path: source.directory,
  message:
    kind === 'depth'
      ? `skill discovery is limited to ${MAX_WALK_DEPTH} directory levels`
      : `skill discovery is limited to ${MAX_VISITED_ENTRIES} filesystem entries`,
})

const discoverSource = Effect.fn('Skills.discoverSource')(function* (
  source: SkillSource
) {
  const skills: Array<Skill> = []
  const diagnostics: Array<SkillDiagnostic> = []
  const queue: Array<{ readonly directory: string; readonly depth: number }> = [
    { directory: '.', depth: 0 },
  ]
  let visited = 0
  let reportedDepthLimit = false
  let reportedEntryLimit = false

  while (queue.length > 0 && visited < MAX_VISITED_ENTRIES) {
    const current = queue.shift()
    if (current === undefined) break
    const listing = yield* source.files
      .readDirectory(current.directory, MAX_VISITED_ENTRIES - visited)
      .pipe(
        Effect.catch((error) => {
          if (current.depth > 0)
            diagnostics.push({
              path: current.directory,
              message: error.message,
            })
          return Effect.succeed({ entries: [], truncated: false })
        })
      )
    visited += listing.entries.length
    if (listing.truncated) reportedEntryLimit = true
    const skillFile = listing.entries.find(
      (entry) => entry.name === 'SKILL.md' && entry.type === 'file'
    )
    if (current.depth === 0 && skillFile !== undefined)
      diagnostics.push({
        path: resolve(source.directory, 'SKILL.md'),
        message: 'SKILL.md must be inside a named skill directory',
      })
    const hasSkillFile = current.depth > 0 && skillFile !== undefined
    if (hasSkillFile) {
      const relativeLocation = join(current.directory, 'SKILL.md')
      const content = yield* source.files.readFile(relativeLocation).pipe(
        Effect.catch((error) => {
          diagnostics.push({
            path: resolve(source.directory, relativeLocation),
            message: error.message,
          })
          return Effect.succeed(undefined)
        })
      )
      if (content !== undefined) {
        const location = resolve(source.directory, relativeLocation)
        const parsed = parseSkill(location, content)
        diagnostics.push(...parsed.diagnostics)
        skills.push(
          ...parsed.skills.map((skill) => ({
            ...skill,
            source,
            sourceLocation: relativeLocation,
          }))
        )
      }
      continue
    }

    for (const entry of listing.entries) {
      if (entry.type !== 'directory' || ignoredDirectory(entry.name)) continue
      const child = join(current.directory, entry.name)
      if (current.depth >= MAX_WALK_DEPTH) {
        if (!reportedDepthLimit) {
          diagnostics.push(walkLimitDiagnostic(source, 'depth'))
          reportedDepthLimit = true
        }
        continue
      }
      queue.push({ directory: child, depth: current.depth + 1 })
    }
  }

  if (
    reportedEntryLimit ||
    (visited >= MAX_VISITED_ENTRIES && queue.length > 0)
  )
    diagnostics.push(walkLimitDiagnostic(source, 'entries'))
  return { skills, diagnostics } satisfies SkillDiscovery
})

export const discoverSkills = Effect.fn('Skills.discover')(function* (
  sources: ReadonlyArray<SkillSource>
) {
  const skills = new Map<string, Skill>()
  const diagnostics: Array<SkillDiagnostic> = []

  for (const source of sources) {
    const discovered = yield* discoverSource(source)
    diagnostics.push(...discovered.diagnostics)
    for (const skill of discovered.skills) {
      const previous = skills.get(skill.name)
      if (previous !== undefined)
        diagnostics.push({
          path: previous.location,
          message:
            previous.source === skill.source
              ? `duplicate skill name shadowed by a later discovery at ${skill.location}: ${skill.name}`
              : `duplicate skill name shadowed by higher-precedence skill at ${skill.location}: ${skill.name}`,
        })
      skills.set(skill.name, skill)
    }
  }

  for (const diagnostic of diagnostics)
    yield* Effect.logWarning('Skipped or shadowed Agent Skill', diagnostic)

  return {
    skills: [...skills.values()].toSorted((a, b) =>
      a.name.localeCompare(b.name)
    ),
    diagnostics,
  } satisfies SkillDiscovery
})

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

export const formatSkillsForPrompt = (skills: ReadonlyArray<Skill>) => {
  if (skills.length === 0) return undefined
  return [
    'Skills provide specialized instructions and workflows for specific tasks.',
    'Use the LoadSkill tool to load a skill when a task matches its description.',
    '<available_skills>',
    ...skills.flatMap((skill) => [
      '  <skill>',
      `    <name>${escapeXml(skill.name)}</name>`,
      `    <description>${escapeXml(skill.description)}</description>`,
      '  </skill>',
    ]),
    '</available_skills>',
  ].join('\n')
}

export interface CurrentSkillsApi {
  readonly load: (name: string) => Effect.Effect<string, SandboxError>
}

export class CurrentSkills extends Context.Service<
  CurrentSkills,
  CurrentSkillsApi
>()('@sorato/Skills') {}

const sampleResources = Effect.fn('Skills.sampleResources')(function* (
  skill: Skill
) {
  if (skill.source === undefined || skill.sourceLocation === undefined)
    return []
  const root = dirname(skill.sourceLocation)
  const queue: Array<{ readonly directory: string; readonly depth: number }> = [
    { directory: root, depth: 0 },
  ]
  const resources: Array<string> = []
  let visited = 0

  while (
    queue.length > 0 &&
    resources.length < MAX_RESOURCE_FILES &&
    visited < MAX_VISITED_ENTRIES
  ) {
    const current = queue.shift()
    if (current === undefined) break
    const listing = yield* skill.source.files
      .readDirectory(current.directory, MAX_VISITED_ENTRIES - visited)
      .pipe(
        Effect.catch(() => Effect.succeed({ entries: [], truncated: false }))
      )
    visited += listing.entries.length
    for (const entry of listing.entries) {
      if (resources.length >= MAX_RESOURCE_FILES) break
      if (entry.name === 'SKILL.md' || ignoredDirectory(entry.name)) continue
      const child = join(current.directory, entry.name)
      if (entry.type === 'file') {
        resources.push(resolve(skill.source.directory, child))
        continue
      }
      if (entry.type === 'directory' && current.depth < MAX_WALK_DEPTH)
        queue.push({ directory: child, depth: current.depth + 1 })
    }
  }
  return resources.toSorted()
})

export const makeCurrentSkills = (
  skills: ReadonlyArray<Skill>
): CurrentSkillsApi => {
  const byName = new Map(skills.map((skill) => [skill.name, skill]))
  return {
    load: Effect.fn('Skills.load')(function* (name: string) {
      const skill = byName.get(name)
      if (skill === undefined)
        return yield* Effect.fail(
          new SandboxError({
            operation: 'loadSkill',
            message: `Skill "${name}" not found. Available skills: ${
              skills.map((item) => item.name).join(', ') || 'none'
            }`,
          })
        )

      const content =
        skill.source === undefined || skill.sourceLocation === undefined
          ? skill.content
          : yield* skill.source.files.readFile(skill.sourceLocation)
      const resources = yield* sampleResources(skill)
      return [
        `<skill_content name="${escapeXml(skill.name)}">`,
        content,
        `Base directory for this skill: ${dirname(skill.location)}`,
        'Relative paths in this skill are relative to this base directory.',
        ...(resources.length === 0
          ? []
          : [
              '',
              '<skill_files>',
              ...resources.map((path) => `<file>${escapeXml(path)}</file>`),
              '</skill_files>',
            ]),
        '</skill_content>',
      ].join('\n')
    }),
  }
}

const mountedSource = (sources: ReadonlyArray<SkillSource>, target: string) => {
  if (!isAbsolute(target)) return undefined
  const absolute = resolve(target)
  let matched: SkillSource | undefined
  let matchedRootLength = -1
  for (const source of sources) {
    const root = resolve(source.directory)
    const fromSource = relative(root, absolute)
    const contains =
      fromSource === '' ||
      (!fromSource.startsWith(`..${sep}`) &&
        fromSource !== '..' &&
        !isAbsolute(fromSource))
    if (contains && root.length >= matchedRootLength) {
      matched = source
      matchedRootLength = root.length
    }
  }
  return matched
}

const sourceRelativePath = (source: SkillSource, target: string) =>
  relative(source.directory, resolve(target)) || '.'

export const mountSkillFiles = (
  primary: Files,
  sources: ReadonlyArray<SkillSource>
): Files => ({
  readFile: (path) => {
    const source = mountedSource(sources, path)
    return source === undefined
      ? primary.readFile(path)
      : source.files.readFile(sourceRelativePath(source, path))
  },
  writeFile: (path, content) => {
    const source = mountedSource(sources, path)
    if (source === undefined) return primary.writeFile(path, content)
    return source.files.writeFile(sourceRelativePath(source, path), content)
  },
  readDirectory: (path, limit) => {
    const source = mountedSource(sources, path)
    return source === undefined
      ? primary.readDirectory(path, limit)
      : source.files.readDirectory(sourceRelativePath(source, path), limit)
  },
  glob: (pattern) => {
    const source = mountedSource(sources, pattern)
    if (source === undefined) return primary.glob(pattern)
    return source.files
      .glob(sourceRelativePath(source, pattern))
      .pipe(
        Effect.map((matches) =>
          matches.map((match) => resolve(source.directory, match))
        )
      )
  },
})

export const LoadSkill = Tool.make('LoadSkill', {
  description:
    'Load a specialized skill when the task matches one of the skills listed in the system prompt. Returns the complete SKILL.md instructions and a sampled list of bundled resource files. Use resource files only as directed by the skill.',
  parameters: Schema.Struct({
    name: Schema.String.annotate({
      description: 'The exact name of a skill from the available skills list.',
    }),
  }),
  success: Schema.String,
  failure: SandboxError,
  failureMode: 'return',
  dependencies: [CurrentSkills],
})

export const LoadSkillHandler = {
  LoadSkill: ({ name }: { readonly name: string }) =>
    Effect.gen(function* () {
      const skills = yield* CurrentSkills
      return yield* skills.load(name)
    }).pipe(
      Effect.annotateLogs({
        package: 'core',
        subsystem: 'tool',
        tool: 'LoadSkill',
      }),
      Effect.withLogSpan('tool.LoadSkill')
    ),
}
