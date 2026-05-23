/**
 * Write tool — create or overwrite files through the sandbox.
 *
 * The simplest tool in the fleet: takes a path and content, writes the file.
 * Parent directory creation is a sandbox concern — the tool just calls
 * `files.writeFile()` and formats the result for the LLM.
 *
 * Distinct from Edit: this is for creating new files or wholesale
 * replacement. Edit is for surgical changes to existing files using
 * hashline anchors. The two serve different purposes and models should
 * reach for the right one.
 */
import { Tool } from 'effect/unstable/ai'
import { Effect, Schema } from 'effect'
import { CurrentFiles, SandboxError } from '../sandbox/sandbox.ts'
import {
  recordFileDiffPresentation,
  ToolOutputRegistry,
} from './tool-output.ts'

// ---------------------------------------------------------------------------
// Write — tool declaration
// ---------------------------------------------------------------------------

export const Write = Tool.make('Write', {
  description:
    'Create or overwrite a file. Parent directories are created automatically. Use this to create new files — for editing existing files, prefer Edit instead.',
  parameters: Schema.Struct({
    path: Schema.String.annotate({
      description:
        'Path to the file (relative to sandbox root). Parent directories are created if needed.',
    }),
    content: Schema.String.annotate({
      description: 'The full content to write to the file.',
    }),
  }),
  success: Schema.String,
  failure: SandboxError,
  failureMode: 'return',
  dependencies: [CurrentFiles],
})

// ---------------------------------------------------------------------------
// Write — handler
// ---------------------------------------------------------------------------

export const WriteHandler = {
  Write: ({
    path,
    content,
  }: {
    readonly path: string
    readonly content: string
  }) =>
    Effect.gen(function* () {
      const files = yield* CurrentFiles
      const toolOutputRegistry = yield* ToolOutputRegistry
      const oldContent = yield* files
        .readFile(path)
        .pipe(Effect.catch(() => Effect.succeed('')))
      yield* Effect.logInfo('Write tool writing file', {
        path,
        bytes: Buffer.byteLength(content, 'utf8'),
        lines: content.split('\n').length,
      })
      yield* files.writeFile(path, content)

      const bytes = Buffer.byteLength(content, 'utf8')
      const lines = content.split('\n').length
      yield* Effect.logInfo('Write tool wrote file', { path, bytes, lines })
      const result = `Wrote ${path} (${lines} lines, ${bytes} bytes)`
      recordFileDiffPresentation(toolOutputRegistry, {
        toolName: 'Write',
        path,
        oldContent,
        newContent: content,
        result,
      })
      return result
    }).pipe(
      Effect.annotateLogs({
        package: 'core',
        subsystem: 'tool',
        tool: 'Write',
      }),
      Effect.withLogSpan('tool.Write')
    ),
}
