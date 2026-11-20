import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

import { clientEnv } from "@/lib/env"
import { getServerEnv } from "@/lib/env.server"
import { createResendCooldown } from "@/lib/auth/resend-cooldown"
import type { WorkspaceRole } from "@/lib/members/permissions"

/**
 * Workspace invitation store (task 25).
 *
 * In-memory implementation following the `MemoryAuthBackend` pattern in
 * `src/lib/auth/backend.ts`: state lives in this process only, which is fine
 * for development and tests — a Prisma-backed store is the production upgrade
 * path (see the schema notes in `backend.ts`).
 *
 * Token model: the emailed accept link carries an HMAC-SHA256-signed,
 * self-describing token (`inv1.<payload>.<signature>`) — the same envelope
 * shape as `token-codec.ts`, but scoped to the `invitation` purpose which is
 * intentionally NOT part of the auth token codec (that module is owned by the
 * auth workstream). Single-use and revocation are enforced server-side by the
 * store record the token points at (`iid`), so a leaked token cannot mint a
 * second acceptance and a revoked invite dies even while its signature is
 * still valid.
 *
 * Server-only: imports `env.server`, which throws if bundled for the browser.
 */

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
export const INVITATION_RESEND_COOLDOWN_SECONDS = 60
export const INVITATION_RESEND_COOLDOWN_MS = INVITATION_RESEND_COOLDOWN_SECONDS * 1000

/**
 * Automated reminder policy (task 26): a pending invite becomes eligible for
 * a reminder once it is inside the last {@link INVITATION_REMINDER_WINDOW_MS}
 * of its expiry window. Each invite gets at most
 * {@link INVITATION_REMINDER_MAX_COUNT} reminders total (manual + automated
 * share the counter), and consecutive reminders must be at least
 * {@link INVITATION_REMINDER_MIN_INTERVAL_MS} apart.
 */
export const INVITATION_REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000 // last 24h
export const INVITATION_REMINDER_MAX_COUNT = 3
export const INVITATION_REMINDER_MIN_INTERVAL_MS = 8 * 60 * 60 * 1000 // 8h

export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired"

/** Status as reported to clients: a past-due pending invite reads as "expired". */
export type InvitationViewStatus = InvitationStatus | "expired"

export type InvitationRecord = {
  id: string
  /** Normalized (trimmed, lowercased) invitee address. */
  email: string
  role: WorkspaceRole
  /** Stable inviter key (`user:<uid>` or `mock:<email>`) — list scoping. */
  inviterId: string
  inviterEmail: string
  inviterName: string
  /** Display name of the workspace the invitee is joining (email copy). */
  workspaceName: string
  /**
   * Stable id of the workspace being joined, when the inviter's session
   * exposed one (real-auth `WorkspaceInfo.id`). Null for mock-session
   * invites — mock workspaces have no backend id — and for invites created
   * before this field existed. The accept route uses it to record the
   * invitee's workspace membership; without it the invite still works but
   * no membership is written (documented residual gap).
   */
  workspaceId: string | null
  createdAt: string
  /** Last (re)send time — also the start of the current expiry window. */
  lastSentAt: string
  expiresAt: string
  status: InvitationStatus
  acceptedAt: string | null
  /** Backend user id once the invitee's account exists/was linked. */
  acceptedUserId: string | null
  /**
   * Reminder tracking (task 26): `lastReminderAt` stamps the most recent
   * reminder send (manual or automated); `reminderCount` is the lifetime
   * total capped by {@link INVITATION_REMINDER_MAX_COUNT}. Both reset when
   * the invite is resent, since resend opens a fresh expiry window.
   */
  lastReminderAt: string | null
  reminderCount: number
}

export type InvitationTokenPayload = {
  iid: string
  /** Epoch seconds — mirrors `expiresAt` at mint time. */
  exp: number
  /**
   * Epoch milliseconds of the record's `lastSentAt` at mint time. Resending
   * an invite stamps a new `lastSentAt`, so every previously emailed link
   * stops resolving the moment a resend happens — the newest email is the
   * only valid accept link.
   */
  sts: number
}

// ---------------------------------------------------------------------------
// Signed invitation tokens
// ---------------------------------------------------------------------------

const TOKEN_VERSION = "inv1"

