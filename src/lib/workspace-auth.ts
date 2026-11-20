import type { NextResponse } from "next/server"

import { getAuthBackend } from "@/lib/auth/backend"
import type { AuthUser, WorkspaceMembership } from "@/lib/auth/backend"
import { accessTokenFromRequest, fail } from "@/lib/auth/http"

/**
 * Shared request-scoping helper for workspace-scoped API routes.
 *
 * Every `/api/workspaces/...` handler needs the same steps: verify the
 * `spindle_at` access token, load the user row, and confirm membership in
 * the target workspace. Centralizing it keeps authorization consistent —
 * routes get a typed `{ user, membership }` and can trust
 * `membership.role`, which always comes from the backend roster (never the
 * request body).
 *
 * Workspace selection: pass `workspaceId` (route param or `?workspace=`) to
 * target a specific workspace; omit it to use the session's active
 * workspace (what `GET /api/auth/session` reports), falling back to the
 * user's first membership.
 *
 * Mutating routes must still call `isSameOriginRequest(request)` themselves
 * — this helper only resolves identity/membership.
 */

export type WorkspaceContext = {
  user: AuthUser
  membership: WorkspaceMembership
}

export type WorkspaceContextResult =
  { ok: true; context: WorkspaceContext } | { ok: false; response: NextResponse }

export async function requireWorkspaceContext(
  request: Request,
  workspaceId?: string | null,
): Promise<WorkspaceContextResult> {
  const access = accessTokenFromRequest(request)
  if (!access) {
    return { ok: false, response: fail(401, "unauthorized", "Sign in required.") }
  }

  const backend = getAuthBackend()
  const user = await backend.getUserById(access.uid)
  if (!user) {
    return { ok: false, response: fail(401, "unauthorized", "Sign in required.") }
  }

  const memberships = await backend.listWorkspaceMemberships(user.id)
  if (memberships.length === 0) {
    return {
      ok: false,
      response: fail(403, "forbidden", "You do not belong to any workspace."),
    }
  }

  let membership: WorkspaceMembership | undefined
  if (workspaceId) {
    membership = memberships.find((m) => m.workspace.id === workspaceId)
  } else {
    const session = await backend.getSessionContext(user.id)
    const activeId = session?.workspace?.id
    membership =
      (activeId ? memberships.find((m) => m.workspace.id === activeId) : undefined) ??
      memberships[0]
  }

  if (!membership) {
    return {
      ok: false,
      response: fail(403, "forbidden", "Not a member of this workspace."),
    }
  }

  return { ok: true, context: { user, membership } }
}

/**
 * Like {@link requireWorkspaceContext} but additionally requires one of
 * `roles`. Returns 403 (not 404) for members lacking the role so the UI can
 * show "insufficient permissions" rather than "not found".
 */
export async function requireWorkspaceRole(
  request: Request,
  roles: readonly WorkspaceMembership["role"][],
  workspaceId?: string | null,
): Promise<WorkspaceContextResult> {
  const result = await requireWorkspaceContext(request, workspaceId)
  if (!result.ok) return result
  if (!roles.includes(result.context.membership.role)) {
    return {
      ok: false,
      response: fail(403, "forbidden", "Insufficient workspace permissions."),
    }
  }
  return result
}
