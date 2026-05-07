import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { Context, Effect, Layer, Option, Schema } from 'effect'

const RuntimeConfigFileSchema = Schema.Struct({
  default_model: Schema.optional(Schema.String),
  title_model: Schema.optional(Schema.String),
  log_level: Schema.optional(Schema.String),
})

export type RuntimeConfigFile = typeof RuntimeConfigFileSchema.Type

export interface RuntimeConfig {
  readonly default_model: string | null
  readonly title_model: string | null
}

export interface RuntimeConfigApi {
  // biome-ignore lint/plugin/no-manual-effect-channels: service contracts expose typed method effects
  readonly get: (dir: string) => Effect.Effect<RuntimeConfig>
}

export class RuntimeConfigService extends Context.Service<
  RuntimeConfigService,
  RuntimeConfigApi
>()('@sorato/RuntimeConfig') {}

export class RuntimeConfigError extends Schema.TaggedErrorClass<RuntimeConfigError>()(
  'RuntimeConfigError',
  {
    message: Schema.String,
  }
) {}

const configRoot = () =>
  join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'sorato')

const globalConfigFiles = () => [
  join(configRoot(), 'config.json'),
  join(configRoot(), 'config.jsonc'),
]

const projectConfigFiles = (dir: string) => [
  join(dir, '.sorato', 'config.json'),
  join(dir, '.sorato', 'config.jsonc'),
]

const normalizeConfig = (cfg: RuntimeConfigFile): RuntimeConfig => ({
  default_model: cfg.default_model ?? null,
  title_model: cfg.title_model ?? null,
})

const mergeConfig = (
  base: RuntimeConfig,
  override: RuntimeConfigFile
): RuntimeConfig => ({
  default_model: override.default_model ?? base.default_model,
  title_model: override.title_model ?? base.title_model,
})

const charAt = (text: string, index: number) => text[index] ?? ''

const stripComments = (text: string) => {
  let out = ''
  let mode: 'code' | 'string' | 'line' | 'block' = 'code'

  for (let i = 0; i < text.length; i++) {
    const cur = charAt(text, i)
    const next = charAt(text, i + 1)

    switch (mode) {
      case 'string': {
        out += cur
        const escaped = Number(cur === '\\' && next !== '')
        out += next.repeat(escaped)
        i += escaped
        if (escaped === 1) continue
        mode = ['string', 'code'][Number(cur === '"')] as 'string' | 'code'
        continue
      }
      case 'line': {
        const isNewline = Number(cur === '\n')
        out += cur.repeat(isNewline)
        mode = ['line', 'code'][isNewline] as 'line' | 'code'
        continue
      }
      case 'block': {
        const isBlockEnd = Number(cur === '*' && next === '/')
        i += isBlockEnd
        mode = ['block', 'code'][isBlockEnd] as 'block' | 'code'
        continue
      }
      case 'code': {
        const isQuote = Number(cur === '"')
        out += cur.repeat(isQuote)
        mode = ['code', 'string'][isQuote] as 'code' | 'string'
        if (isQuote === 1) continue

        const lineCommentStart = Number(cur === '/' && next === '/')
        i += lineCommentStart
        mode = ['code', 'line'][lineCommentStart] as 'code' | 'line'
        if (lineCommentStart === 1) continue

        const blockCommentStart = Number(cur === '/' && next === '*')
        i += blockCommentStart
        mode = ['code', 'block'][blockCommentStart] as 'code' | 'block'
        if (blockCommentStart === 1) continue

        out += cur
      }
    }
  }

  return out
}

const stripTrailing = (text: string) => {
  let out = ''
  let mode: 'code' | 'string' = 'code'

  for (let i = 0; i < text.length; i++) {
    const cur = charAt(text, i)

    switch (mode) {
      case 'string': {
        out += cur
        const escaped = Number(cur === '\\' && i + 1 < text.length)
        out += charAt(text, i + 1).repeat(escaped)
        i += escaped
        if (escaped === 1) continue
        mode = ['string', 'code'][Number(cur === '"')] as 'string' | 'code'
        continue
      }
      case 'code': {
        const isQuote = Number(cur === '"')
        out += cur.repeat(isQuote)
        mode = ['code', 'string'][isQuote] as 'code' | 'string'
        if (isQuote === 1) continue

        const isComma = Number(cur === ',')
        let j = i + isComma
        while (j < text.length && isComma === 1 && /\s/.test(charAt(text, j))) {
          j += 1
        }
        const next = charAt(text, j)
        const shouldSkipTrailingComma = Number(
          isComma === 1 && (next === '}' || next === ']')
        )

        out += cur.repeat(1 - shouldSkipTrailingComma)
      }
    }
  }

  return out
}

