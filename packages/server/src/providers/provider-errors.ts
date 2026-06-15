import { Duration, Effect, Option, Schema } from 'effect'
import { AiError, type Response } from 'effect/unstable/ai'
import { type HttpClientResponse } from 'effect/unstable/http'

type ProviderId = 'anthropic' | 'openai'

type ProviderErrorFacts = {
  readonly provider: ProviderId
  readonly status?: number | undefined
  readonly code?: string | undefined
  readonly type?: string | undefined
  readonly requestId?: string | undefined
  readonly message: string
  readonly retryable: boolean
  readonly retryAfter?: Duration.Duration | undefined
  readonly body?: unknown
}

export type ProviderRetryInfo = {
  readonly error: AiError.AiError
  readonly delay: Duration.Duration
  readonly attempt: number
  readonly maxAttempts: number
}

const OpenAiErrorResponse = Schema.Struct({
  error: Schema.Struct({
    message: Schema.String,
    type: Schema.optional(Schema.NullOr(Schema.String)),
    code: Schema.optional(Schema.NullOr(Schema.String)),
    param: Schema.optional(Schema.NullOr(Schema.String)),
  }),
})

const AnthropicErrorResponse = Schema.Struct({
  type: Schema.optional(Schema.String),
  error: Schema.Struct({
    type: Schema.optional(Schema.String),
    message: Schema.String,
  }),
})

const decodeOpenAiError = Schema.decodeUnknownOption(OpenAiErrorResponse)
const decodeAnthropicError = Schema.decodeUnknownOption(AnthropicErrorResponse)

const nonEmpty = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : undefined
}

const requestId = (
  provider: ProviderId,
  headers: Readonly<Record<string, string | undefined>>
): string | undefined =>
  provider === 'openai'
    ? (headers['x-request-id'] ?? headers['openai-request-id'])
    : headers['request-id']

const parseRetryAfter = (
  value: string | undefined
): Duration.Duration | undefined => {
  const trimmed = nonEmpty(value)
  if (trimmed === undefined) return undefined

  const seconds = Number(trimmed)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Duration.seconds(Math.min(seconds, 60 * 60))
  }

  const date = Date.parse(trimmed)
  if (!Number.isFinite(date)) return undefined

  const millis = date - Date.now()
  return Duration.millis(Math.min(Math.max(millis, 0), 60 * 60 * 1000))
}

const bodyMessage = (body: unknown): string | undefined => {
  if (typeof body === 'string') return nonEmpty(body)
  if (typeof body !== 'object' || body === null) return undefined

  const record = body as Record<string, unknown>
  const message = record.message
  if (typeof message === 'string') return nonEmpty(message)
  const error = record.error
  if (typeof error === 'string') return nonEmpty(error)
  if (typeof error === 'object' && error !== null) {
    const nested = (error as Record<string, unknown>).message
    if (typeof nested === 'string') return nonEmpty(nested)
  }
  return undefined
}

const isRateLimit = (facts: ProviderErrorFacts): boolean =>
  facts.status === 429 ||
  facts.type === 'rate_limit_error' ||
  facts.type === 'rate_limit_exceeded' ||
  facts.code === 'rate_limit_exceeded'

const isQuota = (facts: ProviderErrorFacts): boolean =>
  facts.type === 'insufficient_quota' || facts.code === 'insufficient_quota'

const definedEntries = (
  fields: Readonly<Record<string, string | number | boolean | undefined>>
): Record<string, string | number | boolean> =>
  Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined)
  ) as Record<string, string | number | boolean>

// AiError metadata is validated as JSON, which forbids `undefined` values.
// Omitting absent fields keeps the value a valid JSON object so constructing
// the typed error never throws a schema defect.
const providerMetadata = (facts: ProviderErrorFacts) => ({
  [facts.provider]: definedEntries({
    status: facts.status,
    code: facts.code,
    type: facts.type,
    requestId: facts.requestId,
    retryable: facts.retryable,
  }),
})

const requestDetails = (
  response: HttpClientResponse.HttpClientResponse
): typeof Response.HttpRequestDetails.Type => ({
  method: response.request
    .method as (typeof Response.HttpRequestDetails.Type)['method'],
  url: response.request.url,
  urlParams: Array.from(response.request.urlParams),
  hash: Option.getOrUndefined(response.request.hash),
  headers: { ...response.request.headers },
})

const httpContext = (
  response: HttpClientResponse.HttpClientResponse,
  body: string | undefined
) => ({
  request: requestDetails(response),
  response: {
    status: response.status,
    headers: { ...response.headers },
  },
  ...(body !== undefined ? { body } : {}),
})

const responseBody = (response: HttpClientResponse.HttpClientResponse) =>
  response.text.pipe(
    Effect.flatMap((text) =>
      Effect.try({
        try: () => (text.length === 0 ? null : JSON.parse(text)),
        catch: () => text,
      })
    ),
    Effect.catch(() => Effect.succeed(null))
  )

const responseBodyText = (body: unknown): string | undefined =>
  typeof body === 'string' ? body : JSON.stringify(body)

