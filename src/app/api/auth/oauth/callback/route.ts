import { getAuthBackend } from "@/lib/auth/backend"
import { applyAuthCookies, fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import {
  exchangeAuthorizationCode,
  fetchOAuthUserProfile,
  mockOAuthProfile,
  type OAuthProfile,
} from "@/lib/auth/oauth/token-exchange"
import { getOAuthProvider, mockOAuthEnabled } from "@/lib/auth/oauth-providers"
import { evaluateSuccessfulSignIn } from "@/lib/auth/login-alerts"
import { oauthCallbackSchema } from "@/lib/auth/schemas"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { logger } from "@/lib/logger"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// POST exchanges the authorization code — a token-consumption endpoint.
const limiter = createAuthRateLimiter(AUTH_LIMITS.tokenConsumeFast)
// GET is the dev-only mock-authorize bounce: a cheap redirect, but still
// rate-limited per IP so it cannot be used as an open redirect loop.
const mockAuthorizeLimiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

/**
 * GET /api/auth/oauth/callback?mock_authorize=<provider> — mock-mode bounce.
 *
 * Only reachable for synthetic providers injected when NEXT_PUBLIC_MOCK_AUTH=1
 * (see oauth-providers.ts). GET /api/auth/oauth/[provider] points the
 * authorize URL here; the browser lands on this route carrying the PKCE
 * `state` the client generated, and we bounce straight back to
 * /oauth/callback with a fixture `code`. State validation still happens
 * client-side in `consumePendingOAuthFlow` — this route never sees a real
 * provider redirect, so there is nothing to verify server-side.
 */
export async function GET(request: Request) {
  if (!mockAuthorizeLimiter.check(clientIp(request))) return authRateLimited()
  if (!mockOAuthEnabled()) {
    return fail(404, "unknown_provider", "This sign-in provider is not configured.")
  }
  const url = new URL(request.url)
  const provider = url.searchParams.get("mock_authorize")
  const state = url.searchParams.get("state")
  if (!provider || !state) {
    return fail(400, "invalid_request", "Invalid mock authorize request.")
  }
  const config = getOAuthProvider(provider)
  if (!config?.mock) {
    return fail(404, "unknown_provider", "This sign-in provider is not configured.")
  }

  const target = new URL("/oauth/callback", url.origin)
  target.searchParams.set("code", `mock-${provider}`)
  target.searchParams.set("state", state)
  target.searchParams.set("provider", provider)
  return Response.redirect(target.toString(), 302)
}

/**
 * POST /api/auth/oauth/callback — exchanges the authorization code (with the
 * client-held PKCE verifier) for tokens, resolves the provider profile, and
 * issues a session. `redirectUri` must match the value used at authorize time
 * (enforced by the provider).
 *
 * Mock providers skip the exchange/profile calls entirely and resolve a
 * fixture identity, so the whole sign-in works in dev without registering an
 * OAuth app.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return fail(403, "forbidden", "Cross-origin request blocked.")
  if (!limiter.check(clientIp(request))) return authRateLimited()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Invalid request body.")
  }
  const parsed = oauthCallbackSchema.safeParse(body)
  if (!parsed.success) return fail(400, "invalid_request", "Invalid request body.")

  const config = getOAuthProvider(parsed.data.provider)
  if (!config) return fail(404, "unknown_provider", "This sign-in provider is not configured.")

  let profile: OAuthProfile | null
  if (config.mock) {
    profile = mockOAuthProfile(config.name)
  } else {
    let tokenResponse
    try {
      tokenResponse = await exchangeAuthorizationCode(config, {
        code: parsed.data.code,
        redirectUri: parsed.data.redirectUri,
        codeVerifier: parsed.data.codeVerifier,
      })
    } catch {
      tokenResponse = null
    }
    if (!tokenResponse?.access_token) {
      return fail(401, "oauth_failed", "Sign-in with the provider failed. Try again.")
    }

    try {
      profile = await fetchOAuthUserProfile(config, tokenResponse.access_token)
    } catch {
      profile = null
    }
  }
  if (!profile?.email) {
    return fail(401, "oauth_failed", "The provider did not return an email address.")
  }

  const backend = getAuthBackend()
  const { user } = await backend.upsertOAuthUser({
    email: profile.email,
    name: profile.name ?? null,
    provider: config.name,
  })
  const tokens = await backend.createSessionForUser(user.id)

  evaluateSuccessfulSignIn({
    userId: user.id,
    email: user.email,
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  })
  logger.info(
    { event: "auth.oauth.signin", provider: config.name, userId: user.id, mock: config.mock },
    "OAuth sign-in.",
  )
  // `remember: true` is deliberate: like magic-link sign-in
  // (passwordless/verify) and session refresh, the OAuth buttons offer no
  // "keep me signed in" checkbox, and oauthCallbackSchema (schemas.ts) has
  // no remember field to thread through. The refresh cookie therefore gets
  // the full 30-day Max-Age, matching the other single-click flows.
  return applyAuthCookies(ok({ session: tokens.session }), tokens, { remember: true })
}
