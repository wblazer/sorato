import { Context, Effect, Layer, Schema } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import { Tool } from 'effect/unstable/ai'
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
  WebFetch,
  WebFetchHandler,
  type Files,
} from '@sorato/core'

export const SYSTEM_PROMPT = `You are a helpful coding agent. You have access to tools for reading, editing, writing, and searching files, as well as running shell commands. Use them as needed to help the user.

Guidelines:
- Be concise and direct.
- Prefer built-in file and search tools over shell commands when they fit the task.
- Never revert, overwrite, or discard user changes unless explicitly asked.
- Never run destructive git commands unless explicitly asked.`

export const AGENTS_MD_PATH = 'AGENTS.md'

const CompactNodeBoundary = Schema.Struct({
  type: Schema.Literal('node'),
  nodeId: Schema.String.annotate({
    description:
      'Exact node_id from a previous ambiguity/error response. Use this only when retrying with a candidate node_id.',
  }),
  include: Schema.Boolean.annotate({
    description:
      'Whether this boundary node is included in the compacted range.',
  }),
})

const CompactMessageBoundary = Schema.Struct({
  type: Schema.Literal('message'),
  role: Schema.Literals(['user', 'assistant', 'summary', 'any']).annotate({
    description:
      'Which message role/kind to search. Use any only when the role is genuinely unclear.',
  }),
  match: Schema.String.annotate({
    description:
      'Distinctive text snippet from the boundary message. This is a case-insensitive substring match, not a regex.',
  }),
  include: Schema.Boolean.annotate({
    description:
      'Whether this boundary message is included in the compacted range.',
  }),
})

const CompactToolBoundary = Schema.Struct({
  type: Schema.Literal('tool'),
  role: Schema.Literals(['tool_call', 'tool_result']).annotate({
    description: 'Whether to search tool-call nodes or tool-result nodes.',
  }),
  toolName: Schema.String.annotate({
    description:
      'Tool name as shown in the transcript, such as Read, Bash, Grep, or CompactConversation.',
  }),
  match: Schema.String.annotate({
    description:
      'Distinctive text snippet from the tool call params/id or tool result text/id. This is a case-insensitive substring match, not a regex.',
  }),
  include: Schema.Boolean.annotate({
    description: 'Whether this boundary tool node is included in the range.',
  }),
})

const CompactBoundary = Schema.Union([
  CompactNodeBoundary,
  CompactMessageBoundary,
  CompactToolBoundary,
])
export type CompactBoundary = typeof CompactBoundary.Type

export interface CompactConversationInput {
  readonly start: CompactBoundary
  readonly end: CompactBoundary
  readonly instructions?: string | undefined
}

export class CurrentCompaction extends Context.Service<
  CurrentCompaction,
  {
    readonly compactRange: (
      input: CompactConversationInput
    ) => Effect.Effect<string, string>
  }
>()('@sorato/CurrentCompaction') {}

export const CompactConversation = Tool.make('CompactConversation', {
  description:
    'Compact a contiguous range of the current conversation branch into a summary for future continuation. Use this after a long stretch of useful work when the raw transcript can be replaced by a durable summary. Boundaries are selected by structured selectors. The range is inclusive or exclusive per boundary: start.include=false preserves the matched start node and starts compacting after it; end.include=false preserves the matched end node and stops before it. For normal “compact the work I did for this request”, select the user request as start with include=false, and the final relevant assistant/tool node as end with include=true. Select a user message with type=message role=user, assistant prose with role=assistant, summaries with role=summary, and ordinary tool calls/results with type=tool plus toolName. Do not pass instructions for normal compaction; the summarizer already knows to preserve goals, decisions, file changes, tool results, unresolved tasks, and exact continuation facts. Pass instructions only when there is unusual context the summarizer could not infer or a special emphasis is required.',
  parameters: Schema.Struct({
    start: CompactBoundary.annotate({
      description:
        'Boundary selector for the start of the range. The matched node is included only when include=true.',
    }),
    end: CompactBoundary.annotate({
      description:
        'Boundary selector for the end of the range. The matched node is included only when include=true.',
    }),
    instructions: Schema.optionalKey(Schema.String).annotate({
      description:
        'Optional. Leave unset for normal compaction. Use only for special requirements or extra context the summarizer cannot infer from the selected range.',
    }),
  }),
  success: Schema.String,
  failure: Schema.String,
  failureMode: 'return',
  dependencies: [CurrentCompaction],
})

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
  { name: 'WebFetch', displayName: 'Fetch web page' },
  { name: 'CompactConversation', displayName: 'Compact conversation' },
] as const

export const AllTools = Toolkit.make(
  Read,
  Edit,
  Write,
  Bash,
  Glob,
  Grep,
  WebFetch,
  CompactConversation
)

export const AllToolsLayer = AllTools.toLayer({
  ...ReadHandler,
  ...EditHandler,
  ...WriteHandler,
  ...BashHandler,
  ...GlobHandler,
  ...GrepHandler,
  ...WebFetchHandler,
  CompactConversation: (input: CompactConversationInput) =>
    Effect.gen(function* () {
      const compaction = yield* CurrentCompaction
      return yield* compaction.compactRange(input)
    }).pipe(
      Effect.annotateLogs({
        package: 'server',
        subsystem: 'tool',
        tool: 'CompactConversation',
      }),
      Effect.withLogSpan('tool.CompactConversation')
    ),
})

export const AgentLive = Layer.mergeAll(
  AllToolsLayer,
  LocalSandboxLive,
  FetchHttpClient.layer
)
