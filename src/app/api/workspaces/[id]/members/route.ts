import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { getAuthBackend } from "@/lib/auth/backend"
import { ok } from "@/lib/auth/http"
import { canManageMembers } from "@/lib/members/permissions"
import { requireWorkspaceContext } from "@/lib/workspace-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const readLimiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/workspaces/[id]/members — the workspace roster plus the caller's
 * role and a coarse `canManage` flag. Any member may read the roster; the
 * screen re-checks the finer per-member rules client-side with the pure
 * helpers in `src/lib/members/permissions` (and the mutating routes
 * re-check them server-side via the backend).
 */
export async function GET(request: Request, { params }: Params) {
  if (!readLimiter.check(clientIp(request))) return authRateLimited()

  const { id } = await params
  const result = await requireWorkspaceContext(request, id)
  if (!result.ok) return result.response

  const backend = getAuthBackend()
  const members = await backend.listWorkspaceMembers(id)

  return ok({
    role: result.context.membership.role,
    userId: result.context.user.id,
    canManage: canManageMembers(result.context.membership.role),
    members: members.map(({ user, role }) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role,
      // Account creation is the only timestamp the roster carries; shown as
      // "joined" context in the UI.
      joinedAt: user.createdAt,
    })),
  })
}
