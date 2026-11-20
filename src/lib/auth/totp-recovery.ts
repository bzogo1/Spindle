import { createHash, randomUUID } from "node:crypto"

import { z } from "zod"

import { recordAuthEvent, type AuthAuditEventInput } from "@/lib/auth/audit"

/**
 * TOTP two-factor recovery: the "lost my authenticator" flow.
 *
 * State machine (one active recovery per user):
 *
 *   awaiting_token ──(email one-time token consumed)──▶ cooldown ──(executeAt reached)──▶ completed
 *        │                                                    │
 *        └──────────────(user cancels)────────────────────────┴──▶ cancelled
 *
 * - `awaiting_token`: a recovery was requested and a single-use email token
 *   (issued through `AuthBackend.issueOneTimeToken`, kind `"verify"`) is in
 *   flight. The backend token store only distinguishes `magic | reset |
 *   verify`, so purpose isolation is enforced HERE: the route binds the
 *   SHA-256 of the exact token it emailed ({@link bindToken}) and confirm
 *   rejects any other `"verify"`-kind token — e.g. a 24h email-verification
 *   link — even though both share the backend kind.
 * - `cooldown`: the email token was consumed (identity verified via the
 *   account's inbox, optionally reinforced by a backup code). 2FA stays ON
 *   until `executeAt` so the real owner has a window to notice an
 *   unauthorized request and cancel. {@link RECOVERY_COOLDOWN_MS} = 72h —
 *   long enough for an emailed warning to be seen, short enough to be usable.
 * - `completed`: the route layer finalized the recovery (TOTP secret cleared,
 *   backup codes dropped, user emailed).
 * - `cancelled`: terminal; the user aborted before completion.
 *
 * Like {@link MemoryAuthBackend} and the backup-code store this is a
 * DEVELOPMENT store: records live in a process-local map and are lost on
 * restart. Production MUST persist them (see prisma/AUTH-SCHEMA.md) behind
 * the same `TotpRecoveryStore` seam.
 *
 * Abuse controls: at most ONE active (non-terminal) recovery per user,
 * per-IP rate limits in the routes, a resend throttle on the email
 * ({@link RECOVERY_RESEND_MS}), and the backend's single-use/expiring token.
 */

/** How long the emailed recovery token stays valid. */
export const RECOVERY_TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hour

/** Delay between token verification and the actual 2FA disable. */
export const RECOVERY_COOLDOWN_MS = 72 * 60 * 60 * 1000 // 72 hours

/** Minimum gap between recovery emails to the same user. */
export const RECOVERY_RESEND_MS = 5 * 60 * 1000 // 5 minutes

export type RecoveryPhase = "awaiting_token" | "cooldown" | "completed" | "cancelled"

export type RecoveryRecord = {
  id: string
  userId: string
  /** Account email the recovery token was sent to (lowercased). */
  email: string
  phase: RecoveryPhase
  /** ISO timestamps for each transition; null until reached. */
  createdAt: string
  tokenConsumedAt: string | null
  /** When the cooldown ends and 2FA may be disabled. */
  executeAt: string | null
  resolvedAt: string | null
  /**
   * SHA-256 hex of the exact emailed recovery token ({@link hashRecoveryToken}).
   * Bound by the request route after `issueOneTimeToken`; confirm requires a
   * match so unrelated `"verify"`-kind tokens cannot drive a recovery.
   * Re-binding on resend invalidates previously emailed links.
   */
  tokenHash: string | null
  /**
   * Last time a recovery email was actually SENT; drives the resend throttle.
   * Null until the first successful send — a failed send must not start the
   * throttle window or the user could be locked out of retrying.
   */
  lastEmailSentAt: string | null
}

export type CreateRecoveryResult =
  | { ok: true; record: RecoveryRecord; resent: boolean }
  | { ok: false; reason: "cooldown_active"; record: RecoveryRecord }

export interface TotpRecoveryStore {
  /**
   * Opens a recovery in `awaiting_token`, or returns the pending one.
   * `resent: true` means an awaiting-token recovery already existed — the
   * route applies {@link RECOVERY_RESEND_MS} against `lastEmailSentAt` before
   * sending another email, then calls {@link markEmailSent}.
   * Returns `cooldown_active` when a verified recovery is already counting
   * down — a second request must not restart or duplicate it.
   */
  create(input: { userId: string; email: string }): CreateRecoveryResult
  /** Records that a recovery email was just sent (starts the resend window). */
  markEmailSent(userId: string): void
  /** Binds the SHA-256 of the emailed token to the pending recovery. */
  bindToken(userId: string, tokenHash: string): void
  /** The user's non-terminal recovery, if any. */
  getActive(userId: string): RecoveryRecord | null
  /** `awaiting_token` → `cooldown`; stamps `executeAt = now + cooldown`. */
  consumeToken(userId: string): RecoveryRecord | null
  /**
   * Atomic `cooldown` → `completed` ONLY when `executeAt` has passed (per the
   * store clock). Returns the transitioned record, or null when the recovery
   * is missing, not in cooldown, or not yet due — making it safe for
   * concurrent finalizers: exactly one caller observes the transition and
   * performs the side effects (secret wipe, email, audit).
   */
  finalize(userId: string): RecoveryRecord | null
  /** Any non-terminal phase → `cancelled`. */
  cancel(userId: string): RecoveryRecord | null
}

