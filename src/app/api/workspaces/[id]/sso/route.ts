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
  getWorkspaceSsoConfig,
  maskWorkspaceSsoConfig,
  updateWorkspaceSsoConfig,
  workspaceSsoConfigPatchSchema,
} from "@/lib/workspace-sso"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const readLimiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)
const writeLimiter = createAuthRateLimiter(AUTH_LIMITS.tokenConsume)

const MANAGE_ROLES = ["owner", "admin"] as const

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/workspaces/[id]/sso — the workspace SSO configuration.
 *
 * Owner/admin only: even though the store never holds secrets, endpoint and
 * entity URLs can reveal IdP infrastructure details, so the response is
 * masked via {@link maskWorkspaceSsoConfig} (origins kept, paths hidden).
 * NOTE: this is configuration storage only — no SAML/OIDC protocol flow is
 * implemented yet, so `enabled`/`enforced` currently have no auth effect.
 */
export async function GET(request: Request, { params }: Params) {
  if (!readLimiter.check(clientIp(request))) return authRateLimited()

  const { id } = await params
  const result = await requireWorkspaceRole(request, MANAGE_ROLES, id)
  if (!result.ok) return result.response

  return ok({
    role: result.context.membership.role,
    config: maskWorkspaceSsoConfig(getWorkspaceSsoConfig(id)),
  })
}

/**
 * PUT/PATCH /api/workspaces/[id]/sso — validated partial update of the SSO
 * config. Owner/admin only; same-origin + rate limited. Emits
 * `workspace.sso_config_updated` after every successful write, plus
 * `workspace.sso_enabled` / `workspace.sso_disabled` on enabled transitions.
 */
async function updateSso(request: Request, { params }: Params) {
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
  const parsed = workspaceSsoConfigPatchSchema.safeParse(body)
  if (!parsed.success) {
    return fail(400, "invalid_input", parsed.error.issues[0]?.message ?? "Invalid input.")
  }
  if (Object.keys(parsed.data).length === 0) {
    return fail(400, "invalid_input", "No SSO settings to update.")
  }

  const result = await requireWorkspaceRole(request, MANAGE_ROLES, id)
  if (!result.ok) return result.response

  const previous = getWorkspaceSsoConfig(id)
  const config = updateWorkspaceSsoConfig(id, parsed.data)

  recordWorkspaceEvent({
    workspaceId: id,
    type: "workspace.sso_config_updated",
    actorId: result.context.user.id,
    details: {
      changed: Object.keys(parsed.data),
      enabled: config.enabled,
      enforced: config.enforced,
      provider: config.provider,
    },
  })
  if (!previous.enabled && config.enabled) {
    recordWorkspaceEvent({
      workspaceId: id,
      type: "workspace.sso_enabled",
      actorId: result.context.user.id,
      details: { provider: config.provider, enforced: config.enforced },
    })
  } else if (previous.enabled && !config.enabled) {
    recordWorkspaceEvent({
      workspaceId: id,
      type: "workspace.sso_disabled",
      actorId: result.context.user.id,
      details: { provider: config.provider },
    })
  }

  return ok({ role: result.context.membership.role, config: maskWorkspaceSsoConfig(config) })
}

export async function PUT(request: Request, context: Params) {
  return updateSso(request, context)
}

export async function PATCH(request: Request, context: Params) {
  return updateSso(request, context)
}
