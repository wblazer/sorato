import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { Effect, Schema } from 'effect'

const RuntimeConfigSchema = Schema.Struct({
  default_model: Schema.optional(Schema.String),
})

export type RuntimeConfig = typeof RuntimeConfigSchema.Type

export class RuntimeConfigError extends Schema.TaggedErrorClass<RuntimeConfigError>()(
  'RuntimeConfigError',
  {
    message: Schema.String,
  }
) {}

const configRoot = () =>
  join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'agents')

const configFiles = (dir: string) => [
  join(configRoot(), 'config.json'),
  join(configRoot(), 'config.jsonc'),
  join(dir, '.agents', 'config.json'),
  join(dir, '.agents', 'config.jsonc'),
]

const stripComments = (text: string) => {
  let out = ''
  let mode: 'code' | 'string' | 'line' | 'block' = 'code'

  for (let i = 0; i < text.length; i++) {
    const cur = text[i]!
    const next = text[i + 1]

    if (mode === 'string') {
      out += cur
      if (cur === '\\' && next) {
        out += next
        i += 1
        continue
      }
      if (cur === '"') mode = 'code'
      continue
    }

    if (mode === 'line') {
      if (cur === '\n') {
        out += cur
        mode = 'code'
      }
      continue
    }

    if (mode === 'block') {
      if (cur === '*' && next === '/') {
        i += 1
        mode = 'code'
      }
      continue
    }

    if (cur === '"') {
      out += cur
      mode = 'string'
      continue
    }

    if (cur === '/' && next === '/') {
      i += 1
      mode = 'line'
      continue
    }

    if (cur === '/' && next === '*') {
      i += 1
      mode = 'block'
      continue
    }

    out += cur
  }

  return out
}

const stripTrailing = (text: string) => {
  let out = ''
  let mode: 'code' | 'string' = 'code'

  for (let i = 0; i < text.length; i++) {
    const cur = text[i]!

    if (mode === 'string') {
      out += cur
      if (cur === '\\' && text[i + 1]) {
        out += text[i + 1]!
        i += 1
        continue
      }
      if (cur === '"') mode = 'code'
      continue
    }

    if (cur === '"') {
      out += cur
      mode = 'string'
      continue
    }

    if (cur === ',') {
      let j = i + 1
      while (j < text.length && /\s/.test(text[j]!)) j += 1
      const next = text[j]
      if (next === '}' || next === ']') continue
    }

    out += cur
  }

  return out
}

const parse = Effect.fn('RuntimeConfig.parse')(function* (
  text: string,
  file: string
) {
  return yield* Effect.try({
    try: () =>
      Schema.decodeUnknownSync(RuntimeConfigSchema)(
        JSON.parse(stripTrailing(stripComments(text)))
      ),
    catch: () =>
      new RuntimeConfigError({
        message: `Failed to parse config: ${file}`,
      }),
  })
})

const loadFile = Effect.fn('RuntimeConfig.loadFile')(function* (file: string) {
  const text = yield* Effect.tryPromise({
    try: () => readFile(file, 'utf8'),
    catch: (error) => {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return new RuntimeConfigError({ message: '' })
      }

      return new RuntimeConfigError({
        message: `Failed to read config: ${file}`,
      })
    },
  }).pipe(
    Effect.catchTag('RuntimeConfigError', (error) => {
      if (error.message === '') return Effect.void
      return Effect.fail(error)
    })
  )

  if (text === undefined) return {} satisfies RuntimeConfig
  return yield* parse(text, file)
})

export const loadRuntimeConfig = Effect.fn('RuntimeConfig.load')(function* (
  dir: string
) {
  let cfg: RuntimeConfig = {}

  for (const file of configFiles(dir)) {
    cfg = { ...cfg, ...(yield* loadFile(file)) }
  }

  return cfg
})
