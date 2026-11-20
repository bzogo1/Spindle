import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { getAuthBackend } from "@/lib/auth/backend"
import { accessTokenFromRequest, fail, isSameOriginRequest, ok } from "@/lib/auth/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const limiter = createAuthRateLimiter(AUTH_LIMITS.tokenConsume)

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/workspaces/[id]/switch — repoints the caller's session workspace
 * to `id`. The session workspace is resolved server-side per request via
 * `getSessionContext`, so clients must refetch the session afterwards for the
 * new workspace to show up.
 *
 * Non-members get 403 rather than 404: the caller already proved they hold a
 * valid session, and "not a member" must not become a workspace-existence
 * oracle beyond what `GET /api/workspaces` already reveals.
 */
export async function POST(request: Request, { params }: Params) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request rejected.")
  }
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const access = accessTokenFromRequest(request)
  if (!access) return fail(401, "unauthorized", "Sign in required.")

  const backend = getAuthBackend()
  const user = await backend.getUserById(access.uid)
  if (!user) return fail(401, "unauthorized", "Sign in required.")

  const { id } = await params
  const membership = await backend.switchWorkspace(user.id, id)
  if (!membership) {
    return fail(403, "forbidden", "Not a member of this workspace.")
  }

  return ok({
    workspace: {
      id: membership.workspace.id,
      name: membership.workspace.name,
      slug: membership.workspace.slug,
      role: membership.role,
    },
  })
}
