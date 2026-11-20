import { z } from "zod"

import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { getAuthBackend } from "@/lib/auth/backend"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { requireWorkspaceRole } from "@/lib/workspace-auth"
import { recordWorkspaceEvent } from "@/lib/workspace-audit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const writeLimiter = createAuthRateLimiter(AUTH_LIMITS.tokenConsume)

const deleteSchema = z
  .object({
    confirmation: z.string().min(1, "Confirmation is required.").max(200),
  })
  .strict()

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/workspaces/[id]/delete — permanently delete a workspace.
 *
 * Owner-only and destructive: the caller must echo the workspace name back
 * in `confirmation` (type-to-confirm). On success the backend removes the
 * workspace and every membership; sessions whose active workspace was
 * deleted fall back to the user's home workspace. A `workspace.deleted`
 * audit event is emitted AFTER the delete — the audit store is keyed by
 * workspaceId and survives membership removal.
 */
export async function POST(request: Request, { params }: Params) {
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
  const parsed = deleteSchema.safeParse(body)
  if (!parsed.success) {
    return fail(400, "invalid_input", parsed.error.issues[0]?.message ?? "Invalid input.")
  }

  const result = await requireWorkspaceRole(request, ["owner"], id)
  if (!result.ok) return result.response
  const { user } = result.context

  const backend = getAuthBackend()
  const workspace = await backend.getWorkspace(id)
  if (!workspace) return fail(404, "not_found", "Workspace not found.")

  if (parsed.data.confirmation !== workspace.name) {
    return fail(400, "invalid_input", "Confirmation does not match the workspace name.")
  }

  const deleted = await backend.deleteWorkspace(user.id, id)
  if (!deleted) {
    return fail(403, "forbidden", "Only the workspace owner can delete it.")
  }

  recordWorkspaceEvent({
    workspaceId: id,
    type: "workspace.deleted",
    actorId: user.id,
    details: { name: workspace.name, slug: workspace.slug },
  })

  return ok({ deleted: true })
}
