import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, ok } from "@/lib/auth/http"
import { getPublicBrandingByKey } from "@/lib/workspace-branding"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const readLimiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const MAX_KEY_LENGTH = 200

/**
 * GET /api/workspaces/brand?slug=<slug> | ?workspace=<id-or-slug>
 *
 * PUBLIC, unauthenticated endpoint that backs branded sign-in pages. Returns
 * only the SAFE subset of workspace branding ({displayName, logoText,
 * accentColor, backgroundColor, logoUrl}) — never internal fields like
 * workspaceSlug or the raw stored record. 404 when the workspace has no
 * branding configured;
 * rate limited via the shared `publicRead` budget.
 */
export async function GET(request: Request) {
  if (!readLimiter.check(clientIp(request))) return authRateLimited()

  const url = new URL(request.url)
  const slug = url.searchParams.get("slug")?.trim() ?? ""
  const workspace = url.searchParams.get("workspace")?.trim() ?? ""

  // Both params share the same semantics: try the stable workspace id
  // first, then fall back to a slug match (ids and slugs live in disjoint
  // namespaces in practice, and a wrong guess simply 404s).
  const key = (slug || workspace).slice(0, MAX_KEY_LENGTH)
  if (!key) {
    return fail(400, "invalid_input", "Provide ?slug= or ?workspace=.")
  }

  const branding = getPublicBrandingByKey(key)
  if (!branding) {
    return fail(404, "not_found", "No branding configured for this workspace.")
  }

  return ok({ branding })
}
