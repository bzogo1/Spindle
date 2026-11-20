import { z } from "zod"

/**
 * Workspace settings — DEVELOPMENT seam.
 *
 * In-memory, per-process store for workspace-level preferences that are NOT
 * part of the auth backend's membership model (rename lives on
 * `backend.updateWorkspace`; membership/roles live on the backend roster).
 * Like {@link MemoryAuthBackend} this loses state on restart; production
 * MUST persist these rows.
 *
 * The schema is intentionally small and strict: unknown keys are rejected so
 * a buggy client cannot smuggle arbitrary JSON into the store. Extend the
 * schema (and bump nothing — there is no versioning yet) when a real
 * settings field lands.
 */

export const workspaceSettingsSchema = z
  .object({
    /** Whether members (not just admins) may send invitations. */
    allowMemberInvites: z.boolean(),
    /** Role assigned to newly accepted invitees when the inviter doesn't pick. */
    defaultJoinRole: z.enum(["admin", "member"]),
    /** Short text shown as the workspace "logo"/header label in the UI. */
    displayLabel: z.string().trim().max(40),
  })
  .strict()

export type WorkspaceSettings = z.infer<typeof workspaceSettingsSchema>

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  allowMemberInvites: false,
  defaultJoinRole: "member",
  displayLabel: "",
}

const store = new Map<string, WorkspaceSettings>()

export function getWorkspaceSettings(workspaceId: string): WorkspaceSettings {
  return store.get(workspaceId) ?? { ...DEFAULT_WORKSPACE_SETTINGS }
}

/** Merges `patch` over the stored settings; returns the new full object. */
export function updateWorkspaceSettings(
  workspaceId: string,
  patch: Partial<WorkspaceSettings>,
): WorkspaceSettings {
  const parsed = workspaceSettingsSchema.partial().strict().parse(patch)
  const next: WorkspaceSettings = { ...getWorkspaceSettings(workspaceId), ...parsed }
  store.set(workspaceId, next)
  return next
}

/** TEST-ONLY: clears all stored settings. */
export function resetWorkspaceSettingsForTests(): void {
  store.clear()
}
