import type { OAuthProviderConfig } from "@/lib/auth/oauth-providers"

/**
 * Server-side half of the OAuth authorization-code + PKCE flow.
 *
 * Everything that touches the network lives here so route handlers stay thin
 * and tests can `vi.mock("@/lib/auth/oauth/token-exchange")` — unit tests
 * must never make real provider calls (globalThis.fetch throws on any
 * unexpected request).
 */

export type OAuthTokenResponse = {
  access_token?: string
  token_type?: string
  id_token?: string
  [key: string]: unknown
}

export type OAuthProfile = {
  email?: string
  name?: string
}

/**
 * Exchanges the authorization `code` for tokens. `codeVerifier` is the PKCE
 * verifier the browser generated before the authorize redirect — the provider
 * only accepts the exchange when it hashes to the challenge it saw.
 *
 * Returns null on any HTTP or transport failure; callers map that to a
 * generic sign-in error (providers intentionally return little detail).
 */
export async function exchangeAuthorizationCode(
  config: OAuthProviderConfig,
  input: { code: string; redirectUri: string; codeVerifier: string },
): Promise<OAuthTokenResponse | null> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
    client_id: config.clientId,
  })
  if (config.clientSecret) body.set("client_secret", config.clientSecret)

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
    cache: "no-store",
  })
  if (!response.ok) return null
  return (await response.json()) as OAuthTokenResponse
}

type GitHubEmailEntry = {
  email?: unknown
  primary?: unknown
  verified?: unknown
}

/**
 * Picks the sign-in address from a provider's e-mail list endpoint
 * (GitHub's GET /user/emails). Prefers the primary+verified entry, then
 * primary, then verified, then the first usable address — an unverified
 * primary is still better than nothing for account linking, and the
 * provider already authenticated the user.
 */
function pickEmail(entries: GitHubEmailEntry[]): string | undefined {
  const usable = entries.filter(
    (entry): entry is GitHubEmailEntry & { email: string } => typeof entry.email === "string",
  )
  const find = (pred: (entry: GitHubEmailEntry) => boolean) =>
    usable.find((entry) => pred(entry) && typeof entry.email === "string")?.email
  return (
    find((e) => e.primary === true && e.verified === true) ??
    find((e) => e.primary === true) ??
    find((e) => e.verified === true) ??
    usable[0]?.email
  )
}

/**
 * Secondary e-mail lookup for providers whose userinfo endpoint omits the
 * address (GitHub returns `email: null` for private e-mails). Returns
 * undefined on any failure — the caller still has the profile `name`.
 */
async function fetchFallbackEmail(
  config: OAuthProviderConfig,
  accessToken: string,
): Promise<string | undefined> {
  if (!config.emailsUrl) return undefined
  try {
    const response = await fetch(config.emailsUrl, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      cache: "no-store",
    })
    if (!response.ok) return undefined
    const body: unknown = await response.json()
    // GitHub returns an array of {email, primary, verified}; tolerate a
    // single-object {email} shape for custom providers too.
    if (Array.isArray(body)) {
      return pickEmail(body as GitHubEmailEntry[])
    }
    if (body && typeof body === "object") {
      const email = (body as { email?: unknown }).email
      return typeof email === "string" ? email : undefined
    }
    return undefined
  } catch {
    return undefined
  }
}

/**
 * Resolves the signed-in identity from the provider's userinfo endpoint.
 * Providers differ in shape (`email`/`name` on GitHub, Google and GitLab's
 * /user) — only the two fields the session needs are extracted. When the
 * userinfo payload has no e-mail and the provider configures `emailsUrl`,
 * the fallback endpoint is queried (GitHub private e-mail addresses).
 * Returns null when the endpoint is not configured or fails.
 */
export async function fetchOAuthUserProfile(
  config: OAuthProviderConfig,
  accessToken: string,
): Promise<OAuthProfile | null> {
  if (!config.userinfoUrl) return null
  const response = await fetch(config.userinfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    cache: "no-store",
  })
  if (!response.ok) return null
  const profile = (await response.json()) as {
    email?: unknown
    name?: unknown
    login?: unknown
  }
  // GitHub omits `name` for many users; fall back to the login handle.
  const name =
    typeof profile.name === "string" && profile.name
      ? profile.name
      : typeof profile.login === "string"
        ? profile.login
        : undefined
  let email = typeof profile.email === "string" && profile.email ? profile.email : undefined
  if (!email) email = await fetchFallbackEmail(config, accessToken)
  return { email, name }
}

/**
 * Deterministic fixture identity for mock providers (NEXT_PUBLIC_MOCK_AUTH
 * dev mode). The e-mail is deliberately on a reserved-looking domain so mock
 * accounts can never collide with — or be mistaken for — a real user.
 */
export function mockOAuthProfile(provider: string): OAuthProfile {
  const label = provider.charAt(0).toUpperCase() + provider.slice(1)
  return {
    email: `${provider}.mock@oauth.spindle.invalid`,
    name: `${label} (mock)`,
  }
}