const parse = Effect.fn('RuntimeConfig.parse')(function* (
  text: string,
  file: string
) {
  return yield* Effect.try({
    try: () =>
      Schema.decodeUnknownSync(RuntimeConfigFileSchema)(
        JSON.parse(stripTrailing(stripComments(text)))
      ),
    catch: () =>
      new RuntimeConfigError({
        message: `Failed to parse config: ${file}`,
      }),
  })
})

const isFileNotFoundError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === 'ENOENT'

const readFailure = (file: string) =>
  new RuntimeConfigError({
    message: `Failed to read config: ${file}`,
  })

const missingConfigError = new RuntimeConfigError({ message: '' })

const handleLoadFileError = (file: string, error: unknown) =>
  [readFailure(file), missingConfigError][Number(isFileNotFoundError(error))] ??
  readFailure(file)

const recoverLoadFileError = (error: RuntimeConfigError) =>
  [Effect.fail(error), Effect.succeed(Option.none<string>())][
    Number(error.message === '')
  ] ?? Effect.fail(error)

const loadFile = Effect.fn('RuntimeConfig.loadFile')(function* (file: string) {
  const text = yield* Effect.tryPromise({
    try: () => readFile(file, 'utf8'),
    catch: (error): RuntimeConfigError => handleLoadFileError(file, error),
  }).pipe(
    Effect.map(Option.some),
    Effect.catchTag('RuntimeConfigError', recoverLoadFileError)
  )

  return yield* Option.match(text, {
    onNone: () => Effect.succeed({} satisfies RuntimeConfigFile),
    onSome: (contents) => parse(contents, file),
  })
})

const loadFiles = Effect.fn('RuntimeConfig.loadFiles')(function* (
  files: ReadonlyArray<string>
) {
  let cfg: RuntimeConfigFile = {}

  for (const file of files) {
    cfg = { ...cfg, ...(yield* loadFile(file)) }
  }

  return cfg
})

export const loadGlobalRuntimeConfigFile = Effect.fn(
  'RuntimeConfig.loadGlobalFile'
)(function* () {
  return yield* loadFiles(globalConfigFiles())
})

export const RuntimeConfigLive = Layer.effect(
  RuntimeConfigService,
  Effect.gen(function* () {
    const globalConfig = normalizeConfig(yield* loadGlobalRuntimeConfigFile())
    yield* Effect.logDebug('Loaded global runtime config', {
      hasDefaultModel: globalConfig.default_model !== null,
      hasTitleModel: globalConfig.title_model !== null,
    })
    const projectConfigs = new Map<string, RuntimeConfig>()

    const loadProjectConfig = Effect.fn('RuntimeConfig.loadProject')(function* (
      dir: string
    ) {
      const cached = projectConfigs.get(dir)
      if (cached) return cached

      const config = yield* loadFiles(projectConfigFiles(dir)).pipe(
        Effect.map((projectConfig) => mergeConfig(globalConfig, projectConfig)),
        Effect.catchCause((cause) =>
          // biome-ignore lint/plugin: fallback logs the project config failure before returning global config
          Effect.logError('Failed to load project runtime config', {
              dir,
              cause,
          }).pipe(Effect.map(() => globalConfig))
        )
      )
      yield* Effect.logDebug('Loaded project runtime config', {
        dir,
        hasDefaultModel: config.default_model !== null,
        hasTitleModel: config.title_model !== null,
      })
      projectConfigs.set(dir, config)
      return config
    })

    return {
      get: loadProjectConfig,
    } satisfies RuntimeConfigApi
  })
)