/** Dev-only fallback, identical to token-codec's, so local dev/tests work. */
const DEV_FALLBACK_SECRET = "spindle-dev-only-insecure-session-secret-do-not-use"

function signingKeys(): string[] {
  try {
    const env = getServerEnv()
    const keys = [env.SESSION_SECRET, env.SESSION_SECRET_PREVIOUS].filter(
      (key): key is string => typeof key === "string" && key.length > 0,
    )
    if (keys.length > 0) return keys
    if (env.NODE_ENV === "production") {
      throw new Error("SESSION_SECRET is required in production.")
    }
    return [DEV_FALLBACK_SECRET]
  } catch (error) {
    if (clientEnv.NODE_ENV === "production") throw error
    return [DEV_FALLBACK_SECRET]
  }
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input).toString("base64url")
}

function base64UrlDecode(input: string): Buffer {
  return Buffer.from(input, "base64url")
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url")
}

function signaturesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/**
 * Mints the accept-link token for an invitation. `expiresAt` and `sentAt`
 * are embedded in the payload, so a resend — which extends the record's
 * expiry and stamps a new `lastSentAt` — requires a fresh token; every
 * earlier link stops resolving via the `sts` check in
 * {@link resolveInvitationByToken}.
 */
export function createInvitationToken(
  invitationId: string,
  expiresAt: Date,
  sentAt: Date | string | number,
): string {
  const payload: InvitationTokenPayload = {
    iid: invitationId,
    exp: Math.floor(expiresAt.getTime() / 1000),
    sts: new Date(sentAt).getTime(),
  }
  const body = `${TOKEN_VERSION}.${base64UrlEncode(JSON.stringify(payload))}`
  return `${body}.${sign(body, signingKeys()[0])}`
}

/**
 * Verifies signature, version, and (unless `ignoreExpiry`) expiry.
 * Returns the payload or null for malformed/forged tokens.
 */
