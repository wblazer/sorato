import { Effect, Layer } from 'effect'
import {
  Bash,
  BashHandler,
  Edit,
  EditHandler,
  Glob,
  GlobHandler,
  Grep,
  GrepHandler,
  LocalSandboxLive,
  Read,
  ReadHandler,
  Toolkit,
  Write,
  WriteHandler,
  type Files,
} from '@sorato/core'

export const SYSTEM_PROMPT = `You are a helpful coding agent. You have access to tools for reading, editing, writing, and searching files, as well as running shell commands. Use them as needed to help the user.

Guidelines:
- Be concise and direct.
- Prefer built-in file and search tools over shell commands when they fit the task.
- Never revert, overwrite, or discard user changes unless explicitly asked.
- Never run destructive git commands unless explicitly asked.`

export const AGENTS_MD_PATH = 'AGENTS.md'

export const loadAgentsMd = Effect.fn('loadAgentsMd')(function* (files: Files) {
  const agents = yield* files
    .readFile(AGENTS_MD_PATH)
    .pipe(Effect.catch(() => Effect.succeed(undefined)))

  if (agents === undefined || agents.trim() === '') {
    return undefined
  }

  return `Project-specific instructions and guidelines:

<project_instructions path="${AGENTS_MD_PATH}">
${agents}
</project_instructions>`
})

export const AllToolInfos = [
  { name: 'Read', displayName: 'Read file' },
  { name: 'Edit', displayName: 'Edit file' },
  { name: 'Write', displayName: 'Write file' },
  { name: 'Bash', displayName: 'Run command' },
  { name: 'Glob', displayName: 'Find files' },
  { name: 'Grep', displayName: 'Search files' },
] as const

export const AllTools = Toolkit.make(Read, Edit, Write, Bash, Glob, Grep)

export const AllToolsLayer = AllTools.toLayer({
  ...ReadHandler,
  ...EditHandler,
  ...WriteHandler,
  ...BashHandler,
  ...GlobHandler,
  ...GrepHandler,
})

export const AgentLive = Layer.mergeAll(AllToolsLayer, LocalSandboxLive)
