import { z } from "zod"

import { clientEnv } from "@/lib/env"
import { getServerEnv } from "@/lib/env.server"

/**
 * OAuth provider registry backed by `OAUTH_PROVIDERS_JSON`.
 *
 * Built-in providers (github, google, gitlab) ship with their canonical
 * endpoints and scopes, so a JSON entry only needs the app registration
 * values (`clientId`, optional `clientSecret`). Any URL or scope list in the
 * entry overrides the built-in default — useful for GitHub Enterprise,
 * self-managed GitLab, or Google Workspace tenants on custom domains.
 *
 * Shape (all URLs absolute):
 * ```json
 * {
 *   "github": {
 *     "clientId": "…",
 *     "clientSecret": "… (optional for public PKCE clients)",
 *     "authorizeUrl": "https://github.com/login/oauth/authorize",
 *     "tokenUrl": "https://github.com/login/oauth/access_token",
 *     "userinfoUrl": "https://api.github.com/user",
 *     "scopes": ["read:user", "user:email"]
 *   }
 * }
 * ```
 *
 * The JSON lives in a server-only env var so client ids are the only values
 * ever exposed (via GET /api/auth/oauth/[provider]); secrets never leave the
 * server. `userinfoUrl` may be set to `null` when the provider returns the
 * profile in the token response itself.
 *
 * Unknown provider names are still supported but must spell out every URL —
 * there is no built-in default to fall back on.
 *
 * Mock mode: when `NEXT_PUBLIC_MOCK_AUTH=1` outside production, every
 * built-in provider that is not configured through `OAUTH_PROVIDERS_JSON`
 * gets a synthetic `mock` config. The authorize URL is rewritten by
 * GET /api/auth/oauth/[provider] to a same-origin bounce that lands back on
 * /oauth/callback, and POST /api/auth/oauth/callback skips the token
 * exchange entirely — the same dev-only escape hatch as the mock session.
 */

export type OAuthProviderEndpoints = {
  authorizeUrl: string
  tokenUrl: string
  userinfoUrl?: string
  /**
   * Secondary endpoint queried when the userinfo response carries no e-mail.
   * GitHub's GET /user returns `email: null` for private e-mail addresses;
   * GET /user/emails (covered by the `user:email` scope) lists them with
   * `primary`/`verified` flags. Providers without an equivalent endpoint
   * (GitLab only exposes the address the granted scopes allow on /user)
   * simply omit this.
   */
  emailsUrl?: string
  scopes: string[]
}

/** Canonical endpoints for the social providers the auth UI knows about. */
export const KNOWN_OAUTH_PROVIDERS: Record<string, OAuthProviderEndpoints> = {
  github: {
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    // /user returns the public profile; `email` is null for private
    // addresses — fetchOAuthUserProfile falls back to emailsUrl
    // (/user/emails, covered by the `user:email` scope) in that case.
    userinfoUrl: "https://api.github.com/user",
    emailsUrl: "https://api.github.com/user/emails",
    scopes: ["read:user", "user:email"],
  },
  google: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userinfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
    scopes: ["openid", "email", "profile"],
  },
  gitlab: {
    authorizeUrl: "https://gitlab.com/oauth/authorize",
    tokenUrl: "https://gitlab.com/oauth/token",
    // GitLab's /user only returns `email` when the granted scope exposes a
    // public address (`read_user` covers the public profile). There is no
    // secondary endpoint for private e-mails — instances that need them
    // must widen `scopes` (e.g. ["api"]) via OAUTH_PROVIDERS_JSON.
    // Self-managed instances can override all URLs via OAUTH_PROVIDERS_JSON.
    userinfoUrl: "https://gitlab.com/api/v4/user",
    scopes: ["read_user"],
  },
}

export type OAuthProviderConfig = OAuthProviderEndpoints & {
  name: string
  clientId: string
  clientSecret?: string
  /**
   * True for the synthetic provider injected in mock-auth mode: the callback
   * route must skip the network token exchange and resolve a fixture
   * identity instead.
   */
  mock: boolean
}

/**
 * Every field is optional: known providers fall back to
 * {@link KNOWN_OAUTH_PROVIDERS}, unknown ones are validated strictly after
 * merging. `clientId` is what marks a provider as configured.
 */
