/**
 * Directory sync — DEVELOPMENT seam.
 *
 * Reconciles a workspace's member roster against a directory "export" (a
 * JSON array of users, e.g. pasted from an HR system or IdP dump). The core
 * is {@link computeSyncPlan}, a pure function that diffs the current roster
 * against the desired state and produces an explicit, reviewable plan:
 * who to add, who to update, who to remove, and what went wrong.
 *
 * Like the other workspace dev seams this is in-memory only
 * ({@link lastSyncResult}/{@link setLastSyncResult}); production MUST
 * persist sync results.
 */

import { isWorkspaceRole, type WorkspaceRole } from "@/lib/members/permissions"

/** One member of the desired directory state (what the export claims). */
export type DirectoryDesiredUser = {
  email: string
  name?: string | null
  role?: string
}

/** One resolved user to add — role and name are already defaulted. */
export type DirectoryUser = {
  email: string
  name: string | null
  role: WorkspaceRole
}

/** Snapshot of the mutable member fields a sync can change. */
export type DirectoryMemberState = {
  name: string | null
  role: WorkspaceRole
}

export type DirectoryUpdate = {
  userId: string
  email: string
  from: DirectoryMemberState
  to: DirectoryMemberState
}

export type DirectoryRemoval = {
  userId: string
  email: string
}

export type DirectorySyncPlan = {
  toAdd: DirectoryUser[]
  toUpdate: DirectoryUpdate[]
  toRemove: DirectoryRemoval[]
  /** Current members that need no change (including kept absentees). */
  unchanged: number
  /** Human-readable problems (bad emails, bad roles, dupes, owner guard). */
  errors: string[]
}

/** Current roster row as the backend reports it. */
export type DirectoryCurrentMember = {
  id: string
  email: string
  name?: string | null
  role: WorkspaceRole
}