export function verifyInvitationToken(
  token: string,
  options: { ignoreExpiry?: boolean } = {},
): InvitationTokenPayload | null {
  const parts = token.split(".")
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return null

  const body = `${parts[0]}.${parts[1]}`
  const signature = parts[2]
  const valid = signingKeys().some((key) => signaturesMatch(sign(body, key), signature))
  if (!valid) return null

  let payload: InvitationTokenPayload
  try {
    payload = JSON.parse(base64UrlDecode(parts[1]).toString("utf8")) as InvitationTokenPayload
  } catch {
    return null
  }
  if (typeof payload.iid !== "string" || typeof payload.exp !== "number") return null
  if (typeof payload.sts !== "number") return null
  if (!options.ignoreExpiry && payload.exp * 1000 <= Date.now()) return null
  return payload
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function randomId(): string {
  return `inv_${randomBytes(12).toString("base64url")}`
}

export type CreateInvitationInput = {
  email: string
  role: WorkspaceRole
  inviter: { id: string; email: string; name: string }
  workspaceName: string
  /** See {@link InvitationRecord.workspaceId}. */
  workspaceId?: string | null
}

export type CreateInvitationResult =
  | { ok: true; invitation: InvitationRecord }
  | {
      ok: false
      code: "duplicate_pending"
      /** The existing pending invite blocking this email, when known. */
      invitation?: InvitationRecord
    }

export type AcceptInvitationResult =
  | { ok: true; invitation: InvitationRecord }
  | { ok: false; reason: "not_found" | "used" | "revoked" | "expired" }

export type RemindInvitationResult =
  | { ok: true; invitation: InvitationRecord }
  | {
      ok: false
      reason: "not_found" | "expired" | "cap" | "cooldown"
      /** Whole seconds until another reminder is allowed (cooldown only). */
      retryAfterSeconds?: number
    }

export class MemoryInvitationStore {
  private invitations = new Map<string, InvitationRecord>()

  /**
   * Creates a pending invitation. Refuses when ANY inviter already has a
   * live (non-expired) pending invite for the same normalized email —
   * double-inviting the same address would send confusing duplicate mail.
   * Accepted/revoked/expired records never block a fresh invite.
   */
  create(input: CreateInvitationInput): CreateInvitationResult {
    const email = normalizeEmail(input.email)
    const now = Date.now()
    for (const record of this.invitations.values()) {
      if (
        record.email === email &&
        record.status === "pending" &&
        Date.parse(record.expiresAt) > now
      ) {
        return { ok: false, code: "duplicate_pending", invitation: record }
      }
    }

    const expiresAt = new Date(now + INVITATION_TTL_MS)
    const record: InvitationRecord = {
      id: randomId(),
      email,
      role: input.role,
      inviterId: input.inviter.id,
      inviterEmail: normalizeEmail(input.inviter.email),
      inviterName: input.inviter.name,
      workspaceName: input.workspaceName,
      workspaceId: input.workspaceId ?? null,
      createdAt: new Date(now).toISOString(),
      lastSentAt: new Date(now).toISOString(),
      expiresAt: expiresAt.toISOString(),
      status: "pending",
      acceptedAt: null,
      acceptedUserId: null,
      lastReminderAt: null,
      reminderCount: 0,
    }
    this.invitations.set(record.id, record)
    return { ok: true, invitation: record }
  }

  /**
   * Lazily flips past-due `pending` records to `"expired"` and returns the
   * swept records. Called on every read path (`listForInviter`, `getById`)
   * and explicitly by the tick route, so clients never see a stale "pending"
   * status for a lapsed invite. Idempotent.
   */
  sweepExpired(now = Date.now()): InvitationRecord[] {
    const swept: InvitationRecord[] = []
    for (const record of this.invitations.values()) {
      if (record.status === "pending" && Date.parse(record.expiresAt) <= now) {
        record.status = "expired"
        swept.push(record)
      }
    }
    return swept
  }

  /** All invitations created by `inviterId`, newest first. */
  listForInviter(inviterId: string): InvitationRecord[] {
    this.sweepExpired()
    return [...this.invitations.values()]
      .filter((record) => record.inviterId === inviterId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  getById(id: string): InvitationRecord | null {
    this.sweepExpired()
    return this.invitations.get(id) ?? null
  }

  /**
   * Revokes a pending invitation. Only the inviter who created it may revoke
   * (`inviterId` scope); returns null when the invite is missing, already
   * terminal, or owned by someone else — callers map all of those to 404 so
   * the endpoint cannot be used to probe other inviters' invite ids.
   */
  revoke(inviterId: string, id: string): InvitationRecord | null {
    const record = this.invitations.get(id)
    if (!record || record.inviterId !== inviterId) return null
    if (record.status !== "pending") return null
    record.status = "revoked"
    return record
  }

  /**
   * Resend = extend the expiry window and stamp `lastSentAt`. The caller
   * mints a fresh token (the payload embeds `exp`, so the old link's
   * signature no longer matches the new expiry). Returns null under the same
   * conditions as {@link revoke}.
   *
   * NOTE: an expired invite IS revivable through this path — resend is
   * deliberately the recovery mechanism for lapsed invites (the alternative,
   * forcing the inviter to create a fresh invite, adds nothing since create
   * would hit the same pending record). `sweepExpired` may already have
   * flipped the record's status to `"expired"`; resend accepts both
   * `"pending"` and `"expired"` and restores `"pending"`. Only
   * accepted/revoked invites are truly terminal.
   *
   * Resend also resets the reminder counters (`lastReminderAt`,
   * `reminderCount`): the fresh 7-day window deserves its own reminder
   * budget.
   */
  resend(inviterId: string, id: string): InvitationRecord | null {
    const record = this.invitations.get(id)
    if (!record || record.inviterId !== inviterId) return null
    if (record.status !== "pending" && record.status !== "expired") return null
    const now = Date.now()
    record.status = "pending"
    record.lastSentAt = new Date(now).toISOString()
    record.expiresAt = new Date(now + INVITATION_TTL_MS).toISOString()
    record.lastReminderAt = null
    record.reminderCount = 0
    return record
  }

  /**
   * Single-use acceptance: flips a live pending invite to `accepted` and
   * records which backend user claimed it. Returns the failure reason so the
   * accept route can map it onto the same states the status endpoint reports.
   */
  accept(id: string, acceptedUserId: string): AcceptInvitationResult {
    const record = this.invitations.get(id)
    if (!record) return { ok: false, reason: "not_found" }
    if (record.status === "accepted") return { ok: false, reason: "used" }
    if (record.status === "revoked") return { ok: false, reason: "revoked" }
    if (record.status === "expired") return { ok: false, reason: "expired" }
    if (Date.parse(record.expiresAt) <= Date.now()) {
      // Flip for consistency with sweepExpired/getById — a lapsed pending
      // invite IS expired, and accept should leave the same trace a read
      // would have.
      record.status = "expired"
      return { ok: false, reason: "expired" }
    }
    record.status = "accepted"
    record.acceptedAt = new Date().toISOString()
    record.acceptedUserId = acceptedUserId
    return { ok: true, invitation: record }
  }

  /**
   * Reminder eligibility for the automated tick: pending invites inside the
   * last {@link INVITATION_REMINDER_WINDOW_MS} of their expiry window that
   * still have reminder budget (`reminderCount < MAX`) and are past the
   * minimum interval since the last reminder. Sweeps expired records first
   * so lapsed invites drop out. Manual and automated reminders share the
   * same counters — see {@link remind} and {@link markReminder}.
   */
  pendingReminders(now = Date.now()): InvitationRecord[] {
    this.sweepExpired(now)
    return [...this.invitations.values()].filter((record) => {
      if (record.status !== "pending") return false
      const expiresIn = Date.parse(record.expiresAt) - now
      if (expiresIn <= 0 || expiresIn > INVITATION_REMINDER_WINDOW_MS) return false
      if (record.reminderCount >= INVITATION_REMINDER_MAX_COUNT) return false
      if (record.lastReminderAt !== null) {
        const sinceLast = now - Date.parse(record.lastReminderAt)
        if (sinceLast < INVITATION_REMINDER_MIN_INTERVAL_MS) return false
      }
      return true
    })
  }

  /**
   * Stamps a reminder send on a pending record (advances `lastReminderAt`,
   * increments `reminderCount`). Used by BOTH reminder paths AFTER the email
   * has been handed to the provider: the automated tick and the manual
   * remind route. Re-validates eligibility atomically at stamp time —
   * status still pending, `reminderCount < MAX`, and the minimum interval
   * since `lastReminderAt` — so a snapshot taken before an `await` (tick)
   * or a concurrent manual remind cannot push the counter past the cap.
   * Returns the record, or null when the invite went terminal or another
   * reminder claim won the race (the email may already be out — callers
   * count the send, the counter just stays honest).
   */
  markReminder(id: string, now = Date.now()): InvitationRecord | null {
    const record = this.invitations.get(id)
    if (!record || record.status !== "pending") return null
    if (record.reminderCount >= INVITATION_REMINDER_MAX_COUNT) return null
    if (record.lastReminderAt !== null) {
      const sinceLast = now - Date.parse(record.lastReminderAt)
      if (sinceLast < INVITATION_REMINDER_MIN_INTERVAL_MS) return null
    }
    record.lastReminderAt = new Date(now).toISOString()
    record.reminderCount += 1
    return record
  }

  /**
   * Manual "send reminder" eligibility check for the owning inviter. A
   * reminder re-sends the EXISTING accept link — it does not rotate the
   * token or extend expiry (that is `resend`'s job), so the invitee never
   * holds two different valid links.
   *
   * WINDOW DIFFERENCE (intentional): unlike {@link pendingReminders} —
   * which only surfaces invites inside the last
   * {@link INVITATION_REMINDER_WINDOW_MS} of expiry for the automated tick —
   * a manual reminder is allowed at ANY point while the invite is pending,
   * including fresh invites. The inviter explicitly asked for it, the cap
   * and minimum interval still bound abuse, and nagging early is a product
   * choice, not a bug.
   *
   * This method VALIDATES ONLY — it does not stamp counters. The route
   * stamps via {@link markReminder} after the provider accepts the email,
   * so an unconfigured/failed delivery never burns reminder budget
   * ("phantom budget"). Enforces the same lifetime cap and minimum
   * interval as the automated tick. Returns the failure reason so the
   * route can map it: missing/foreign/terminal invites all report
   * `"not_found"` (no enumeration), a swept-expired invite reports
   * `"expired"` so the client can offer resend instead.
   */
  remind(inviterId: string, id: string, now = Date.now()): RemindInvitationResult {
    const record = this.getById(id) // sweeps expired records lazily
    if (!record || record.inviterId !== inviterId) {
      return { ok: false, reason: "not_found" }
    }
    if (record.status === "expired") return { ok: false, reason: "expired" }
    if (record.status !== "pending") return { ok: false, reason: "not_found" }
    if (record.reminderCount >= INVITATION_REMINDER_MAX_COUNT) {
      return { ok: false, reason: "cap" }
    }
    if (record.lastReminderAt !== null) {
      const remainingMs =
        INVITATION_REMINDER_MIN_INTERVAL_MS - (now - Date.parse(record.lastReminderAt))
      if (remainingMs > 0) {
        return {
          ok: false,
          reason: "cooldown",
          retryAfterSeconds: Math.ceil(remainingMs / 1000),
        }
      }
    }
    return { ok: true, invitation: record }
  }

  /**
   * Compensation for accept-then-fail flows: reverts a record back to
   * `pending` when it is still `accepted` by the SAME `acceptedUserId`.
   * Returns false (leaving state untouched) for missing records, invites
   * accepted by someone else, and already-terminal states — so it can never
   * resurrect a revoked invite or steal another accept's claim. This keeps
   * single-use atomicity: `accept` remains the only gate, and a downstream
   * failure (session issuance, membership write) hands the invite back
   * instead of burning it.
   */
  release(id: string, acceptedUserId: string): boolean {
    const record = this.invitations.get(id)
    if (!record || record.status !== "accepted") return false
    if (record.acceptedUserId !== acceptedUserId) return false
    record.status = "pending"
    record.acceptedAt = null
    record.acceptedUserId = null
    return true
  }

  /** Drops all state. Intended for tests. */
  reset(): void {
    this.invitations.clear()
  }
}

/** Shared instance used by the routes. Module-level like the auth backend. */
export const invitationStore = new MemoryInvitationStore()

/** Derived client-facing status: pending invites past `expiresAt` read "expired". */
export function invitationViewStatus(
  record: InvitationRecord,
  now = Date.now(),
): InvitationViewStatus {
  if (record.status !== "pending") return record.status
  return Date.parse(record.expiresAt) <= now ? "expired" : "pending"
}

/** Per-email cooldown between invitation (re)sends to the same address. */
export const invitationResendCooldown = createResendCooldown({
  cooldownMs: INVITATION_RESEND_COOLDOWN_MS,
})

// ---------------------------------------------------------------------------
// Token → record resolution (shared by the accept/status routes)
// ---------------------------------------------------------------------------

export type ResolvedInvitation =
  | { status: "pending"; invitation: InvitationRecord }
  | {
      /**
       * Terminal/link states. `"used"` corresponds to a record whose status
       * is `"accepted"` — the link itself is what's consumed.
       */
      status: "used" | "revoked" | "expired" | "invalid"
      /** Present when the signature resolved to a real record. */
      invitation?: InvitationRecord
    }

/**
 * Resolves a raw accept-link token to the store record it points at, applying
 * every check the accept flow needs in one place:
 *
 *  - signature/version must verify (`invalid` otherwise — expiry is ignored
 *    at this stage so an expired-but-genuine link can still be reported as
 *    "expired" rather than "invalid");
 *  - the token's `sts` must match the record's current `lastSentAt`, which is
 *    what makes resend rotate links: any (re)send mints a fresh token and
 *    instantly invalidates every earlier emailed link (`expired`);
 *  - the record itself must be pending and inside its expiry window.
 *
 * `store` defaults to the shared instance; tests may pass their own.
 */
export function resolveInvitationByToken(
  token: string,
  store: MemoryInvitationStore = invitationStore,
): ResolvedInvitation {
  const payload = verifyInvitationToken(token, { ignoreExpiry: true })
  if (!payload) return { status: "invalid" }

  const record = store.getById(payload.iid)
  if (!record) return { status: "invalid" }

  // A resend (or recreate) stamps a new lastSentAt; tokens minted against the
  // previous send are superseded even while their own signature still verifies.
  if (payload.sts !== Date.parse(record.lastSentAt)) {
    return { status: "expired", invitation: record }
  }

  if (record.status === "accepted") return { status: "used", invitation: record }
  if (record.status === "revoked") return { status: "revoked", invitation: record }
  if (record.status === "expired") return { status: "expired", invitation: record }

  const recordExpired = Date.parse(record.expiresAt) <= Date.now()
  const tokenExpired = payload.exp * 1000 <= Date.now()
  if (recordExpired || tokenExpired) {
    return { status: "expired", invitation: record }
  }

  return { status: "pending", invitation: record }
}
