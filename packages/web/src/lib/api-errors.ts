import { Option, Schema } from 'effect'

export const ApiErrorPayload = Schema.Struct({
  _tag: Schema.optional(Schema.String),
  code: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  operation: Schema.optional(Schema.String),
  retryable: Schema.optional(Schema.Boolean),
  provider: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
})

export type ApiErrorPayload = typeof ApiErrorPayload.Type

export interface UiApiError {
  readonly title: string
  readonly message: string
  readonly tag: string | null
  readonly code: string | null
  readonly status: number | null
  readonly retryable: boolean
}

export type ApiResult<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: UiApiError }

const decodeApiErrorPayload = Schema.decodeUnknownOption(ApiErrorPayload)

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

const nonEmpty = (value: string | null | undefined) => {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : undefined
}

const titleFor = (payload: ApiErrorPayload | null, fallback: string): string =>
  (payload?._tag && knownErrorTitles[payload._tag]) || fallback

const payloadMessage = (payload: ApiErrorPayload | null) => {
  if (!payload) return undefined
  const detail = nonEmpty(payload.message) ?? nonEmpty(payload.error)
  if (!detail) return undefined
  const operation = nonEmpty(payload.operation)
  return operation && !detail.startsWith(`${operation}:`)
    ? `${operation}: ${detail}`
    : detail
}

export function transportError(context: string): UiApiError {
  return {
    title: 'Couldn’t reach server',
    message: `${context}: Check that the Sorato server is running and this connection URL is correct.`,
    tag: 'TransportError',
    code: 'transport.unavailable',
    status: null,
    retryable: true,
  }
}

export async function httpError(
  response: Response,
  context = 'Request failed'
): Promise<UiApiError> {
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => null)

  const payload = Option.getOrNull(decodeApiErrorPayload(body))
  const statusText = response.statusText || 'HTTP error'
  return {
    title: titleFor(payload, context),
    message:
      payloadMessage(payload) ??
      `${context}: Server returned ${response.status} ${statusText}`,
    tag: payload?._tag ?? null,
    code: payload?.code ?? null,
    status: response.status,
    retryable: payload?.retryable ?? response.status >= 500,
  }
}

export function requestError(error: unknown, context: string): UiApiError {
  if (error instanceof TypeError && error.message === 'Failed to fetch') {
    return transportError(context)
  }

  if (error instanceof Error) {
    return {
      title: context,
      message: `${context}: ${error.message}`,
      tag: null,
      code: null,
      status: null,
      retryable: false,
    }
  }

  return {
    title: context,
    message: `${context}: Request failed`,
    tag: null,
    code: null,
    status: null,
    retryable: false,
  }
}

export function requestErrorMessage(error: unknown, context: string): string {
  return requestError(error, context).message
}
