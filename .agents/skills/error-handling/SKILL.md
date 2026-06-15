---
name: error-handling
description: Use when designing, reviewing, or fixing Sorato error handling, upstream provider errors, user-facing error messages, logging, retries, or Effect error types.
---

# Error Handling

Use typed errors to preserve meaning at boundaries, and convert them into safe, actionable user messages only at product boundaries.

This doctrine is informed by Distilled's SDK error translation and Alchemy's infrastructure runtime boundaries. Distilled is the model for typed upstream API failures. Alchemy is the model for handling only recoverable domain tags and keeping full causes in logs.

## Core Rules

- Decode upstream failures at the provider boundary into typed errors.
- Preserve upstream facts: provider, status, code, type, request id, retry hints, and safe message.
- Keep parse failures, transport failures, auth/config failures, provider API failures, and defects distinct.
- Do not build logic from `error.message` string matching when a typed tag can exist.
- Do not show `Cause.pretty` to users. Log full causes server-side.
- User-facing messages should come from typed/domain errors, not stack traces.
- Catch only errors the caller can recover from. Otherwise let them propagate.
- Retry by typed category/tag, with bounded schedules. Never retry by vague message text.
- Unknown upstream errors are a signal to improve the boundary decoder, not to spread ad hoc handling through consumers.

## Error Shape

Prefer serializable `Schema.TaggedErrorClass` for anything crossing process, HTTP, SSE, or persistence boundaries.

```ts
import { Schema } from 'effect'

export class ProviderApiError extends Schema.TaggedErrorClass<ProviderApiError>()(
  'ProviderApiError',
  {
    provider: Schema.String,
    status: Schema.optional(Schema.Number),
    code: Schema.optional(Schema.String),
    type: Schema.optional(Schema.String),
    requestId: Schema.optional(Schema.String),
    message: Schema.String,
    retryable: Schema.Boolean,
  }
) {}

export class ProviderTransportError extends Schema.TaggedErrorClass<ProviderTransportError>()(
  'ProviderTransportError',
  {
    provider: Schema.String,
    message: Schema.String,
    retryable: Schema.Boolean,
  }
) {}

export class ProviderParseError extends Schema.TaggedErrorClass<ProviderParseError>()(
  'ProviderParseError',
  {
    provider: Schema.String,
    body: Schema.Unknown,
    cause: Schema.Defect,
  }
) {}
```

Use `Data.TaggedError` for local-only internal errors when serialization is not needed.

## Upstream Translation

Each provider should have one translation function that turns HTTP/provider failures into typed errors. Keep raw-body parsing there, not in callers.

```ts
const matchOpenAiError = (
  status: number,
  body: unknown,
  headers: Record<string, string | undefined>
) => {
  const requestId = headers['x-request-id'] ?? headers['openai-request-id']
  const parsed = decodeOpenAiError(body)

  if (parsed._tag === 'Some') {
    const error = parsed.value.error
    return new ProviderApiError({
      provider: 'openai',
      status,
      code: error.code,
      type: error.type,
      requestId,
      message: error.message,
      retryable: status === 429 || status >= 500,
    })
  }

  return new UnknownProviderError({
    provider: 'openai',
    status,
    requestId,
    body,
    message: `OpenAI returned HTTP ${status}`,
    retryable: status === 429 || status >= 500,
  })
}
```

Do not discard an upstream message just because the wrapper error has an empty `.message`. Walk structured fields first, then fall back to a stable tag/name.

```ts
const describeCause = (cause: unknown): string => {
  if (cause instanceof Error) return cause.message.trim() || cause.name

  if (typeof cause === 'object' && cause !== null) {
    if ('message' in cause && typeof cause.message === 'string') {
      const message = cause.message.trim()
      if (message.length > 0) return message
    }
    if ('_tag' in cause && typeof cause._tag === 'string') return cause._tag
    if ('cause' in cause) return describeCause(cause.cause)
  }

  const message = String(cause).trim()
  return message.length > 0 ? message : 'Unknown provider error'
}
```

## User-Facing Messages

Create product messages from typed errors at the server/SSE/HTTP boundary.

