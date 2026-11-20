import { z } from "zod"

import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { AuthBackendError, getAuthBackend } from "@/lib/auth/backend"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { requireWorkspaceContext, requireWorkspaceRole } from "@/lib/workspace-auth"
import { recordWorkspaceEvent } from "@/lib/workspace-audit"
import {
  getWorkspaceSettings,
  updateWorkspaceSettings,
  workspaceSettingsSchema,
  type WorkspaceSettings,
} from "@/lib/workspace-settings"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const readLimiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)
const writeLimiter = createAuthRateLimiter(AUTH_LIMITS.tokenConsume)

const MANAGE_ROLES = ["owner", "admin"] as const

const patchSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required.").max(80, "Name is too long.").optional(),
    settings: workspaceSettingsSchema.partial().strict().optional(),
  })
  .strict()

type Params = { params: Promise<{ id: string }> }

function workspacePayload(workspace: { id: string; name: string; slug: string }) {
  return { id: workspace.id, name: workspace.name, slug: workspace.slug }
}

/**
 * GET /api/workspaces/[id] — workspace info, the caller's role, the member
 * count, and the workspace settings blob. Any member may read; the settings
 * screen uses `role` to decide whether to render editable controls.
 */
export async function GET(request: Request, { params }: Params) {
  if (!readLimiter.check(clientIp(request))) return authRateLimited()

  const { id } = await params
  const result = await requireWorkspaceContext(request, id)
  if (!result.ok) return result.response

  const backend = getAuthBackend()
  const [workspace, members] = await Promise.all([
    backend.getWorkspace(id),
    backend.listWorkspaceMembers(id),
  ])
  if (!workspace) return fail(404, "not_found", "Workspace not found.")

  return ok({
    workspace: workspacePayload(workspace),
    role: result.context.membership.role,
    memberCount: members.length,
    settings: getWorkspaceSettings(id),
  })
}

/**
 * PATCH /api/workspaces/[id] — partial update. Body:
 * `{ name?: string, settings?: Partial<WorkspaceSettings> }`.
 *
 * Both fields require owner/admin. The rename goes through
 * `backend.updateWorkspace` (which re-checks the actor's role and returns
 * null when denied); settings updates go through the in-memory
 * `updateWorkspaceSettings` seam after an explicit role check. Successful
 * mutations emit `workspace.renamed` / `workspace.settings_updated` audit
 * events.
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
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return fail(400, "invalid_input", parsed.error.issues[0]?.message ?? "Invalid input.")
  }
  const { name, settings } = parsed.data
  if (name === undefined && settings === undefined) {
    return fail(400, "invalid_input", "Nothing to update.")
  }

  const result = await requireWorkspaceRole(request, MANAGE_ROLES, id)
  if (!result.ok) return result.response
  const { user, membership } = result.context

  const backend = getAuthBackend()
  const existing = await backend.getWorkspace(id)
  if (!existing) return fail(404, "not_found", "Workspace not found.")

  let workspace = existing
  if (name !== undefined) {
    let renamed
    try {
      renamed = await backend.updateWorkspace(user.id, id, { name })
    } catch (error) {
      if (error instanceof AuthBackendError && error.code === "invalid_input") {
        return fail(400, "invalid_input", error.message)
      }
      throw error
    }
    if (!renamed) {
      return fail(403, "forbidden", "Insufficient workspace permissions.")
    }
    recordWorkspaceEvent({
      workspaceId: id,
      type: "workspace.renamed",
      actorId: user.id,
      details: { from: existing.name, to: renamed.name },
    })
    workspace = renamed
  }

  let nextSettings: WorkspaceSettings = getWorkspaceSettings(id)
  if (settings !== undefined) {
    nextSettings = updateWorkspaceSettings(id, settings)
    recordWorkspaceEvent({
      workspaceId: id,
      type: "workspace.settings_updated",
      actorId: user.id,
      details: { settings: nextSettings },
    })
  }

  return ok({
    workspace: workspacePayload(workspace),
    role: membership.role,
    settings: nextSettings,
  })
}
