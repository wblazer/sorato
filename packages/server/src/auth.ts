import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import {
  Api,
  AuthOauthAuthorizeResponse,
  ProviderAuthUnsupported,
  ProviderCredentialsUnavailable,
  AuthProviderStatus,
  AuthSetResponse,
  AuthStatusResponse,
} from './api.ts'
import { MODEL_PROVIDERS } from './models.generated.ts'
import { startOpenAiOauth } from './openai-chatgpt-auth.ts'
import { hasProviderAuth, setApiKey } from './provider-auth.ts'

const authErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback

const credentialsUnavailable =
  (operation: string, fallback: string) => (error: unknown) =>
    new ProviderCredentialsUnavailable({
      code: 'provider.credentials_unavailable',
      operation,
      message: authErrorMessage(error, fallback),
      retryable: true,
    })

const authStatus = Effect.fn('Auth.status')(function* () {
  const providers = yield* Effect.all(
    MODEL_PROVIDERS.map((provider) =>
      hasProviderAuth(provider.id, provider.env).pipe(
        Effect.map(
          (authenticated) =>
            new AuthProviderStatus({
              id: provider.id,
              name: provider.name,
              authenticated,
            })
        )
      )
    )
  )

  return new AuthStatusResponse({
    providers,
    hasAuthenticatedProvider: providers.some(
      (provider) => provider.authenticated
    ),
  })
})

export const AuthLive = HttpApiBuilder.group(Api, 'auth', (handlers) =>
  handlers
    .handle('status', () =>
      authStatus().pipe(
        Effect.mapError(
          credentialsUnavailable(
            'Read provider credentials',
            'Failed to read provider credentials'
          )
        )
      )
    )
    .handle('set', ({ params, payload }) =>
      setApiKey(params.provider, payload.key.trim()).pipe(
        Effect.map(() => new AuthSetResponse({ ok: true })),
        Effect.mapError(
          credentialsUnavailable(
            'Save provider credentials',
            'Failed to save provider credentials'
          )
        )
      )
    )
    .handle(
      'oauthAuthorize',
      ({ params }) =>
        [
          Effect.fail(
            new ProviderAuthUnsupported({
              code: 'provider.oauth_unsupported',
              provider: params.provider,
              message: 'OAuth is only supported for OpenAI',
              retryable: false,
            })
          ),
          startOpenAiOauth().pipe(
            Effect.map((result) => new AuthOauthAuthorizeResponse(result)),
            Effect.mapError(
              credentialsUnavailable(
                'Start ChatGPT sign-in',
                'Failed to start ChatGPT sign-in'
              )
            )
          ),
        ][Number(params.provider === 'openai')] ??
        Effect.fail(
          new ProviderAuthUnsupported({
            code: 'provider.oauth_unsupported',
            provider: params.provider,
            message: 'OAuth is only supported for OpenAI',
            retryable: false,
          })
        )
    )
)
