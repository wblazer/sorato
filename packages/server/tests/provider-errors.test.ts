/**
 * Guards the provider error translation boundary.
 *
 * Regression: a 4xx whose body the provider schema cannot parse left every
 * `code`/`type`/`requestId` fact undefined. `providerMetadata` then emitted an
 * object with `undefined` values, which the `AiError` metadata schema (validated
 * as JSON) rejects. The schema threw synchronously inside the error constructor,
 * so the failure surfaced as an untyped defect — collapsing a clean typed
 * provider error into a generic "unexpected server error".
 *
 * These tests prove `ensureOk` always yields a typed `AiError` for non-2xx
 * responses, even when the body is unparseable and provider facts are absent.
 */
import { Deferred, Duration, Effect, Fiber, Random } from 'effect'
import { TestClock } from 'effect/testing'
import { AiError } from 'effect/unstable/ai'
import { HttpClientRequest, HttpClientResponse } from 'effect/unstable/http'
import { describe, expect, it } from '@effect/vitest'
import {
  ensureOk,
  retryProviderRequest,
} from '../src/providers/provider-errors.ts'

const responseWith = (status: number, body: string, contentType: string) => {
  const request = HttpClientRequest.get('https://api.openai.com/v1/responses')
  return HttpClientResponse.fromWeb(
    request,
    new globalThis.Response(body, {
      status,
      headers: { 'content-type': contentType },
    })
  )
}

const aiError = (reason: AiError.AiErrorReason): AiError.AiError =>
  AiError.make({ module: 'TestProvider', method: 'request', reason })

describe('ensureOk', () => {
  it.effect('fails with a typed AiError when a 4xx body is unparseable', () =>
    Effect.gen(function* () {
      // HTML body: provider schema cannot parse it, so code/type/requestId
      // all stay undefined — the exact shape that previously threw a defect.
      const response = responseWith(
        400,
        '<html><body>Bad Request</body></html>',
        'text/html'
      )

      // `flip` surfaces a typed failure as success; a defect (the old bug)
      // would still fail the effect and crash the test.
      const error = yield* ensureOk(
        'openai',
        'OpenAiResponses',
        'postResponses'
      )(response).pipe(Effect.flip)

      expect(AiError.isAiError(error)).toBe(true)
      expect(error.reason._tag).toBe('InvalidRequestError')
      if (error.reason._tag === 'InvalidRequestError') {
        // Metadata is valid JSON: undefined facts are omitted, not emitted.
        expect(error.reason.metadata.openai).toEqual({
          status: 400,
          retryable: false,
        })
      }
    })
  )

  it.effect('passes 2xx responses through unchanged', () =>
    Effect.gen(function* () {
      const response = responseWith(200, 'ok', 'text/plain')
      const result = yield* ensureOk(
        'openai',
        'OpenAiResponses',
        'postResponses'
      )(response)
      expect(result.status).toBe(200)
    })
  )
})

describe('retryProviderRequest', () => {
  it.effect('makes at most three total attempts', () =>
    Effect.gen(function* () {
      const error = aiError(
        new AiError.InternalProviderError({ description: 'temporary failure' })
      )
      let attempts = 0
      const retries: Array<number> = []
      const request = Effect.sync(() => {
        attempts += 1
      }).pipe(Effect.andThen(Effect.fail(error)))

      const fiber = yield* retryProviderRequest(request, (info) =>
        Effect.sync(() => {
          retries.push(info.attempt)
        })
      ).pipe(Effect.flip, Effect.forkChild)
      yield* TestClock.setTime(Number.POSITIVE_INFINITY)
      const result = yield* Fiber.join(fiber)

      expect(result).toBe(error)
      expect(attempts).toBe(3)
      expect(retries).toEqual([1, 2])
    }).pipe(Random.withSeed('provider-retry-attempts'))
  )

  it.effect('does not retry nonretryable or non-Ai failures', () =>
    Effect.gen(function* () {
      const errors = [
        aiError(
          new AiError.InvalidRequestError({ description: 'invalid request' })
        ),
        new Error('not an AiError'),
      ]

      for (const error of errors) {
        let attempts = 0
        let retries = 0
        const request = Effect.sync(() => {
          attempts += 1
        }).pipe(Effect.andThen(Effect.fail(error)))

        const result = yield* retryProviderRequest(request, () =>
          Effect.sync(() => {
            retries += 1
          })
        ).pipe(Effect.flip)

        expect(result).toBe(error)
        expect(attempts).toBe(1)
        expect(retries).toBe(0)
      }
    })
  )

  it.effect('uses retryAfter when it exceeds the jittered backoff', () =>
    Effect.gen(function* () {
      const retryAfter = Duration.seconds(5)
      const error = aiError(new AiError.RateLimitError({ retryAfter }))
      const retryScheduled = yield* Deferred.make<void>()
      let attempts = 0
      let delay = Duration.zero
      const request = Effect.sync(() => {
        attempts += 1
        return attempts
      }).pipe(
        Effect.flatMap((attempt) =>
          attempt === 1 ? Effect.fail(error) : Effect.succeed('success')
        )
      )

      const fiber = yield* retryProviderRequest(request, (info) =>
        Effect.sync(() => {
          delay = info.delay
        }).pipe(Effect.andThen(Deferred.succeed(retryScheduled, undefined)))
      ).pipe(Effect.forkChild)
      yield* Deferred.await(retryScheduled)

      expect(delay).toEqual(retryAfter)
      yield* TestClock.adjust(Duration.millis(4_999))
      expect(attempts).toBe(1)
      yield* TestClock.adjust(Duration.millis(1))

      expect(yield* Fiber.join(fiber)).toBe('success')
      expect(attempts).toBe(2)
    }).pipe(Random.withSeed('provider-retry-after'))
  )

  it.effect(
    'completes onRetry before waiting and starting the next attempt',
    () =>
      Effect.gen(function* () {
        const error = aiError(
          new AiError.InternalProviderError({
            description: 'temporary failure',
          })
        )
        const callbackStarted = yield* Deferred.make<void>()
        const releaseCallback = yield* Deferred.make<void>()
        const order: Array<string> = []
        let attempts = 0
        const request = Effect.sync(() => {
          attempts += 1
          order.push(`attempt-${attempts}`)
          return attempts
        }).pipe(
          Effect.flatMap((attempt) =>
            attempt === 1 ? Effect.fail(error) : Effect.succeed('success')
          )
        )

        const fiber = yield* retryProviderRequest(request, () =>
          Effect.sync(() => {
            order.push('callback-start')
          }).pipe(
            Effect.andThen(Deferred.succeed(callbackStarted, undefined)),
            Effect.andThen(Deferred.await(releaseCallback)),
            Effect.andThen(
              Effect.sync(() => {
                order.push('callback-end')
              })
            )
          )
        ).pipe(Effect.forkChild)

        yield* Deferred.await(callbackStarted)
        expect(order).toEqual(['attempt-1', 'callback-start'])
        expect(attempts).toBe(1)

        yield* TestClock.adjust(Duration.seconds(2))
        expect(attempts).toBe(1)

        yield* Deferred.succeed(releaseCallback, undefined)
        yield* Effect.yieldNow
        yield* TestClock.adjust(Duration.seconds(2))

        expect(yield* Fiber.join(fiber)).toBe('success')
        expect(order).toEqual([
          'attempt-1',
          'callback-start',
          'callback-end',
          'attempt-2',
        ])
      }).pipe(Random.withSeed('provider-retry-callback'))
  )
})