const matchError = (
  provider: ProviderId,
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string | undefined>>
): ProviderErrorFacts => {
  if (provider === 'openai') {
    const parsed = Option.getOrUndefined(decodeOpenAiError(body))
    if (parsed !== undefined) {
      return {
        provider,
        status,
        code: parsed.error.code ?? undefined,
        type: parsed.error.type ?? undefined,
        requestId: requestId(provider, headers),
        message: parsed.error.message,
        retryable: status === 429 || status >= 500,
        retryAfter: parseRetryAfter(headers['retry-after']),
        body,
      }
    }
  } else {
    const parsed = Option.getOrUndefined(decodeAnthropicError(body))
    if (parsed !== undefined) {
      return {
        provider,
        status,
        type: parsed.error.type,
        requestId: requestId(provider, headers),
        message: parsed.error.message,
        retryable: status === 429 || status >= 500,
        retryAfter: parseRetryAfter(headers['retry-after']),
        body,
      }
    }
  }

  return {
    provider,
    status,
    requestId: requestId(provider, headers),
    message: bodyMessage(body) ?? `${provider} returned HTTP ${status}`,
    retryable: status === 429 || status >= 500,
    retryAfter: parseRetryAfter(headers['retry-after']),
    body,
  }
}

const toReason = (
  facts: ProviderErrorFacts,
  context?: ReturnType<typeof httpContext>
): AiError.AiErrorReason => {
  const common = {
    metadata: providerMetadata(facts),
    ...(context !== undefined ? { http: context } : {}),
  }

  if (isRateLimit(facts)) {
    return new AiError.RateLimitError({
      retryAfter: facts.retryAfter,
      ...common,
    })
  }
  if (isQuota(facts)) {
    return new AiError.QuotaExhaustedError(common)
  }
  if (facts.status === 401 || facts.status === 403) {
    return new AiError.AuthenticationError({
      kind:
        facts.status === 401
          ? 'InvalidKey'
          : facts.status === 403
            ? 'InsufficientPermissions'
            : 'Unknown',
      ...common,
    })
  }
  if (facts.status !== undefined && facts.status >= 400 && facts.status < 500) {
    return new AiError.InvalidRequestError({
      description: facts.message,
      ...common,
    })
  }
  return new AiError.InternalProviderError({
    description: facts.message,
    ...common,
  })
}

export const ensureOk =
  (provider: ProviderId, module: string, method: string) =>
  (response: HttpClientResponse.HttpClientResponse) =>
    response.status >= 200 && response.status < 300
      ? Effect.succeed(response)
      : responseBody(response).pipe(
          Effect.flatMap((body) =>
            Effect.fail(
              AiError.make({
                module,
                method,
                reason: toReason(
                  matchError(provider, response.status, body, response.headers),
                  httpContext(response, responseBodyText(body))
                ),
              })
            )
          )
        )

export const toProviderAiError =
  (module: string, method: string) =>
  (cause: unknown): AiError.AiError => {
    if (AiError.isAiError(cause)) return cause
    return AiError.make({
      module,
      method,
      reason: new AiError.InternalProviderError({
        description: describeCause(cause),
      }),
    })
  }

// oxlint-disable sorato/no-manual-effect-channels -- retry preserves the wrapped provider effect contract
export const retryProviderRequest = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  onRetry: ((info: ProviderRetryInfo) => void) | undefined
): Effect.Effect<A, E, R> => {
  const maxAttempts = 3
  // oxlint-disable-next-line sorato/no-manual-effect-channels -- recursive retry loop preserves the wrapped provider effect contract
  const run = (attempt: number): Effect.Effect<A, E, R> =>
    effect.pipe(
      Effect.catch((error) => {
        if (
          !AiError.isAiError(error) ||
          !error.isRetryable ||
          attempt >= maxAttempts
        ) {
          return Effect.fail(error)
        }

        const delay = error.retryAfter ?? Duration.seconds(2 ** (attempt - 1))
        const publishRetry = Effect.sync(() =>
          onRetry?.({ error, delay, attempt, maxAttempts })
        )
        const wait = Effect.sleep(delay)
        return publishRetry.pipe(
          Effect.andThen(wait),
          Effect.andThen(run(attempt + 1))
        )
      })
    )

  return run(1)
}
// oxlint-enable sorato/no-manual-effect-channels

const describeCause = (cause: unknown): string => {
  if (AiError.isAiError(cause)) return cause.message
  if (cause instanceof Error) return nonEmpty(cause.message) ?? cause.name

  if (typeof cause === 'object' && cause !== null) {
    const record = cause as Record<string, unknown>
    const message = record.message
    if (typeof message === 'string') {
      const value = nonEmpty(message)
      if (value !== undefined) return value
    }
    if ('cause' in record) return describeCause(record.cause)
    const tag = record._tag
    if (typeof tag === 'string') return tag
  }

  const message = String(cause).trim()
  return message.length > 0 ? message : 'Unknown provider error'
}
