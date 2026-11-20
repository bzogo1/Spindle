import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { revokeScimToken } from "@/lib/scim-tokens"
import { requireWorkspaceRole } from "@/lib/workspace-auth"
import { recordWorkspaceEvent } from "@/lib/workspace-audit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const writeLimiter = createAuthRateLimiter(AUTH_LIMITS.tokenConsume)

const MANAGE_ROLES = ["owner", "admin"] as const

type Params = { params: Promise<{ id: string; tokenId: string }> }

/**
 * DELETE /api/workspaces/[id]/scim-tokens/[tokenId] — revokes a SCIM bearer
 * token. Owner/admin only; same-origin + rate limited. `revokeScimToken` is
 * workspace-scoped, so foreign or unknown ids return 404 without leaking
 * whether the token exists elsewhere. Emits `workspace.scim_token_revoked`.
 */
export async function DELETE(request: Request, { params }: Params) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request rejected.")
  }
  if (!writeLimiter.check(clientIp(request))) return authRateLimited()

  const { id, tokenId } = await params
  const result = await requireWorkspaceRole(request, MANAGE_ROLES, id)
  if (!result.ok) return result.response

  if (!revokeScimToken(id, tokenId)) {
    return fail(404, "not_found", "SCIM token not found.")
  }

  recordWorkspaceEvent({
    workspaceId: id,
    type: "workspace.scim_token_revoked",
    actorId: result.context.user.id,
    details: { tokenId },
  })

  return ok()
}