const providerEntrySchema = z.object({
  clientId: z.string().min(1).optional(),
  clientSecret: z.string().optional(),
  authorizeUrl: z.string().url().optional(),
  tokenUrl: z.string().url().optional(),
  // `null` explicitly disables profile lookup; `undefined` keeps the default.
  userinfoUrl: z.string().url().nullish(),
  emailsUrl: z.string().url().nullish(),
  scopes: z.array(z.string().min(1)).optional(),
})

type ProviderEntry = z.infer<typeof providerEntrySchema>

/**
 * Mock auth is a development/preview escape hatch (`NEXT_PUBLIC_MOCK_AUTH=1`),
 * matching `mock-session.ts` — it must never activate in production.
 */
export function mockOAuthEnabled(): boolean {
  return clientEnv.NEXT_PUBLIC_MOCK_AUTH === "1" && clientEnv.NODE_ENV !== "production"
}

/** Sentinel endpoints for synthetic providers; never fetched. */
const MOCK_PROVIDER_ENDPOINTS: OAuthProviderEndpoints = {
  authorizeUrl: "https://oauth.mock.invalid/authorize",
  tokenUrl: "https://oauth.mock.invalid/token",
  scopes: [],
}

function mockProviderConfig(name: string): OAuthProviderConfig {
  return {
    name,
    clientId: "mock",
    ...MOCK_PROVIDER_ENDPOINTS,
    mock: true,
  }
}

/**
 * Resolves one JSON entry into a provider config, or null when the entry is
 * malformed or lacks the credentials/endpoints required to run a flow.
 */
function resolveProvider(name: string, raw: unknown): OAuthProviderConfig | null {
  const parsed = providerEntrySchema.safeParse(raw)
  if (!parsed.success) return null
  const entry: ProviderEntry = parsed.data
  const builtin = KNOWN_OAUTH_PROVIDERS[name]

  const authorizeUrl = entry.authorizeUrl ?? builtin?.authorizeUrl
  const tokenUrl = entry.tokenUrl ?? builtin?.tokenUrl
  const scopes = entry.scopes ?? builtin?.scopes ?? []
  // An explicit `userinfoUrl: null` disables profile lookup; an explicit
  // string overrides; absence keeps the built-in default (if any).
  const userinfoUrl =
    entry.userinfoUrl === null ? undefined : (entry.userinfoUrl ?? builtin?.userinfoUrl)
  const emailsUrl = entry.emailsUrl === null ? undefined : (entry.emailsUrl ?? builtin?.emailsUrl)

  if (!entry.clientId || !authorizeUrl || !tokenUrl) return null

  return {
    name,
    clientId: entry.clientId,
    ...(entry.clientSecret ? { clientSecret: entry.clientSecret } : {}),
    authorizeUrl,
    tokenUrl,
    ...(userinfoUrl ? { userinfoUrl } : {}),
    ...(emailsUrl ? { emailsUrl } : {}),
    scopes,
    mock: false,
  }
}

let cache: Map<string, OAuthProviderConfig> | null = null

export function listOAuthProviders(): Map<string, OAuthProviderConfig> {
  if (cache) return cache
  cache = new Map()
  const raw = getServerEnv().OAUTH_PROVIDERS_JSON
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      for (const [name, value] of Object.entries(parsed)) {
        const config = resolveProvider(name, value)
        if (config) cache.set(name, config)
      }
    } catch {
      // Malformed JSON disables OAuth entirely rather than crashing requests.
    }
  }

  // Mock-auth dev mode: unconfigured built-in providers get a synthetic
  // config so the buttons enable and the whole flow runs without a real
  // provider registration. Real entries always win.
  if (mockOAuthEnabled()) {
    for (const name of Object.keys(KNOWN_OAUTH_PROVIDERS)) {
      if (!cache.has(name)) cache.set(name, mockProviderConfig(name))
    }
  }
  return cache
}

export function getOAuthProvider(name: string): OAuthProviderConfig | null {
  return listOAuthProviders().get(name) ?? null
}

/** Public provider ids safe to expose to the auth pages and API clients. */
export function listOAuthProviderNames(): string[] {
  return [...listOAuthProviders().keys()].filter((name) => /^[a-z0-9-]{2,32}$/.test(name))
}

/** Test hook. */
export function resetOAuthProviderCacheForTests(): void {
  cache = null
}