```ts
type UserErrorMessage = {
  readonly title: string
  readonly message: string
  readonly detail?: string
  readonly retryable: boolean
}

const userErrorMessage = (error: ProviderApiError): UserErrorMessage => ({
  title: `${error.provider} request failed`,
  message: error.message,
  detail: [error.code, error.requestId && `request ${error.requestId}`]
    .filter(Boolean)
    .join(' · '),
  retryable: error.retryable,
})
```

Avoid placeholders like this:

```ts
message: 'Agent run failed. Check the server logs for details.'
```

Prefer this shape:

```ts
message: 'OpenAI request failed: rate_limit_exceeded: Please retry after 20 seconds.'
detail: 'request req_123'
retryable: true
```

If there is truly no safe detail, include a stable category and run id:

```ts
message: 'Agent run failed because the provider returned an unrecognized error.'
detail: `Run ${runId}`
```

## Logging Boundary

Full Effect causes are for operators, not end users.

```ts
Effect.catchCause(program, (cause) =>
  Effect.gen(function* () {
    yield* Effect.logError('Agent run failed', {
      runId,
      cause: Cause.pretty(cause),
    })

    publish({
      _tag: 'RunFailed',
      runId,
      message: safeRunFailureMessage(cause),
    })
  })
)
```

For HTTP handlers, log the full cause and return a sanitized response unless the error is already an intentional API error.

```ts
Effect.catchCause(handler, (cause) =>
  Effect.logError('HTTP handler failed', cause).pipe(
    Effect.as(HttpServerResponse.text('Internal Server Error', { status: 500 }))
  )
)
```

## Recoverable Handling

Handle expected tags where there is a real recovery path.

```ts
// Delete is idempotent: missing is success.
deleteResource(id).pipe(
  Effect.catchTag('ResourceNotFound', () => Effect.void)
)
```

```ts
// Create can race with another actor or a previous crashed attempt.
createResource(input).pipe(
  Effect.catchTag('ResourceAlreadyExists', () => getResource(input.name))
)
```

```ts
// Eventual consistency: bounded retry on specific transient tags.
enableSubdomain(name).pipe(
  Effect.retry({
    while: (error) =>
      error._tag === 'ResourceNotReady' || error._tag === 'InternalServerError',
    schedule: Schedule.exponential('200 millis').pipe(Schedule.both(Schedule.recurs(8))),
  })
)
```

Do not catch broadly unless you are at a boundary whose job is logging/sanitization.

```ts
// Bad: hides the distinction between auth, validation, provider, and bugs.
program.pipe(Effect.catch(() => Effect.succeed(undefined)))
```

## Retry Semantics

Retries should be based on typed tags or categories.

Useful categories:

- `AuthError`: do not retry; prompt/configure credentials.
- `BadRequestError`: do not retry; surface validation/provider message.
- `NotFoundError`: recover only when absence is expected.
- `ThrottlingError`: retry with server hint if available.
- `ServerError`: retry with bounded exponential backoff.
- `NetworkError`: retry if the operation is safe/idempotent.
- `ParseError`: do not retry blindly; this is usually a decoder/schema bug.

If upstream provides `Retry-After` or rate-limit reset headers, parse them into a typed `retryAfter` field and cap the delay.

## Frontend Contract

The frontend should not have to parse stack traces. It should receive structured failure events.

```ts
export const RunFailed = Schema.TaggedStruct('RunFailed', {
  sessionId: Schema.String,
  runId: Schema.String,
  title: Schema.String,
  message: Schema.String,
  detail: Schema.optional(Schema.String),
  retryable: Schema.Boolean,
})
```

Render `message` as the main text. Render `detail` as muted supporting text. Do not show tooltips that duplicate visible labels.

## Review Checklist

- Is this error typed at the earliest useful boundary?
- Does the type preserve upstream facts without leaking secrets?
- Are parse, transport, auth/config, provider API, and defects distinct?
- Is user-facing text generated from typed/domain data?
- Is the full cause logged somewhere operators can inspect?
- Is recovery by tag/category, not message matching?
- Are retries bounded and specific?
- Does an unknown provider error point to improving the decoder?
- Does the frontend receive structured fields rather than a collapsed string?

## References

- Distilled: typed SDK errors, `matchError`, categories, retry hints.
- Alchemy: catch only recoverable typed tags, log full causes at runtime/HTTP boundaries, keep user messages intentional.
