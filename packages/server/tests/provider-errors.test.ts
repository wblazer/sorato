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
import { Effect } from 'effect'
import { AiError } from 'effect/unstable/ai'
import { HttpClientRequest, HttpClientResponse } from 'effect/unstable/http'
import { describe, expect, it } from '@effect/vitest'
import { ensureOk } from '../src/providers/provider-errors.ts'

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
