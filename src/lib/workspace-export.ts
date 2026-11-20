import { getAuthBackend } from "@/lib/auth/backend"
import type { WorkspaceMemberInfo } from "@/lib/auth/backend"
import type { WorkspaceRole } from "@/lib/members/permissions"
import type { WorkspaceSettings } from "@/lib/workspace-settings"
import { getWorkspaceSettings } from "@/lib/workspace-settings"

/**
 * Workspace data export — DEVELOPMENT seam.
 *
 * `buildWorkspaceExport` assembles a JSON-serializable snapshot of one
 * workspace: identity, settings, and the member roster. It only reflects
 * the in-memory auth backend and settings store — it does NOT include
 * sessions, audit events, credentials, tokens, or any persisted
 * production data (there is none yet). Production MUST wire this to real
 * data sources before exposing it to users.
 *
 * Member entries deliberately carry only `{ id, email, name }` — no
 * password hashes, verification flags, or session state.
 */
export type WorkspaceExportMember = {
  user: { id: string; email: string; name: string | null }
  role: WorkspaceRole
}

export type WorkspaceExport = {
  /** ISO timestamp when the export was generated. */
  exportedAt: string
  workspace: { id: string; name: string; slug: string }
  settings: WorkspaceSettings
  members: WorkspaceExportMember[]
}

function toExportMember(member: WorkspaceMemberInfo): WorkspaceExportMember {
  return {
    user: {
      id: member.user.id,
      email: member.user.email,
      name: member.user.name,
    },
    role: member.role,
  }
}

/**
 * Builds the export payload for `workspaceId`. Returns `null` when the
 * workspace does not exist. `now` is injectable for deterministic tests.
 */
export async function buildWorkspaceExport(
  workspaceId: string,
  now?: number,
): Promise<WorkspaceExport | null> {
  const backend = getAuthBackend()
  const [workspace, members] = await Promise.all([
    backend.getWorkspace(workspaceId),
    backend.listWorkspaceMembers(workspaceId),
  ])
  if (!workspace) return null

  return {
    exportedAt: new Date(now ?? Date.now()).toISOString(),
    workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug },
    settings: getWorkspaceSettings(workspaceId),
    members: members.map(toExportMember),
  }
}
