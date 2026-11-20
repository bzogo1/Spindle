/**
 * Role-based access control for workspace membership.
 *
 * Pure, isomorphic helpers shared by the members UI — which uses them to gate
 * controls — and, once the team API lands, by `/api/*` route handlers. Client
 * gating is UX only: every mutating endpoint MUST re-check the same rules
 * server-side, where the actor's role comes from the session/backend rather
 * than the request body.
 *
 * Roles are ordered `member < admin < owner`. The rules encoded here:
 *
 *  - Only owners and admins can manage membership at all (invite, resend,
 *    revoke invites, change roles, remove members).
 *  - Only an owner can grant the `owner` role.
 *  - Admins manage `member` rows only: they cannot modify owners or other
 *    admins, and cannot promote anyone to `owner`.
 *  - Nobody can change their own role or remove themselves through the
 *    members admin surface (self-service flows like "leave workspace" are
 *    separate and intentionally not covered here).
 *  - The last remaining owner can never be demoted or removed.
 */

export type WorkspaceRole = "owner" | "admin" | "member"

/** Minimal shape the guards need: a stable id plus the member's role. */
export interface MemberRoleHolder {
  id: string
  role: WorkspaceRole
}

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return value === "owner" || value === "admin" || value === "member"
}

function ownerCount(members: readonly MemberRoleHolder[]): number {
  return members.filter((member) => member.role === "owner").length
}

function isOwnerOrAdmin(role: WorkspaceRole | null | undefined): boolean {
  return role === "owner" || role === "admin"
}

/**
 * Whether `actorRole` may hand out `targetRole` to someone else. Owners can
 * grant any role; admins can grant `admin`/`member` but never `owner`;
 * members cannot grant anything.
 */
export function canAssignRole(
  actorRole: WorkspaceRole | null | undefined,
  targetRole: WorkspaceRole,
): boolean {
  if (actorRole === "owner") return true
  if (actorRole === "admin") return targetRole !== "owner"
  return false
}

/** Sending, resending, and revoking invites are owner/admin actions. */
export function canManageMembers(role: WorkspaceRole | null | undefined): boolean {
  return isOwnerOrAdmin(role)
}

export function canInviteMembers(role: WorkspaceRole | null | undefined): boolean {
  return canManageMembers(role)
}

export function canManageInvites(role: WorkspaceRole | null | undefined): boolean {
  return canManageMembers(role)
}

/**
 * Whether `actor` may change `target`'s role to `nextRole`.
 *
 * `members` is the full roster (not just the visible/filtered rows) so the
 * last-owner guard sees every owner.
 */
export function canChangeMemberRole(
  actor: MemberRoleHolder | null | undefined,
  target: MemberRoleHolder,
  members: readonly MemberRoleHolder[],
  nextRole: WorkspaceRole,
): boolean {
  // Self-guard: your own role can only change through a different flow.
  if (!actor || actor.id === target.id) return false
  if (!canAssignRole(actor.role, nextRole)) return false
  // Admins manage members only — never owners or peer admins.
  if (actor.role === "admin" && target.role !== "member") return false
  // Last-owner guard: the final owner cannot be demoted.
  if (target.role === "owner" && nextRole !== "owner" && ownerCount(members) <= 1) return false
  return true
}

/**
 * Whether `actor` may remove `target` from the workspace. Same self-guard and
 * last-owner rules as role changes; admins can only remove `member` rows.
 */
export function canRemoveMember(
  actor: MemberRoleHolder | null | undefined,
  target: MemberRoleHolder,
  members: readonly MemberRoleHolder[],
): boolean {
  if (!actor || actor.id === target.id) return false
  if (actor.role === "member") return false
  if (actor.role === "admin" && target.role !== "member") return false
  if (target.role === "owner" && ownerCount(members) <= 1) return false
  return true
}

/**
 * Which of `selected` members a bulk action would actually affect.
 *
 * Per-member checks (`canChangeMemberRole`/`canRemoveMember`) only see the
 * static roster, so two selected owners would both look eligible even though
 * demoting/removing both would leave the workspace ownerless. This applies
 * the same sequential last-owner budget the apply path uses: each eligible
 * owner consumes one remaining-owner slot, so at most `ownerCount - 1`
 * selected owners can be touched in a single bulk action. `selected` and
 * `members` must be in roster order so the budget is spent deterministically.
 *
 * `eligible` must run the same per-member permission check the confirm path
 * uses against the live roster (including the `member.role !== nextRole`
 * skip for role changes).
 */
export function computeBulkTargets<T extends MemberRoleHolder>(
  actor: MemberRoleHolder | null | undefined,
  selected: readonly T[],
  members: readonly MemberRoleHolder[],
  eligible: (member: T) => boolean,
): T[] {
  if (!actor) return []
  let ownersLeft = ownerCount(members)
  return selected.filter((member) => {
    if (!eligible(member)) return false
    if (member.role === "owner") {
      if (ownersLeft <= 1) return false
      ownersLeft -= 1
    }
    return true
  })
}
