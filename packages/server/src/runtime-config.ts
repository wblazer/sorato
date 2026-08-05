import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { Context, Effect, Layer, Option, Schema } from 'effect'

const RoleConfigFileSchema = Schema.Struct({
  model: Schema.optional(Schema.String),
  instructions: Schema.optional(Schema.String),
})

const RuntimeConfigFileSchema = Schema.Struct({
  default_model: Schema.optional(Schema.String),
  environment_command: Schema.optional(Schema.String),
  instructions: Schema.optional(Schema.String),
  roles: Schema.optional(
    Schema.Struct({
      summary: Schema.optional(RoleConfigFileSchema),
      title: Schema.optional(RoleConfigFileSchema),
    })
  ),
  log_level: Schema.optional(Schema.String),
})

export type RuntimeConfigFile = typeof RuntimeConfigFileSchema.Type

export interface RuntimeConfig {
  readonly default_model: string | null
  readonly environment_command: string | null
  readonly instructions: ReadonlyArray<string>
  readonly roles: {
    readonly summary: RuntimeRoleConfig
    readonly title: RuntimeRoleConfig
  }
}

export interface RuntimeRoleConfig {
  readonly model: string | null
  readonly instructions: ReadonlyArray<string>
}

export interface RuntimeConfigApi {
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

const configuredInstructions = (instructions: string | undefined) =>
  instructions === undefined || instructions.trim().length === 0
    ? []
    : [instructions]

const normalizeRole = (
  role: typeof RoleConfigFileSchema.Type | undefined
): RuntimeRoleConfig => ({
  model: role?.model ?? null,
  instructions: configuredInstructions(role?.instructions),
})

const normalizeConfig = (cfg: RuntimeConfigFile): RuntimeConfig => ({
  default_model: cfg.default_model ?? null,
  environment_command: cfg.environment_command ?? null,
  instructions: configuredInstructions(cfg.instructions),
  roles: {
    summary: normalizeRole(cfg.roles?.summary),
    title: normalizeRole(cfg.roles?.title),
  },
})

const mergeRole = (
  base: RuntimeRoleConfig,
  override: typeof RoleConfigFileSchema.Type | undefined
): RuntimeRoleConfig => ({
  model: override?.model ?? base.model,
  instructions: [
    ...base.instructions,
    ...configuredInstructions(override?.instructions),
  ],
})

const mergeConfig = (
  base: RuntimeConfig,
  override: RuntimeConfigFile
): RuntimeConfig => ({
  default_model: override.default_model ?? base.default_model,
  environment_command: override.environment_command ?? base.environment_command,
  instructions: [
    ...base.instructions,
    ...configuredInstructions(override.instructions),
  ],
  roles: {
    summary: mergeRole(base.roles.summary, override.roles?.summary),
    title: mergeRole(base.roles.title, override.roles?.title),
  },
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
    const override: RuntimeConfigFile = yield* loadFile(file)
    cfg = {
      ...cfg,
      ...override,
      ...(cfg.roles === undefined && override.roles === undefined
        ? {}
        : {
            roles: {
              summary: {
                ...cfg.roles?.summary,
                ...override.roles?.summary,
              },
              title: {
                ...cfg.roles?.title,
                ...override.roles?.title,
              },
            },
          }),
    }
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
      hasTitleModel: globalConfig.roles.title.model !== null,
      hasSummaryModel: globalConfig.roles.summary.model !== null,
    })

    const loadProjectConfig = Effect.fn('RuntimeConfig.loadProject')(function* (
      dir: string
    ) {
      const config = yield* loadFiles(projectConfigFiles(dir)).pipe(
        Effect.map((projectConfig) => mergeConfig(globalConfig, projectConfig)),
        Effect.catchCause((cause) =>
          Effect.logError('Failed to load project runtime config', {
            dir,
            cause,
          }).pipe(Effect.map(() => globalConfig))
        )
      )
      yield* Effect.logDebug('Loaded project runtime config', {
        dir,
        hasDefaultModel: config.default_model !== null,
        hasTitleModel: config.roles.title.model !== null,
        hasSummaryModel: config.roles.summary.model !== null,
      })
      return config
    })

    return {
      get: loadProjectConfig,
    } satisfies RuntimeConfigApi
  })
)
