import { createServer, type Server } from 'node:http'
import { platform, release, arch } from 'node:os'
import { Effect, Match, Option, Schema } from 'effect'
import {
  ProviderAuthStore,
  ProviderOauthInfo,
  type ProviderAuthStoreApi,
} from './provider-auth.ts'

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const ISSUER = 'https://auth.openai.com'
const PORTS = [1455, 1457] satisfies ReadonlyArray<number>
const CALLBACK_PATH = '/auth/callback'
export const ORIGINATOR = 'sorato'

type Pkce = { verifier: string; challenge: string }
const TokenResponse = Schema.Struct({
  id_token: Schema.optional(Schema.String),
  access_token: Schema.String,
  refresh_token: Schema.String,
  expires_in: Schema.optional(Schema.Number),
})
type TokenResponse = typeof TokenResponse.Type
const JwtClaims = Schema.Record(Schema.String, Schema.Unknown)

type Pending = {
  readonly store: ProviderAuthStoreApi
  readonly pkce: Pkce
  readonly port: number
}

let server: Server | undefined
let serverPort: number | undefined
const pending = new Map<string, Pending>()

const base64Url = (buffer: ArrayBuffer) =>
  Buffer.from(buffer).toString('base64url')

const randomString = (length: number) =>
  base64Url(crypto.getRandomValues(new Uint8Array(length)).buffer).slice(
    0,
    length
  )

const pkce = async (): Promise<Pkce> => {
  const verifier = randomString(64)
  const challenge = base64Url(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  )
  return { verifier, challenge }
}

const parseJwtClaims = (token: string): Record<string, unknown> | undefined => {
  const [, payload] = token.split('.')
  if (!payload) return
  return Effect.runSync(
    Effect.try({
      try: () =>
        Schema.decodeUnknownSync(JwtClaims)(
          JSON.parse(Buffer.from(payload, 'base64url').toString())
        ),
      catch: (error) => error,
    }).pipe(
      Effect.option,
      Effect.map(Option.getOrUndefined)
    )
  )
}

const organizationAccountId = (claims: Record<string, unknown>) =>
  Match.value(claims.organizations).pipe(
    Match.when(
      (value: unknown): value is Array<{ id: string }> =>
        Array.isArray(value) &&
        value[0] !== undefined &&
        typeof value[0] === 'object' &&
        value[0] !== null &&
        'id' in value[0] &&
        typeof value[0].id === 'string',
      (value) => value[0]?.id
    ),
    Match.orElse(() => undefined)
  )

const accountIdFromClaims = (claims: Record<string, unknown>) => {
  if (typeof claims.chatgpt_account_id === 'string')
    return claims.chatgpt_account_id
  const auth = claims['https://api.openai.com/auth']
  const authAccountId = Match.value(auth).pipe(
    Match.when(
      (value: unknown): value is { chatgpt_account_id: string } =>
        value !== null &&
        typeof value === 'object' &&
        'chatgpt_account_id' in value &&
        typeof value.chatgpt_account_id === 'string',
      (value) => value.chatgpt_account_id
    ),
    Match.orElse(() => undefined)
  )
  return authAccountId ?? organizationAccountId(claims)
}

export const accountIdFromTokens = (tokens: TokenResponse) => {
  const idClaims = Match.value(tokens.id_token).pipe(
    Match.when(undefined, () => undefined),
    Match.orElse(parseJwtClaims)
  )
  const accessClaims = parseJwtClaims(tokens.access_token)
  return (
    (idClaims && accountIdFromClaims(idClaims)) ||
    (accessClaims && accountIdFromClaims(accessClaims))
  )
}

const htmlEscape = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

const authPage = (options: {
  readonly title: string
  readonly message: string
}) => {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <title>${htmlEscape(options.title)}</title>
    <style>
      :root {
        --background: oklch(0.22 0.002 0);
        --foreground: oklch(0.91 0.008 80);
        --muted-foreground: oklch(0.66 0.006 80);
      }

      * {
        box-sizing: border-box;
      }

      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        padding: 1.5rem;
        background: var(--background);
        color: var(--foreground);
        font-family: "Nunito Sans", ui-sans-serif, system-ui, sans-serif;
      }

      main {
        width: min(100%, 28rem);
        text-align: center;
      }

      h1 {
        margin: 0;
        font-size: clamp(1.5rem, 5vw, 2rem);
        line-height: 1.1;
      }

      p {
        margin: 0.75rem 0 0;
        color: var(--muted-foreground);
        font-size: 1rem;
        line-height: 1.6;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${htmlEscape(options.title)}</h1>
      <p>${htmlEscape(options.message)}</p>
    </main>
  </body>
</html>`
}

const refreshOpenAiPromise: {
  current: Promise<ProviderOauthInfo> | undefined
} = {
  current: undefined,
}

const isExpired = (auth: ProviderOauthInfo) => auth.expires <= Date.now()

const refreshOpenAiOauthWithStore = Effect.fn(
  'OpenAiChatGptAuth.refreshWithStore'
)(function* (store: ProviderAuthStoreApi, current: ProviderOauthInfo) {
  const tokens = yield* Effect.tryPromise({
    try: async () => {
      const response = await fetch(`${ISSUER}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: current.refresh,
          client_id: CLIENT_ID,
        }),
      })
      if (!response.ok)
        throw new Error(`Token refresh failed: ${response.status}`)
      return Schema.decodeUnknownSync(TokenResponse)(await response.json())
    },
    catch: (cause) =>
      new Error(
        Match.value(cause).pipe(
          Match.when(
            (value: unknown): value is Error => value instanceof Error,
            (value) => value.message
          ),
          Match.orElse(() => 'Token refresh failed')
        )
      ),
  })

  const next = new ProviderOauthInfo({
    type: 'oauth',
    refresh: tokens.refresh_token,
    access: tokens.access_token,
    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    lastRefresh: Date.now(),
    accountId: accountIdFromTokens(tokens) ?? current.accountId,
  })
  yield* store.setOauth('openai', next)
  return next
})

