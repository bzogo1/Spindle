import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { requireWorkspaceContext, requireWorkspaceRole } from "@/lib/workspace-auth"
import { recordWorkspaceEvent } from "@/lib/workspace-audit"
import {
  getWorkspaceSettings,
  updateWorkspaceSettings,
  workspaceSettingsSchema,
} from "@/lib/workspace-settings"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const readLimiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)
const writeLimiter = createAuthRateLimiter(AUTH_LIMITS.tokenConsume)

const MANAGE_ROLES = ["owner", "admin"] as const

const settingsPatchSchema = workspaceSettingsSchema.partial().strict()

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/workspaces/[id]/settings — the workspace settings blob. Any
 * member may read it; write access is owner/admin only (see PUT/PATCH).
 */
export async function GET(request: Request, { params }: Params) {
  if (!readLimiter.check(clientIp(request))) return authRateLimited()

  const { id } = await params
  const result = await requireWorkspaceContext(request, id)
  if (!result.ok) return result.response

  return ok({ settings: getWorkspaceSettings(id) })
}

/**
 * PUT/PATCH /api/workspaces/[id]/settings — validated partial update of the
 * workspace settings. Owner/admin only; emits `workspace.settings_updated`
 * after the store write succeeds.
 */
async function updateSettings(request: Request, { params }: Params) {
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
  const parsed = settingsPatchSchema.safeParse(body)
  if (!parsed.success) {
    return fail(400, "invalid_input", parsed.error.issues[0]?.message ?? "Invalid input.")
  }
  if (Object.keys(parsed.data).length === 0) {
    return fail(400, "invalid_input", "No settings to update.")
  }

  const result = await requireWorkspaceRole(request, MANAGE_ROLES, id)
  if (!result.ok) return result.response

  const settings = updateWorkspaceSettings(id, parsed.data)
  recordWorkspaceEvent({
    workspaceId: id,
    type: "workspace.settings_updated",
    actorId: result.context.user.id,
    details: { settings },
  })

  return ok({ settings })
}

export async function PUT(request: Request, context: Params) {
  return updateSettings(request, context)
}

export async function PATCH(request: Request, context: Params) {
  return updateSettings(request, context)
}
