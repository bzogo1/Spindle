import { z } from "zod"

import { getAuthBackend } from "@/lib/auth/backend"
import { evaluateSuccessfulSignIn } from "@/lib/auth/login-alerts"
import { applyAuthCookies, fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { mockOAuthEnabled } from "@/lib/auth/oauth-providers"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { getWorkspaceSettings } from "@/lib/workspace-settings"
import {
  buildAuthnRequestUrl,
  devAssertionSecret,
  generateNonce,
  generateState,
  verifyDevAssertion,
} from "@/lib/workspace-sso-protocol"
import { getWorkspaceSsoConfig } from "@/lib/workspace-sso"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET is a cheap redirect-URL builder; POST consumes a login assertion, so it
// shares the strict token-consumption budget with OAuth callback / magic link.
const readLimiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)
const consumeLimiter = createAuthRateLimiter(AUTH_LIMITS.tokenConsumeFast)

type Params = { params: Promise<{ workspaceId: string }> }

const devAssertionBodySchema = z
  .object({
    email: z.string().trim().email().max(320),
    name: z.string().trim().max(200).optional(),
    /** 64-char hex HMAC-SHA256 dev assertion — see workspace-sso-protocol.ts. */
    assertion: z
      .string()
      .trim()
      .regex(/^[0-9a-f]{64}$/i),
  })
  .strict()

/**
 * GET /api/auth/sso/[workspaceId] — returns the IdP redirect URL for
 * SP/OP-initiated SSO.
 *
 * SAML gets an unsigned AuthnRequest scaffold; OIDC gets a full authorize URL
 * (state + nonce). `devMode: true` is always returned because no real IdP
 * exchange exists yet — see workspace-sso-protocol.ts for the documented
 * follow-ups. `state` is echoed for OIDC so the client can verify the return.
 */
export async function GET(request: Request, { params }: Params) {
  if (!readLimiter.check(clientIp(request))) return authRateLimited()

  const { workspaceId } = await params
  const config = getWorkspaceSsoConfig(workspaceId)
  if (!config.enabled || config.provider === "none") {
    return fail(404, "sso_not_configured", "Single sign-on is not configured for this workspace.")
  }

  const origin = new URL(request.url).origin
  const state = config.provider === "oidc" ? generateState() : undefined
  const nonce = config.provider === "oidc" ? generateNonce() : undefined
  const redirectUrl = buildAuthnRequestUrl(config, {
    workspaceId,
    acsUrl: `${origin}/api/auth/sso/${workspaceId}`,
    redirectUri: `${origin}/api/auth/sso/${workspaceId}`,
    state,
    nonce,
  })
  if (!redirectUrl) {
    return fail(
      503,
      "sso_misconfigured",
      "Single sign-on is not fully configured for this workspace.",
    )
  }

  return ok({
    redirectUrl,
    provider: config.provider,
    devMode: true,
    ...(state ? { state } : {}),
  })
}

/**
 * POST /api/auth/sso/[workspaceId] — DEV-MODE assertion login.
 *
 * Accepts `{email, name?, assertion}` where `assertion` is an HMAC-SHA256
 * "signature" keyed by the per-workspace derived secret
 * (`devAssertionSecret`). This is NOT real SAML/OIDC validation — it exists so
 * the full pipeline (assertion → domain allowlist → upsertOAuthUser →
 * addWorkspaceMember → createSessionForUser → auth cookies) is exercisable in
 * dev. Gated behind `mockOAuthEnabled()` (NEXT_PUBLIC_MOCK_AUTH=1, never in
 * production); real signature verification is a documented follow-up.
 *
 * Same-origin enforced like /api/auth/oauth/callback (this endpoint is called
 * by our own client, not by an IdP redirect). Errors are generic — no account
 * or domain enumeration.
 */
export async function POST(request: Request, { params }: Params) {
  if (!isSameOriginRequest(request)) return fail(403, "forbidden", "Cross-origin request blocked.")
  if (!consumeLimiter.check(clientIp(request))) return authRateLimited()
  if (!mockOAuthEnabled()) {
    return fail(404, "sso_not_configured", "Single sign-on is not configured for this workspace.")
  }

  const { workspaceId } = await params
  const config = getWorkspaceSsoConfig(workspaceId)
  if (!config.enabled || config.provider === "none") {
    return fail(404, "sso_not_configured", "Single sign-on is not configured for this workspace.")
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Invalid request body.")
  }
  const parsed = devAssertionBodySchema.safeParse(body)
  if (!parsed.success) return fail(400, "invalid_request", "Invalid request body.")
  const { email, name, assertion } = parsed.data

  const secret = devAssertionSecret(workspaceId, config.entityId)
  const genericFailure = () =>
    fail(401, "sso_login_failed", "Sign-in failed. Check your credentials and try again.")

  if (
    !verifyDevAssertion({
      workspaceId,
      email,
      name: name ?? null,
      assertion,
      secret,
    })
  ) {
    return genericFailure()
  }

  // Domain allowlist: only enforced when the workspace configured one.
  // Same generic error so the allowlist contents are not enumerable.
  if (config.allowedDomains.length > 0) {
    const domain = email.split("@")[1]?.toLowerCase()
    if (!domain || !config.allowedDomains.includes(domain)) {
      return genericFailure()
    }
  }

  const backend = getAuthBackend()
  const workspace = await backend.getWorkspace(workspaceId)
  if (!workspace) {
    return fail(404, "sso_not_configured", "Single sign-on is not configured for this workspace.")
  }

  const { user } = await backend.upsertOAuthUser({
    email,
    name: name ?? null,
    provider: config.provider,
  })

  // Join (or refresh membership in) the SSO workspace at the configured
  // default join role before issuing the session so the session's active
  // workspace points at it.
  const joinRole = getWorkspaceSettings(workspaceId).defaultJoinRole
  await backend.addWorkspaceMember({
    userId: user.id,
    workspace,
    role: joinRole === "admin" ? "admin" : "member",
  })

  const tokens = await backend.createSessionForUser(user.id)

  evaluateSuccessfulSignIn({
    userId: user.id,
    email: user.email,
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  })

  return applyAuthCookies(ok({ session: tokens.session }), tokens, { remember: true })
}
