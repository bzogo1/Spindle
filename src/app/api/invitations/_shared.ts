import { getAuthBackend } from "@/lib/auth/backend"
import { authLink, sendInvitationEmail, sendInvitationReminderEmail } from "@/lib/auth/mailer"
import type { EmailDelivery } from "@/lib/email"
import { accessTokenFromRequest, readCookie } from "@/lib/auth/http"
import { decodeMockSession, MOCK_SESSION_COOKIE, mockAuthEnabled } from "@/lib/auth/mock-session"
import {
  createInvitationToken,
  invitationViewStatus,
  INVITATION_REMINDER_MAX_COUNT,
  type InvitationRecord,
} from "@/lib/invitations"
import type { WorkspaceRole } from "@/lib/members/permissions"

/**
 * Shared helpers for the `/api/invitations/*` routes: session → actor
 * resolution (same two-mode shape as `resolveProfileIdentity` in
 * `src/app/api/profile/route.ts`), the client-facing invitation payload, and
 * the accept-link email delivery shared by create and resend.
 *
 * Server-only: pulls in `env.server` through the auth backend/mailer.
 */

export type InvitationActor = {
  /** Stable inviter key stored on records (`user:<uid>` / `mock:<email>`). */
  inviterId: string
  email: string
  name: string
  /** Workspace role used for the RBAC checks in `members/permissions`. */
  role: WorkspaceRole
  workspaceName: string
  /**
   * Stable id of the workspace being invited into, stored on the invitation
   * so accept can record membership. Null when the session cannot provide
   * one (mock sessions carry no workspace id).
   */
  workspaceId: string | null
}

function displayName(name: string | null | undefined, email: string): string {
  const trimmed = name?.trim()
  return trimmed || email.split("@")[0]
}

/**
 * Resolves the caller's workspace identity for invitation management.
 *
 *  - Real auth (`spindle_at` cookie): the role is read from recorded
 *    workspace membership via `backend.listWorkspaceMemberships` — the same
 *    source of truth the members surface uses. `signUp`/`upsertOAuthUser`
 *    record an `owner` membership for the user's personal workspace, and
 *    the accept flow records invited roles, so every legitimate membership
 *    (including personal-workspace owners) resolves here. Resolution FAILS
 *    CLOSED: if the session workspace has no membership row for the caller,
 *    or the lookup errors, no actor is returned (401) rather than guessing
 *    a privileged role.
 *  - Mock auth (`spindle_mock_session` cookie, dev only): the role comes
 *    from the session when present; sessions minted before roles existed
 *    default to `owner` — the mock workspace has a single creator-member,
 *    and defaulting lower would make the feature unreachable in dev.
 *
 * TRUST BOUNDARY (mock mode): `encodeMockSession` is unsigned base64 JSON —
 * anyone can mint a `spindle_mock_session` cookie claiming `role: "owner"`,
 * and this resolver will believe it. That is acceptable ONLY because mock
 * auth is gated behind `NEXT_PUBLIC_MOCK_AUTH=1`, a dev/test flag that must
 * never be enabled in production; the real-auth branch derives the role
 * server-side and ignores any client-supplied role. If mock auth ever ships
 * beyond local development, the cookie must be signed and the role resolved
 * from server state instead.
 */
export async function resolveInvitationActor(request: Request): Promise<InvitationActor | null> {
  const access = accessTokenFromRequest(request)
  if (access) {
    const backend = getAuthBackend()
    const context = await backend.getSessionContext(access.uid).catch(() => null)
    const email = (context?.user.email ?? access.email).trim().toLowerCase()
    const workspace = context?.workspace ?? null

    // Membership lookup is the authorization source: only a recorded role
    // in the session's workspace may manage invitations. There is no
    // "default to owner" fallback — a missing row or a backend error denies.
    let role: WorkspaceRole | null = null
    if (workspace) {
      try {
        const memberships = await backend.listWorkspaceMemberships(access.uid)
        role = memberships.find((m) => m.workspace.id === workspace.id)?.role ?? null
      } catch {
        role = null
      }
    }
    if (!workspace || !role) return null

    return {
      inviterId: `user:${access.uid}`,
      email,
      name: displayName(context?.user.name ?? access.name, email),
      role,
      workspaceName: workspace.name,
      workspaceId: workspace.id,
    }
  }

  if (mockAuthEnabled) {
    const session = decodeMockSession(readCookie(request, MOCK_SESSION_COOKIE))
    if (session) {
      const email = session.user.email.trim().toLowerCase()
      return {
        inviterId: `mock:${email}`,
        email,
        name: displayName(session.user.name, email),
        role: session.workspace.role ?? "owner",
        workspaceName: session.workspace.name,
        // Mock workspaces have no backend id; the mock accept path never
        // touches the auth backend, so null is honest here.
        workspaceId: null,
      }
    }
  }

  return null
}

const ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
}

/** Client-facing invitation payload — never exposes `inviterId`. */
export function invitationView(record: InvitationRecord) {
  return {
    id: record.id,
    email: record.email,
    role: record.role,
    status: invitationViewStatus(record),
    inviterName: record.inviterName,
    workspaceName: record.workspaceName,
    createdAt: record.createdAt,
    /** Last (re)send time — the start of the current expiry window. */
    sentAt: record.lastSentAt,
    expiresAt: record.expiresAt,
    acceptedAt: record.acceptedAt,
    /**
     * Reminder budget usage (manual + automated share the counter):
     * `reminderCount` of `reminderLimit` used; `lastReminderAt` is the most
     * recent send, null when none yet. Lets the UI show "2 of 3 reminders".
     */
    reminderCount: record.reminderCount,
    reminderLimit: INVITATION_REMINDER_MAX_COUNT,
    lastReminderAt: record.lastReminderAt,
  }
}

/**
 * Mints a fresh accept-link token for `record` and emails it. Must be called
 * AFTER any operation that stamps `lastSentAt` (create/resend) so the token's
 * `sts` claim matches the record — `resolveInvitationByToken` rejects
 * mismatched tokens, which is what rotates links on resend.
 */
export async function deliverInvitationEmail(record: InvitationRecord): Promise<EmailDelivery> {
  const token = createInvitationToken(record.id, new Date(record.expiresAt), record.lastSentAt)
  const linkPath = `/invite?token=${encodeURIComponent(token)}`
  return sendInvitationEmail({
    to: record.email,
    workspaceName: record.workspaceName,
    inviterName: record.inviterName,
    role: ROLE_LABELS[record.role],
    url: authLink(linkPath),
    linkPath,
    expiresIn: "7 days",
  })
}

/** Human-readable time left until `expiresAt`, e.g. "5 hours" / "3 days". */
export function formatInvitationTimeLeft(expiresAt: string, now = Date.now()): string {
  const ms = Date.parse(expiresAt) - now
  if (!Number.isFinite(ms) || ms <= 0) return "less than an hour"
  const hours = Math.ceil(ms / 3_600_000)
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`
  const days = Math.ceil(hours / 24)
  return `${days} day${days === 1 ? "" : "s"}`
}

/**
 * Mints the reminder email for `record`. Unlike {@link deliverInvitationEmail}
 * this re-sends the EXISTING accept link: the token is minted against the
 * record's current `lastSentAt` (`sts`), so it is byte-identical to the link
 * in the original invite email — reminders never rotate links or extend
 * expiry. `expiresIn` reflects the real time left so the copy stays honest.
 *
 * Returns the {@link EmailDelivery} result so callers can tell "sent" apart
 * from "unconfigured" (no provider configured — nothing was actually
 * delivered) and only stamp reminder counters on real sends.
 */
export async function deliverInvitationReminderEmail(
  record: InvitationRecord,
): Promise<EmailDelivery> {
  const token = createInvitationToken(record.id, new Date(record.expiresAt), record.lastSentAt)
  const linkPath = `/invite?token=${encodeURIComponent(token)}`
  return sendInvitationReminderEmail({
    to: record.email,
    workspaceName: record.workspaceName,
    inviterName: record.inviterName,
    role: ROLE_LABELS[record.role],
    url: authLink(linkPath),
    linkPath,
    expiresIn: formatInvitationTimeLeft(record.expiresAt),
  })
}