export type DirectorySyncOptions = {
  /** When true, members absent from the desired list are planned for removal. */
  removeAbsent?: boolean
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_EMAIL_LENGTH = 254
const MAX_NAME_LENGTH = 200

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function isValidEmail(email: string): boolean {
  return email.length > 0 && email.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(email)
}

function normalizeName(name: string | null | undefined): string | null {
  const trimmed = name?.trim()
  return trimmed ? trimmed : null
}

function sameState(a: DirectoryMemberState, b: DirectoryMemberState): boolean {
  return a.name === b.name && a.role === b.role
}

/**
 * Computes the sync plan. Email matching is case-insensitive; the desired
 * list is authoritative for membership only when `removeAbsent` is set.
 *
 * Safety rules:
 * - invalid emails/roles/names and duplicate desired emails land in `errors`;
 *   a malformed row still matches its member by email so it can never cause
 *   a removal — the member is kept unchanged instead
 * - owners are never demoted or removed past the point where the workspace
 *   would be left ownerless; excess attempts are reported in `errors` and
 *   the member keeps their current state
 */
export function computeSyncPlan(
  current: readonly DirectoryCurrentMember[],
  desired: readonly DirectoryDesiredUser[],
  opts: DirectorySyncOptions = {},
): DirectorySyncPlan {
  const plan: DirectorySyncPlan = {
    toAdd: [],
    toUpdate: [],
    toRemove: [],
    unchanged: 0,
    errors: [],
  }

  const currentByEmail = new Map<string, DirectoryCurrentMember>()
  for (const member of current) {
    const key = normalizeEmail(member.email)
    if (key && !currentByEmail.has(key)) currentByEmail.set(key, member)
  }
  // Sequential owner budget, mirroring computeBulkTargets in
  // members/permissions.ts: each planned owner demotion/removal consumes one
  // slot, so at most `ownerCount - 1` owners can be touched per sync.
  let ownersLeft = current.filter((m) => m.role === "owner").length

  const seenDesired = new Set<string>()
  const matchedUserIds = new Set<string>()

  for (const entry of desired) {
    const rawEmail = typeof entry?.email === "string" ? entry.email : ""
    const email = normalizeEmail(rawEmail)
    if (!isValidEmail(email)) {
      plan.errors.push(`Invalid email in directory export: ${rawEmail || "(empty)"}`)
      continue
    }
    if (seenDesired.has(email)) {
      plan.errors.push(`Duplicate email in directory export: ${email}`)
      continue
    }
    seenDesired.add(email)

    // Match the member by email BEFORE validating role/name: a malformed row
    // must still count as "seen" so removeAbsent can never plan its removal.
    const existing = currentByEmail.get(email)

    let role: WorkspaceRole | undefined
    let malformed = false
    if (entry.role !== undefined && entry.role !== null && entry.role !== "") {
      const candidate = String(entry.role).trim().toLowerCase()
      if (!isWorkspaceRole(candidate)) {
        plan.errors.push(`Invalid role "${entry.role}" for ${email}; keeping current state.`)
        malformed = true
      } else {
        role = candidate
      }
    }
    const rawName = entry.name
    if (
      rawName !== undefined &&
      rawName !== null &&
      (typeof rawName !== "string" || rawName.length > MAX_NAME_LENGTH)
    ) {
      plan.errors.push(`Invalid name for ${email}; keeping current state.`)
      malformed = true
    }

    if (!existing) {
      if (malformed) continue
      plan.toAdd.push({
        email,
        name: normalizeName(entry.name),
        role: role ?? "member",
      })
      continue
    }

    matchedUserIds.add(existing.id)

    if (malformed) {
      // Reported in errors above; the member is matched and left untouched.
      plan.unchanged += 1
      continue
    }

    const from: DirectoryMemberState = {
      name: existing.name ?? null,
      role: existing.role,
    }
    const to: DirectoryMemberState = {
      name: entry.name !== undefined ? normalizeName(entry.name) : from.name,
      role: role ?? from.role,
    }

    // Never demote owners past the point where one owner must remain — a
    // desired list demoting every owner is rejected entry-by-entry here
    // instead of partially failing at apply time.
    if (existing.role === "owner" && to.role !== "owner") {
      if (ownersLeft <= 1) {
        plan.errors.push(`Refusing to demote ${email}: they are the last owner of this workspace.`)
        to.role = "owner"
      } else {
        ownersLeft -= 1
      }
    }

    if (sameState(from, to)) {
      plan.unchanged += 1
    } else {
      plan.toUpdate.push({ userId: existing.id, email, from, to })
    }
  }

  for (const member of current) {
    if (matchedUserIds.has(member.id)) continue
    const isLastOwner = member.role === "owner" && ownersLeft <= 1
    if (opts.removeAbsent && !isLastOwner) {
      if (member.role === "owner") ownersLeft -= 1
      plan.toRemove.push({ userId: member.id, email: normalizeEmail(member.email) })
    } else {
      if (opts.removeAbsent && isLastOwner) {
        plan.errors.push(
          `Refusing to remove ${normalizeEmail(member.email)}: they are the last owner of this workspace.`,
        )
      }
      plan.unchanged += 1
    }
  }

  return plan
}

// -- Last-sync-result seam (in-memory, per workspace) ------------------------

/** What happened when a plan was (or wasn't) applied. */
export type DirectorySyncOutcome = {
  added: number
  updated: number
  removed: number
  failed: { email: string; reason: string }[]
}

export type DirectorySyncRecord = {
  at: string
  dryRun: boolean
  applied: boolean
  plan: DirectorySyncPlan
  outcome: DirectorySyncOutcome | null
}

const lastResults = new Map<string, DirectorySyncRecord>()

/** The most recent sync record for a workspace, or null when none exists. */
export function lastSyncResult(workspaceId: string): DirectorySyncRecord | null {
  return lastResults.get(workspaceId) ?? null
}

export function setLastSyncResult(workspaceId: string, record: DirectorySyncRecord): void {
  lastResults.set(workspaceId, record)
}

/** TEST-ONLY: clears all recorded sync results. */
export function resetDirectorySyncForTests(): void {
  lastResults.clear()
}
