import { BrowserHttpClient } from '@effect/platform-browser'
import {
  Api,
  DirectoryError,
  ModelCatalogUnavailable,
  ModelUnavailable,
  ProjectOperationFailed,
  ProviderAuthUnsupported,
  ProviderCredentialsUnavailable,
  ProviderNotConfigured,
  RunRejected,
  StorageUnavailable,
} from '@sorato/api'
import { Cause, Effect, Schema } from 'effect'
import { HttpClientError } from 'effect/unstable/http'
import { HttpApiClient } from 'effect/unstable/httpapi'
import type { ApiResult, UiApiError } from '$lib/api-errors.js'
import { requestError } from '$lib/api-errors.js'

export type SoratoApiClient = HttpApiClient.ForApi<typeof Api>

const clientCache = new Map<string, Promise<SoratoApiClient>>()

export function getApiClient(baseUrl: string): Promise<SoratoApiClient> {
  const existing = clientCache.get(baseUrl)
  if (existing) return existing

  const created = Effect.runPromise(
    HttpApiClient.make(Api, { baseUrl }).pipe(
      Effect.provide(BrowserHttpClient.layerFetch)
    )
  )
  clientCache.set(baseUrl, created)
  return created
}

const knownErrorTitles: Record<string, string> = {
  ProviderCredentialsUnavailable: 'Couldn’t read provider credentials',
  ProviderNotConfigured: 'No model provider configured',
  ProviderAuthUnsupported: 'Provider sign-in is not supported',
  ModelCatalogUnavailable: 'Couldn’t load model catalog',
  ModelUnavailable: 'Selected model is unavailable',
  ProjectOperationFailed: 'Project operation failed',
  StorageUnavailable: 'Storage is unavailable',
  RunRejected: 'Run was rejected',
  DirectoryError: 'Directory cannot be opened',
}

type KnownApiError =
  | ProviderCredentialsUnavailable
  | ProviderNotConfigured
  | ProviderAuthUnsupported
  | ModelCatalogUnavailable
  | ModelUnavailable
  | ProjectOperationFailed
  | StorageUnavailable
  | RunRejected
  | DirectoryError

const apiErrorSchemas = [
  ProviderCredentialsUnavailable,
  ProviderNotConfigured,
  ProviderAuthUnsupported,
  ModelCatalogUnavailable,
  ModelUnavailable,
  ProjectOperationFailed,
  StorageUnavailable,
  RunRejected,
  DirectoryError,
] as const

const decodeKnownApiError = (error: unknown): KnownApiError | undefined => {
  for (const schema of apiErrorSchemas) {
    const decoded = Schema.decodeUnknownOption(schema)(error)
    if (decoded._tag === 'Some') return decoded.value as KnownApiError
  }
  return undefined
}

const nonEmpty = (value: string | null | undefined) => {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : undefined
}

function apiFailureToUi(error: unknown, context: string): UiApiError {
  const decoded = decodeKnownApiError(error)
  if (decoded) {
    const message = 'message' in decoded ? nonEmpty(decoded.message) : undefined
    return {
      title: knownErrorTitles[decoded._tag] ?? context,
      message: message ?? context,
      tag: decoded._tag,
      code: 'code' in decoded ? decoded.code : null,
      status: null,
      retryable: 'retryable' in decoded ? decoded.retryable : false,
    }
  }

  if (HttpClientError.isHttpClientError(error)) {
    return {
      title: 'Couldn’t reach server',
      message: `${context}: Check that the Sorato server is running and this connection URL is correct.`,
      tag: error.reason._tag,
      code: 'transport.unavailable',
      status:
        error.reason._tag === 'StatusCodeError'
          ? error.reason.response.status
          : null,
      retryable: true,
    }
  }

  if (error instanceof Schema.SchemaError) {
    return {
      title: 'Invalid server response',
      message: `${context}: The server returned data that did not match the shared API contract.`,
      tag: 'SchemaError',
      code: 'schema.decode_failed',
      status: null,
      retryable: false,
    }
  }

  return requestError(error, context)
}

function defectToUi(cause: Cause.Cause<unknown>, context: string): UiApiError {
  return requestError(Cause.pretty(cause), context)
}

export async function runApi<A, E>(
  effect: Parameters<typeof Effect.runPromiseExit<A, E>>[0],
  context: string
): Promise<ApiResult<A>> {
  const exit = await Effect.runPromiseExit(effect)
  if (exit._tag === 'Success') return { ok: true, value: exit.value }

  const failure = Cause.findErrorOption(exit.cause)
  if (failure._tag === 'Some') {
    return { ok: false, error: apiFailureToUi(failure.value, context) }
  }

  return { ok: false, error: defectToUi(exit.cause, context) }
}
