import { createServer, type Server } from 'node:http'
import { platform, release, arch } from 'node:os'
import { Effect } from 'effect'
import {
  ProviderAuthStore,
  ProviderOauthInfo,
  type ProviderAuthStoreApi,
} from './provider-auth.ts'

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const ISSUER = 'https://auth.openai.com'
const PORTS = [1455, 1457] as const
const CALLBACK_PATH = '/auth/callback'
export const ORIGINATOR = 'sorato'

type Pkce = { verifier: string; challenge: string }
type TokenResponse = {
  id_token?: string
  access_token: string
  refresh_token: string
  expires_in?: number
}

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
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString())
  } catch {
    return
  }
}

const accountIdFromClaims = (claims: Record<string, unknown>) => {
  if (typeof claims.chatgpt_account_id === 'string')
    return claims.chatgpt_account_id
  const auth = claims['https://api.openai.com/auth']
  if (
    auth &&
    typeof auth === 'object' &&
    'chatgpt_account_id' in auth &&
    typeof auth.chatgpt_account_id === 'string'
  ) {
    return auth.chatgpt_account_id
  }
  const organizations = claims.organizations
  if (Array.isArray(organizations)) {
    const first = organizations[0]
    if (
      first &&
      typeof first === 'object' &&
      'id' in first &&
      typeof first.id === 'string'
    ) {
      return first.id
    }
  }
}

export const accountIdFromTokens = (tokens: TokenResponse) => {
  const idClaims = tokens.id_token ? parseJwtClaims(tokens.id_token) : undefined
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
      return (await response.json()) as TokenResponse
    },
    catch: (cause) =>
      new Error(
        cause instanceof Error ? cause.message : 'Token refresh failed'
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
    if (stored?.type !== 'oauth') {
      return yield* Effect.fail(
        new Error('OpenAI ChatGPT credentials are not available')
      )
    }
    if (!isExpired(stored)) return stored

    if (!refreshOpenAiPromise.current) {
      refreshOpenAiPromise.current = Effect.runPromise(
        refreshOpenAiOauthWithStore(store, stored)
      ).finally(() => {
        refreshOpenAiPromise.current = undefined
      })
    }
    return yield* Effect.promise(
      () => refreshOpenAiPromise.current as Promise<ProviderOauthInfo>
    )
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
  return (await response.json()) as TokenResponse
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
      if (url.pathname !== CALLBACK_PATH) {
        response.writeHead(404)
        response.end('Not found')
        return
      }

      const state = url.searchParams.get('state') ?? ''
      const current = pending.get(state)
      pending.delete(state)
      if (!current) {
        response.writeHead(400, { 'Content-Type': 'text/html' })
        response.end('<h1>Sign-in failed</h1><p>Invalid OAuth state.</p>')
        return
      }

      const code = url.searchParams.get('code')
      if (!code) {
        response.writeHead(400, { 'Content-Type': 'text/html' })
        response.end(
          '<h1>Sign-in failed</h1><p>Missing authorization code.</p>'
        )
        return
      }

      try {
        const tokens = await exchangeCode(
          code,
          current.pkce.verifier,
          current.port
        )
        await Effect.runPromise(saveTokens(current.store, tokens))
        response.writeHead(200, { 'Content-Type': 'text/html' })
        response.end(
          '<h1>Signed in to ChatGPT</h1><p>You can close this window and return to Sorato.</p>'
        )
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Sign-in failed'
        response.writeHead(500, { 'Content-Type': 'text/html' })
        response.end(`<h1>Sign-in failed</h1><p>${htmlEscape(message)}</p>`)
      }
    })
    next.once('error', reject)
    next.listen(candidate, () => {
      next.off('error', reject)
      server = next
      serverPort = candidate
      resolve(candidate)
    })
  })

const ensureServer = Effect.fn('OpenAiChatGptAuth.ensureServer')(function* () {
  if (server && serverPort) return serverPort
  return yield* Effect.tryPromise({
    try: async () => {
      for (const port of PORTS) {
        try {
          return await listen(port)
        } catch {}
      }
      throw new Error(
        'Unable to start OAuth callback server on ports 1455 or 1457'
      )
    },
    catch: (cause) =>
      cause instanceof Error
        ? cause
        : new Error('Unable to start OAuth callback server'),
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