export const currentOpenAiOauth = Effect.fn('OpenAiChatGptAuth.current')(
  function* (store: ProviderAuthStoreApi) {
    const stored = yield* store.getAuth('openai')
    const oauth = Match.value(stored).pipe(
      Match.when(
        (value: unknown): value is ProviderOauthInfo =>
          value instanceof ProviderOauthInfo,
        (value) => value
      ),
      Match.orElse(() => undefined)
    )
    const current = yield* Effect.fromNullishOr(oauth).pipe(
      Effect.mapError(
        () => new Error('OpenAI ChatGPT credentials are not available')
      )
    )
    const fresh = Effect.succeed(current)
    const refresh = Effect.suspend(() => {
      refreshOpenAiPromise.current = refreshOpenAiPromise.current ?? Effect.runPromise(
        refreshOpenAiOauthWithStore(store, current)
      ).finally(() => {
        refreshOpenAiPromise.current = undefined
      })
      return Effect.promise(
        () => refreshOpenAiPromise.current as Promise<ProviderOauthInfo>
      )
    })

    return yield* ([refresh, fresh][Number(!isExpired(current))] ?? refresh)
  }
)

const exchangeCode = async (
  code: string,
  verifier: string,
  port: number
): Promise<TokenResponse> => {
  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: `http://localhost:${port}${CALLBACK_PATH}`,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    }),
  })
  if (!response.ok) throw new Error(`Token exchange failed: ${response.status}`)
  return Schema.decodeUnknownSync(TokenResponse)(await response.json())
}

const saveTokens = (store: ProviderAuthStoreApi, tokens: TokenResponse) =>
  store.setOauth('openai', {
    refresh: tokens.refresh_token,
    access: tokens.access_token,
    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    lastRefresh: Date.now(),
    accountId: accountIdFromTokens(tokens),
  })

const listen = (candidate: number) =>
  new Promise<number>((resolve, reject) => {
    const next = createServer(async (request, response) => {
      const url = new URL(request.url ?? '/', `http://localhost:${candidate}`)
      // biome-ignore lint/plugin: HTTP callback exits immediately for non-OAuth paths
      if (url.pathname !== CALLBACK_PATH) {
        response.writeHead(404)
        response.end('Not found')
        return
      }

      const state = url.searchParams.get('state') ?? ''
      const current = pending.get(state)
      pending.delete(state)
      if (!current) {
        response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(
          authPage({
            title: 'Sign-in failed',
            message: 'Invalid OAuth state.',
          })
        )
        return
      }

      const code = url.searchParams.get('code')
      if (!code) {
        response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(
          authPage({
            title: 'Sign-in failed',
            message: 'Missing authorization code.',
          })
        )
        return
      }

      await exchangeCode(code, current.pkce.verifier, current.port)
        .then((tokens) => Effect.runPromise(saveTokens(current.store, tokens)))
        .then(() => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(
          authPage({
            title: 'Signed in to ChatGPT',
            message: 'You can close this window and return to Sorato.',
          })
        )
        })
        .catch((error) => {
        const message = Match.value(error).pipe(
          Match.when(
            (value: unknown): value is Error => value instanceof Error,
            (value) => value.message
          ),
          Match.orElse(() => 'Sign-in failed')
        )
        response.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(authPage({ title: 'Sign-in failed', message }))
        })
    })
    next.once('error', reject)
    next.listen(candidate, () => {
      next.off('error', reject)
      server = next
      serverPort = candidate
      resolve(candidate)
    })
  })

const listenOnPorts = (ports: ReadonlyArray<number>): Promise<number> => {
  const [port, ...remaining] = ports
  return Match.value(port).pipe(
    Match.when(undefined, () =>
      Promise.reject(
        new Error('Unable to start OAuth callback server on ports 1455 or 1457')
      )
    ),
    Match.orElse((candidate) =>
      listen(candidate).catch(() => listenOnPorts(remaining))
    )
  )
}

const ensureServer = Effect.fn('OpenAiChatGptAuth.ensureServer')(function* () {
  if (server && serverPort) return serverPort
  return yield* Effect.tryPromise({
    try: () => listenOnPorts(PORTS),
    catch: (cause) =>
      Match.value(cause).pipe(
        Match.when(
          (value: unknown): value is Error => value instanceof Error,
          (value) => value
        ),
        Match.orElse(() => new Error('Unable to start OAuth callback server'))
      ),
  })
})

export const startOpenAiOauth = Effect.fn('OpenAiChatGptAuth.start')(
  function* () {
    const store = yield* ProviderAuthStore
    const port = yield* ensureServer()
    const codes = yield* Effect.promise(pkce)
    const state = randomString(43)
    pending.set(state, { store, pkce: codes, port })
    const url = new URL(`${ISSUER}/oauth/authorize`)
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: `http://localhost:${port}${CALLBACK_PATH}`,
      scope: 'openid profile email offline_access',
      code_challenge: codes.challenge,
      code_challenge_method: 'S256',
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true',
      state,
      originator: ORIGINATOR,
    }).toString()
    return { url: url.toString() }
  }
)

export const soratoUserAgent = () =>
  `sorato/0.0.1 (${platform()} ${release()}; ${arch()})`
