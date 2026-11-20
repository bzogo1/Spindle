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

const MANAGE_ROLES = ["owner", "admin"] as const

const patchSchema = z
  .object({
    role: z.enum(["owner", "admin", "member"]),
  })
  .strict()

type Params = { params: Promise<{ id: string; userId: string }> }

function memberPayload(member: { id: string; name: string | null; email: string }, role: string) {
  return { id: member.id, name: member.name, email: member.email, role }
}

/**
 * PATCH /api/workspaces/[id]/members/[userId] — change a member's role.
 * Body: `{ role: "owner" | "admin" | "member" }`.
 *
 * Requires owner/admin membership up front; the backend then re-checks the
 * finer `canChangeMemberRole` rules (no self-changes, admins manage members
 * only, last owner protected) and returns null when denied. A null result
 * with a known target maps to 403; an unknown `userId` maps to 404. A
 * successful change emits `member.role_changed`.
 */
export async function PATCH(request: Request, { params }: Params) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request rejected.")
  }
  if (!writeLimiter.check(clientIp(request))) return authRateLimited()

  const { id, userId } = await params

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
  const { role } = parsed.data

  const result = await requireWorkspaceRole(request, MANAGE_ROLES, id)
  if (!result.ok) return result.response

  const backend = getAuthBackend()
  const roster = await backend.listWorkspaceMembers(id)
  const target = roster.find((member) => member.user.id === userId)
  if (!target) {
    return fail(404, "not_found", "Member not found in this workspace.")
  }

  const updated = await backend.setWorkspaceMemberRole(result.context.user.id, id, userId, role)
  if (!updated) {
    return fail(403, "forbidden", "Insufficient workspace permissions.")
  }

  recordWorkspaceEvent({
    workspaceId: id,
    type: "member.role_changed",
    actorId: result.context.user.id,
    details: {
      targetUserId: userId,
      from: target.role,
      to: role,
    },
  })

  return ok({
    member: memberPayload(target.user, role),
    role: updated.role,
  })
}

/**
 * DELETE /api/workspaces/[id]/members/[userId] — remove a member from the
 * workspace. Same gating as PATCH: owner/admin up front, then the backend's
 * `canRemoveMember` check decides (null/false → 403, unknown target → 404).
 * Emits `member.removed` on success.
 */
export async function DELETE(request: Request, { params }: Params) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request rejected.")
  }
  if (!writeLimiter.check(clientIp(request))) return authRateLimited()

  const { id, userId } = await params

  const result = await requireWorkspaceRole(request, MANAGE_ROLES, id)
  if (!result.ok) return result.response

  const backend = getAuthBackend()
  const roster = await backend.listWorkspaceMembers(id)
  const target = roster.find((member) => member.user.id === userId)
  if (!target) {
    return fail(404, "not_found", "Member not found in this workspace.")
  }

  const removed = await backend.kickWorkspaceMember(result.context.user.id, id, userId)
  if (!removed) {
    return fail(403, "forbidden", "Insufficient workspace permissions.")
  }

  recordWorkspaceEvent({
    workspaceId: id,
    type: "member.removed",
    actorId: result.context.user.id,
    details: {
      targetUserId: userId,
      role: target.role,
      email: target.user.email,
    },
  })

  return ok({ removed: true, memberId: userId })
}
