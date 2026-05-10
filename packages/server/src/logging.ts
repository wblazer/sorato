import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  Effect,
  FileSystem,
  Layer,
  Logger,
  type LogLevel,
  Match,
  Option,
  References,
  Schema,
} from 'effect'
import { loadGlobalRuntimeConfigFile } from './runtime-config.ts'

const defaultLogFileName = 'server.jsonl'
const defaultLogLevel: LogLevel.LogLevel = 'Info'

export const logLevelChoices = [
  ['all', 'All'],
  ['fatal', 'Fatal'],
  ['error', 'Error'],
  ['warn', 'Warn'],
  ['info', 'Info'],
  ['debug', 'Debug'],
  ['trace', 'Trace'],
  ['off', 'None'],
] as const satisfies ReadonlyArray<readonly [string, LogLevel.LogLevel]>

const logLevelsByName = new Map<string, LogLevel.LogLevel>([
  ...logLevelChoices,
  ['warning', 'Warn'],
  ['none', 'None'],
])

export class LoggingConfigError extends Schema.TaggedErrorClass<LoggingConfigError>()(
  'LoggingConfigError',
  {
    message: Schema.String,
  }
) {}

const parseLogLevel = (
  source: string,
  value: string
): LogLevel.LogLevel | LoggingConfigError => {
  const level = logLevelsByName.get(value.toLowerCase())
  return Match.value(level).pipe(
    Match.when(
      undefined,
      () =>
        new LoggingConfigError({
          message: `Invalid ${source} log level: ${value}`,
        })
    ),
    Match.orElse((level) => level)
  )
}

const parsedLogLevelEffect = (source: string, value: string) =>
  Match.value(parseLogLevel(source, value)).pipe(
    Match.when(
      (result): result is LoggingConfigError =>
        result instanceof LoggingConfigError,
      (error) => Effect.fail(error)
    ),
    Match.orElse((level: LogLevel.LogLevel) => Effect.succeed(level))
  )

const configLogLevelEffect = Effect.gen(function* () {
  const config = yield* loadGlobalRuntimeConfigFile()
  return yield* Option.fromNullishOr(config.log_level).pipe(
    Option.match({
      onNone: () => Effect.succeed(defaultLogLevel),
      onSome: (value) => parsedLogLevelEffect('config', value),
    })
  )
})

const envLogLevelEffect = Option.fromNullishOr(
  process.env.SORATO_LOG_LEVEL
).pipe(
  Option.match({
    onNone: () => configLogLevelEffect,
    onSome: (value) => parsedLogLevelEffect('SORATO_LOG_LEVEL', value),
  })
)

export const resolveLogLevel = (cliLogLevel: string | undefined) =>
  Option.fromNullishOr(cliLogLevel).pipe(
    Option.match({
      onNone: () => envLogLevelEffect,
      onSome: (level) => parsedLogLevelEffect('CLI', level),
    })
  )

const defaultLogDir = () =>
  join(
    process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'),
    'sorato',
    'logs'
  )

export const resolveLogDir = () => process.env.SORATO_LOG_DIR ?? defaultLogDir()

export const resolveLogFile = () => join(resolveLogDir(), defaultLogFileName)

export const LoggingLive = (level: LogLevel.LogLevel) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const logFile = resolveLogFile()
      yield* fs.makeDirectory(dirname(logFile), { recursive: true })
      const fileLogger = yield* Logger.formatJson.pipe(
        Logger.toFile(logFile, { flag: 'a' })
      )

      return Layer.mergeAll(
        Layer.succeed(References.MinimumLogLevel, level),
        Logger.layer([Logger.defaultLogger, fileLogger])
      )
    })
  )
