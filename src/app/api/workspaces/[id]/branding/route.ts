import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { requireWorkspaceRole } from "@/lib/workspace-auth"
import { recordWorkspaceEvent } from "@/lib/workspace-audit"
import {
  getWorkspaceBranding,
  toPublicBranding,
  updateWorkspaceBranding,
  workspaceBrandingPatchSchema,
} from "@/lib/workspace-branding"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const readLimiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)
const writeLimiter = createAuthRateLimiter(AUTH_LIMITS.tokenConsume)

const MANAGE_ROLES = ["owner", "admin"] as const

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/workspaces/[id]/branding — the workspace branding record.
 * Owner/admin only: branding is cosmetic, but the management surface is
 * gated the same way as SSO/settings writes so members can't probe it.
 * Returns the full stored record (slug + captured workspace name included)
 * so the admin UI can show exactly what was saved.
 */
export async function GET(request: Request, { params }: Params) {
  if (!readLimiter.check(clientIp(request))) return authRateLimited()

  const { id } = await params
  const result = await requireWorkspaceRole(request, MANAGE_ROLES, id)
  if (!result.ok) return result.response

  const branding = getWorkspaceBranding(id)
  return ok({
    role: result.context.membership.role,
    branding: branding ?? null,
    publicBranding: branding ? toPublicBranding(branding) : null,
  })
}

/**
 * PATCH /api/workspaces/[id]/branding — validated partial update of the
 * workspace branding. Owner/admin only; same-origin + rate limited. Captures
 * the workspace slug/name from the membership roster so the public brand
 * endpoint and sign-in page can resolve the record by slug. Emits
 * `workspace.branding_updated` after the store write succeeds.
 */
export async function PATCH(request: Request, { params }: Params) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request rejected.")
  }
  if (!writeLimiter.check(clientIp(request))) return authRateLimited()

  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_input", "Invalid request body.")
  }
  const parsed = workspaceBrandingPatchSchema.safeParse(body)
  if (!parsed.success) {
    return fail(400, "invalid_input", parsed.error.issues[0]?.message ?? "Invalid input.")
  }
  if (Object.keys(parsed.data).length === 0) {
    return fail(400, "invalid_input", "No branding fields to update.")
  }

  const result = await requireWorkspaceRole(request, MANAGE_ROLES, id)
  if (!result.ok) return result.response

  const workspace = result.context.membership.workspace
  const branding = updateWorkspaceBranding(id, workspace.slug, parsed.data, workspace.name)

  recordWorkspaceEvent({
    workspaceId: id,
    type: "workspace.branding_updated",
    actorId: result.context.user.id,
    details: { changed: Object.keys(parsed.data) },
  })

  return ok({ role: result.context.membership.role, branding })
}