function isActive(phase: RecoveryPhase): boolean {
  return phase === "awaiting_token" || phase === "cooldown"
}

/** True when a cooldown recovery may be finalized. */
export function isRecoveryDue(record: RecoveryRecord, now = Date.now()): boolean {
  return (
    record.phase === "cooldown" && record.executeAt !== null && Date.parse(record.executeAt) <= now
  )
}

/** Whole seconds until `executeAt`; 0 when due or not applicable. */
export function recoverySecondsRemaining(record: RecoveryRecord, now = Date.now()): number {
  if (record.phase !== "cooldown" || !record.executeAt) return 0
  return Math.max(0, Math.ceil((Date.parse(record.executeAt) - now) / 1000))
}

/**
 * SHA-256 hex of a raw one-time token — the same digest the backend stores
 * for `AuthOneTimeToken`s, reused here to bind a recovery record to the
 * exact token that was emailed (purpose isolation, see module docs).
 */
export function hashRecoveryToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex")
}

export class MemoryTotpRecoveryStore implements TotpRecoveryStore {
  private readonly byUser = new Map<string, RecoveryRecord>()

  constructor(
    private readonly cooldownMs = RECOVERY_COOLDOWN_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  create(input: { userId: string; email: string }): CreateRecoveryResult {
    const existing = this.byUser.get(input.userId)
    const at = new Date(this.now()).toISOString()
    if (existing && isActive(existing.phase)) {
      if (existing.phase === "cooldown") {
        return { ok: false, reason: "cooldown_active", record: { ...existing } }
      }
      // awaiting_token: hand the existing record back; the route decides
      // whether the resend throttle allows actually sending again.
      return { ok: true, record: { ...existing }, resent: true }
    }
    const record: RecoveryRecord = {
      id: randomUUID(),
      userId: input.userId,
      email: input.email.trim().toLowerCase(),
      phase: "awaiting_token",
      createdAt: at,
      tokenConsumedAt: null,
      executeAt: null,
      resolvedAt: null,
      tokenHash: null,
      // Null until the first email actually sends — see field docs.
      lastEmailSentAt: null,
    }
    this.byUser.set(input.userId, record)
    return { ok: true, record: { ...record }, resent: false }
  }

  markEmailSent(userId: string): void {
    const record = this.byUser.get(userId)
    if (record && isActive(record.phase)) {
      record.lastEmailSentAt = new Date(this.now()).toISOString()
    }
  }

  bindToken(userId: string, tokenHash: string): void {
    const record = this.byUser.get(userId)
    if (record && record.phase === "awaiting_token") {
      record.tokenHash = tokenHash
    }
  }

  getActive(userId: string): RecoveryRecord | null {
    const record = this.byUser.get(userId)
    return record && isActive(record.phase) ? { ...record } : null
  }

  consumeToken(userId: string): RecoveryRecord | null {
    const record = this.byUser.get(userId)
    if (!record || record.phase !== "awaiting_token") return null
    const at = this.now()
    record.phase = "cooldown"
    record.tokenConsumedAt = new Date(at).toISOString()
    record.executeAt = new Date(at + this.cooldownMs).toISOString()
    return { ...record }
  }

  finalize(userId: string): RecoveryRecord | null {
    const record = this.byUser.get(userId)
    if (!record || record.phase !== "cooldown" || !record.executeAt) return null
    if (Date.parse(record.executeAt) > this.now()) return null
    record.phase = "completed"
    record.resolvedAt = new Date(this.now()).toISOString()
    return { ...record }
  }

  cancel(userId: string): RecoveryRecord | null {
    const record = this.byUser.get(userId)
    if (!record || !isActive(record.phase)) return null
    record.phase = "cancelled"
    record.resolvedAt = new Date(this.now()).toISOString()
    return { ...record }
  }

  /** Test hook: drops all records. */
  clear(): void {
    this.byUser.clear()
  }
}

let store: TotpRecoveryStore = new MemoryTotpRecoveryStore()

/** Single seam for the recovery store (swap for a durable backend in prod). */
export function getTotpRecoveryStore(): TotpRecoveryStore {
  return store
}

/** Test hook: replaces the store. */
export function setTotpRecoveryStoreForTests(next: TotpRecoveryStore | undefined): void {
  store = next ?? new MemoryTotpRecoveryStore()
}

// ---------------------------------------------------------------------------
// Request-body schemas (kept here so schemas.ts stays untouched)
// ---------------------------------------------------------------------------

export const recoveryConfirmSchema = z.object({
  token: z.string().min(1).max(512),
  /** Optional backup code — extra proof-of-possession on top of the email token. */
  backupCode: z.string().min(1).max(32).optional(),
})

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export type RecoveryAuditStep =
  "requested" | "token_verified" | "cooldown_started" | "completed" | "cancelled" | "failed"

/**
 * Emits `totp.recovery.<step>` audit events. The `AuthAuditEventType` union in
 * `./audit` does not yet include the recovery types (that module is owned
 * elsewhere this phase), so the literal is cast — the runtime store accepts
 * any string. FOLLOW-UP: add `totp.recovery.*` members to the union and drop
 * the cast.
 */
export function recordRecoveryAuditEvent(
  step: RecoveryAuditStep,
  input: Omit<AuthAuditEventInput, "type"> = {},
): void {
  recordAuthEvent({
    type: `totp.recovery.${step}` as unknown as AuthAuditEventInput["type"],
    ...input,
  })
}
