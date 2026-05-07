import { Effect, Match } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import {
  Api,
  AuthError,
  AuthOauthAuthorizeResponse,
  AuthProviderStatus,
  AuthSetResponse,
  AuthStatusResponse,
} from './api.ts'
import { MODEL_PROVIDERS } from './models.generated.ts'
import { startOpenAiOauth } from './openai-chatgpt-auth.ts'
import { hasProviderAuth, setApiKey } from './provider-auth.ts'

const authErrorMessage = (error: unknown, fallback: string) =>
  Match.value(error).pipe(
    Match.when(
      (value: unknown): value is Error => value instanceof Error,
      (value) => value.message
    ),
    Match.orElse(() => fallback)
  )

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
    hasAuthenticatedProvider: providers.some((provider) => provider.authenticated),
  })
})

export const AuthLive = HttpApiBuilder.group(Api, 'auth', (handlers) =>
  handlers
    .handle('status', () =>
      authStatus().pipe(
        Effect.mapError(
          (error) =>
            new AuthError({
              message: authErrorMessage(
                error,
                'Failed to read provider credentials'
              ),
            })
        )
      )
    )
    .handle('set', ({ params, payload }) =>
      setApiKey(params.provider, payload.key.trim()).pipe(
        Effect.map(() => new AuthSetResponse({ ok: true })),
        Effect.mapError(
          (error) =>
            new AuthError({
              message: authErrorMessage(
                error,
                'Failed to save provider credentials'
              ),
            })
        )
      )
    )
    .handle('oauthAuthorize', ({ params }) =>
      (
        [
          Effect.fail(
            new AuthError({ message: 'OAuth is only supported for OpenAI' })
          ),
          startOpenAiOauth().pipe(
            Effect.map((result) => new AuthOauthAuthorizeResponse(result)),
            Effect.mapError(
              (error) =>
                new AuthError({
                  message: authErrorMessage(
                    error,
                    'Failed to start ChatGPT sign-in'
                  ),
                })
            )
          ),
        ][Number(params.provider === 'openai')] ??
        Effect.fail(
          new AuthError({ message: 'OAuth is only supported for OpenAI' })
        )
      )
    )
)
