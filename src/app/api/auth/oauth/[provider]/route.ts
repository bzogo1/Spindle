import { fail, ok } from "@/lib/auth/http"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { getOAuthProvider } from "@/lib/auth/oauth-providers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Public read endpoint: hit once per sign-in click, so a lenient per-IP
// budget is enough to blunt scraping/abuse without affecting real users.
const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

type Params = { params: Promise<{ provider: string }> }

/**
 * GET /api/auth/oauth/[provider] — public provider configuration for the
 * client-side PKCE flow. Returns only non-secret values; the client builds
 * the authorize URL and keeps the code verifier in sessionStorage.
 *
 * For synthetic mock providers (NEXT_PUBLIC_MOCK_AUTH dev mode) the
 * authorize URL is a same-origin bounce on /api/auth/oauth/callback that
 * immediately redirects back to /oauth/callback with a mock code — the rest
 * of the flow (PKCE state check, session cookies) runs unchanged.
 */
export async function GET(request: Request, { params }: Params) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const { provider } = await params
  const config = getOAuthProvider(provider)
  if (!config) return fail(404, "unknown_provider", "This sign-in provider is not configured.")

  const origin = new URL(request.url).origin
  const authorizeUrl = config.mock
    ? `${origin}/api/auth/oauth/callback?mock_authorize=${encodeURIComponent(config.name)}`
    : config.authorizeUrl

  return ok({
    provider: config.name,
    clientId: config.clientId,
    authorizeUrl,
    scopes: config.scopes,
    redirectUri: `${origin}/oauth/callback`,
  })
}
