import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { Api, AuthError, AuthSetResponse } from './api.ts'
import { dataDir } from './data-dir.ts'
import { setApiKey } from './provider-auth.ts'

export const AuthLive = HttpApiBuilder.group(Api, 'auth', (handlers) =>
  handlers.handle('set', ({ params, payload }) =>
    setApiKey(dataDir, params.provider, payload.key.trim()).pipe(
      Effect.as(new AuthSetResponse({ ok: true })),
      Effect.mapError((error) =>
        new AuthError({
          message:
            error instanceof Error ? error.message : 'Failed to save provider credentials',
        })
      )
    )
  )
)
