/**
 * Run environment acquisition.
 *
 * A project may define an environment command. At the start of each agent run we
 * execute it from the project root, parse the printed environment, and inject the
 * resulting key/value snapshot into Bash tool calls for that run.
 */
import { Effect, Schema } from 'effect'
import type { Shell } from '@sorato/core'
import { SandboxError } from '@sorato/core'

const ENV_COMMAND_TIMEOUT_MS = 30_000

const JsonEnvironment = Schema.Record(
  Schema.String,
  Schema.NullOr(Schema.String)
)

export class RunEnvironmentError extends Schema.TaggedErrorClass<RunEnvironmentError>()(
  'RunEnvironmentError',
  {
    operation: Schema.String,
    message: Schema.String,
    error: Schema.optional(Schema.Defect),
  }
) {}

export interface ParsedEnvironment {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly format: 'empty' | 'json' | 'env-null' | 'env-lines'
}

export interface RunEnvironment {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly source: 'none' | 'command'
  readonly format?: ParsedEnvironment['format'] | undefined
}

const parseEnvEntries = (
  entries: Iterable<string>,
  format: ParsedEnvironment['format']
): ParsedEnvironment => {
  const env: Record<string, string | undefined> = {}

  for (const entry of entries) {
    if (entry.length === 0) continue
    const separator = entry.indexOf('=')
    if (separator <= 0) continue
    const key = entry.slice(0, separator)
    if (key.length === 0 || key.includes('\0')) continue
    env[key] = entry.slice(separator + 1)
  }

  return { env, format }
}

export const parseEnvironmentOutput = Effect.fn('parseEnvironmentOutput')(
  function* (output: string) {
    const trimmedStart = output.trimStart()

    if (output.trim().length === 0) {
      return { env: {}, format: 'empty' as const } satisfies ParsedEnvironment
    }

    if (trimmedStart.startsWith('{')) {
      const json = yield* Effect.try({
        try: () => JSON.parse(trimmedStart),
        catch: (error) =>
          new RunEnvironmentError({
            operation: 'parseEnvironmentOutput',
            message:
              'Environment command output looked like JSON, but could not be parsed.',
            error,
          }),
      })

      const decoded = yield* Schema.decodeUnknownEffect(JsonEnvironment)(
        json
      ).pipe(
        Effect.mapError(
          (error) =>
            new RunEnvironmentError({
              operation: 'parseEnvironmentOutput',
              message:
                'Environment command output looked like JSON, but could not be parsed as an object of string or null environment variables.',
              error,
            })
        )
      )
      const env: Record<string, string | undefined> = {}
      for (const [key, value] of Object.entries(decoded)) {
        env[key] = value ?? undefined
      }

      return { env, format: 'json' as const } satisfies ParsedEnvironment
    }

    if (output.includes('\0')) {
      return parseEnvEntries(output.split('\0'), 'env-null')
    }

    return parseEnvEntries(output.split(/\r?\n/), 'env-lines')
  }
)

export const resolveRunEnvironment = Effect.fn('resolveRunEnvironment')(
  function* (
    shell: Shell,
    projectPath: string,
    command: string | null | undefined
  ) {
    const trimmed = command?.trim()
    if (!trimmed) {
      return { env: {}, source: 'none' } satisfies RunEnvironment
    }

    yield* Effect.logInfo('Resolving run environment', {
      projectPath,
      commandLength: trimmed.length,
    })

    const result = yield* shell
      .exec({
        command: trimmed,
        timeout: ENV_COMMAND_TIMEOUT_MS,
      })
      .pipe(
        Effect.mapError(
          (error) =>
            new RunEnvironmentError({
              operation: 'resolveRunEnvironment',
              message: `Failed to run environment command: ${error.message}`,
              error,
            })
        )
      )

    if (result.timedOut) {
      return yield* Effect.fail(
        new RunEnvironmentError({
          operation: 'resolveRunEnvironment',
          message: `Environment command timed out after ${ENV_COMMAND_TIMEOUT_MS}ms.`,
        })
      )
    }

    if (result.exitCode !== 0) {
      const detail = [result.stdout, result.stderr]
        .filter((part) => part.trim().length > 0)
        .join('\n')
        .trim()
      return yield* Effect.fail(
        new RunEnvironmentError({
          operation: 'resolveRunEnvironment',
          message: `Environment command exited with code ${result.exitCode}${
            detail.length > 0 ? `: ${detail}` : ''
          }`,
        })
      )
    }

    const parsed = yield* parseEnvironmentOutput(result.stdout)

    if (Object.keys(parsed.env).length === 0) {
      yield* Effect.logWarning('Environment command did not print changes', {
        projectPath,
        format: parsed.format,
        hint: 'For direnv, this usually means the server process already has that directory loaded. Use `direnv exec . env -0` to print a full environment snapshot.',
      })
    }

    yield* Effect.logInfo('Resolved run environment', {
      projectPath,
      format: parsed.format,
      variableCount: Object.keys(parsed.env).length,
    })

    return {
      env: parsed.env,
      source: 'command',
      format: parsed.format,
    } satisfies RunEnvironment
  }
)

export const withRunEnvironment = (
  shell: Shell,
  environment: RunEnvironment
): Shell => ({
  exec: (input) =>
    shell.exec({
      ...input,
      env: {
        ...environment.env,
        ...input.env,
      },
    }),
})

export const runEnvironmentErrorToSandboxError = (error: RunEnvironmentError) =>
  new SandboxError({
    operation: error.operation,
    message: error.message,
    error,
  })
