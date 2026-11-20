import { getAuthBackend } from "@/lib/auth/backend"
import type { WorkspaceMemberInfo } from "@/lib/auth/backend"
import {
  authenticateScimRequest,
  scimError,
  scimJson,
  scimRateLimited,
} from "@/app/api/scim/shared"
import { extractActiveFromPatch, SCIM_BASE_PATH, scimPatchOpSchema, userToScim } from "@/lib/scim"
import { getWorkspaceSettings } from "@/lib/workspace-settings"
import { recordWorkspaceEvent } from "@/lib/workspace-audit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

function findMember(
  members: WorkspaceMemberInfo[],
  userId: string,
): WorkspaceMemberInfo | undefined {
  return members.find((member) => member.user.id === userId)
}

/**
 * GET /api/scim/v2/Users/[id] — fetch one SCIM User resource by user id.
 * Returns 404 when the id is not a member of the token's workspace (the
 * roster is workspace-scoped; there is no cross-workspace User lookup).
 */
export async function GET(request: Request, { params }: Params) {
  const limited = scimRateLimited(request)
  if (limited) return limited

  const auth = authenticateScimRequest(request)
  if (!auth.ok) return auth.response

  const { id } = await params
  const backend = getAuthBackend()
  const members = await backend.listWorkspaceMembers(auth.workspaceId)
  const member = findMember(members, id)
  if (!member) {
    return scimError(404, "User not found.")
  }

  return scimJson(userToScim(member, SCIM_BASE_PATH))
}

async function readJsonBody(
  request: Request,
): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  try {
    return { ok: true, body: await request.json() }
  } catch {
    return { ok: false, response: scimError(400, "Request body must be valid JSON.") }
  }
}

/**
 * PATCH /api/scim/v2/Users/[id] — the documented subset toggles `active`:
 *  - `active: false` deprovisions (removes workspace membership) → 204
 *  - `active: true` (re)provisions at the workspace `defaultJoinRole` → 200
 *    with the updated User resource
 *
 * Other PatchOp forms return 400 rather than silently no-op'ing, and
 * operations targeting non-members return 404.
 */
export async function PATCH(request: Request, { params }: Params) {
  const limited = scimRateLimited(request)
  if (limited) return limited

  const auth = authenticateScimRequest(request)
  if (!auth.ok) return auth.response

  const { id } = await params
  const parsedBody = await readJsonBody(request)
  if (!parsedBody.ok) return parsedBody.response

  const patch = scimPatchOpSchema.safeParse(parsedBody.body)
  if (!patch.success) {
    return scimError(400, "Invalid PATCH body. Expected a SCIM PatchOp.")
  }
  const active = extractActiveFromPatch(patch.data.Operations)
  if (!active.found) {
    return scimError(400, "Unsupported PATCH operations. Only `active` toggles are supported.")
  }

  const backend = getAuthBackend()
  const members = await backend.listWorkspaceMembers(auth.workspaceId)
  const member = findMember(members, id)

  if (!active.active) {
    if (!member) {
      return scimError(404, "User not found.")
    }
    await backend.removeWorkspaceMember(id, auth.workspaceId)
    recordWorkspaceEvent({
      workspaceId: auth.workspaceId,
      type: "scim.user_deprovisioned",
      actorId: null,
      details: {
        userId: id,
        userName: member.user.email,
        scimTokenId: auth.tokenId,
      },
    })
    return new Response(null, { status: 204 })
  }

  // active: true — idempotent when already a member.
  if (member) {
    return scimJson(userToScim(member, SCIM_BASE_PATH))
  }

  const user = await backend.getUserById(id)
  if (!user) {
    return scimError(404, "User not found.")
  }
  const workspace = await backend.getWorkspace(auth.workspaceId)
  if (!workspace) {
    return scimError(404, "Workspace not found.")
  }
  const role = getWorkspaceSettings(auth.workspaceId).defaultJoinRole
  await backend.addWorkspaceMember({ userId: user.id, workspace, role })

  recordWorkspaceEvent({
    workspaceId: auth.workspaceId,
    type: "scim.user_provisioned",
    actorId: null,
    details: {
      userId: user.id,
      userName: user.email,
      email: user.email,
      role,
      scimTokenId: auth.tokenId,
    },
  })

  const provisioned: WorkspaceMemberInfo = { user, role }
  return scimJson(userToScim(provisioned, SCIM_BASE_PATH))
}

/**
 * DELETE /api/scim/v2/Users/[id] — deprovision: removes the user's
 * workspace membership. The global account is untouched (other workspaces
 * keep their membership). Returns 204, or 404 when the user is not a
 * member of this workspace.
 */
export async function DELETE(request: Request, { params }: Params) {
  const limited = scimRateLimited(request)
  if (limited) return limited

  const auth = authenticateScimRequest(request)
  if (!auth.ok) return auth.response

  const { id } = await params
  const backend = getAuthBackend()
  const members = await backend.listWorkspaceMembers(auth.workspaceId)
  const member = findMember(members, id)
  if (!member) {
    return scimError(404, "User not found.")
  }

  await backend.removeWorkspaceMember(id, auth.workspaceId)
  recordWorkspaceEvent({
    workspaceId: auth.workspaceId,
    type: "scim.user_deprovisioned",
    actorId: null,
    details: {
      userId: id,
      userName: member.user.email,
      scimTokenId: auth.tokenId,
    },
  })
  return new Response(null, { status: 204 })
}
