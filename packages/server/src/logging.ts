import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  Effect,
  FileSystem,
  Layer,
  Logger,
  LogLevel,
  References,
  Schema,
} from 'effect'
import { loadGlobalRuntimeConfigFile } from './runtime-config.ts'

const defaultLogFileName = 'server.jsonl'

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

const parseLogLevel = (source: string, value: string) =>
  Effect.gen(function* () {
    const level = logLevelsByName.get(value.toLowerCase())
    if (level) return level

    return yield* new LoggingConfigError({
      message: `Invalid ${source} log level: ${value}`,
    })
  })

export const resolveLogLevel = (cliLogLevel: LogLevel.LogLevel | undefined) =>
  Effect.gen(function* () {
    if (cliLogLevel) return cliLogLevel

    const envLogLevel = process.env.SORATO_LOG_LEVEL
    if (envLogLevel !== undefined) {
      return yield* parseLogLevel('SORATO_LOG_LEVEL', envLogLevel)
    }

    const config = yield* loadGlobalRuntimeConfigFile()
    if (config.log_level !== undefined) {
      return yield* parseLogLevel('config', config.log_level)
    }

    return 'Info' satisfies LogLevel.LogLevel
  })

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
