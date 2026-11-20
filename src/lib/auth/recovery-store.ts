import { createHash, randomBytes, randomUUID } from "node:crypto"

import { z } from "zod"

import { recordAuthEvent, type AuthAuditEventInput } from "@/lib/auth/audit"
import { emailField } from "@/lib/auth/schemas"

/**
 * Account-level recovery: the "locked out of my account" flow.
 *
 * This is deliberately separate from BOTH the plain password-reset flow
 * (`/api/auth/password/reset/*`, single-purpose token → new password) and the
 * TOTP two-factor recovery (`/api/auth/2fa/recovery/*`, owned elsewhere). It
 * is a guided, multi-step recovery for a user who proved control of the
 * account's inbox:
 *
 *   pending ──(emailed one-time token consumed)──▶ verified ──(user finishes)──▶ completed
 *
 * - `pending`: a recovery link was emailed. The token is a random opaque
 *   value stored only as a SHA-256 hash, single-use, expiring after
 *   {@link RECOVERY_TOKEN_TTL_MS}.
 * - `verified`: the email token was consumed and exchanged for a short-lived
 *   *recovery session token* (also hashed at rest, {@link
 *   RECOVERY_SESSION_TTL_MS}). While verified, the client may reset the
 *   password, mark the email verified, and read recent security events —
 *   each through its own endpoint that re-checks the session token.
 * - `completed`: terminal. The route layer has revoked all auth sessions and
 *   cleared every token hash, so neither the email link nor the session
 *   token can be reused.
 *
 * Like {@link MemoryAuthBackend} and the TOTP recovery store this is a
 * DEVELOPMENT store: records live in a process-local map and are lost on
 * restart. Production MUST persist them (see prisma/AUTH-SCHEMA.md) behind
 * the same `AccountRecoveryStore` seam.
 *
 * Abuse controls: at most ONE active recovery per user, per-IP rate limits
 * in the routes, a resend throttle on the email ({@link RECOVERY_RESEND_MS},
 * aligned with the client `RESEND_COOLDOWN_SECONDS`), and single-use
 * expiring tokens for both the email link and the recovery session.
 */

/** How long the emailed recovery link stays valid. */
export const RECOVERY_TOKEN_TTL_MS = 30 * 60 * 1000 // 30 minutes

/** How long a verified recovery session token stays usable. */
export const RECOVERY_SESSION_TTL_MS = 30 * 60 * 1000 // 30 minutes

/**
 * Minimum gap between recovery emails to the same user. Matches the
 * client-side `RESEND_COOLDOWN_SECONDS` (60s) so the resend button and the
 * server window never disagree.
 */
export const RECOVERY_RESEND_MS = 60 * 1000 // 60 seconds

export type RecoveryPhase = "pending" | "verified" | "completed"

export type RecoveryActions = {
  /** ISO timestamp when the password was reset during this recovery. */
  passwordResetAt: string | null
  /** ISO timestamp when the email was marked verified during recovery. */
  emailVerifiedAt: string | null
}

export type RecoveryRecord = {
  id: string
  userId: string
  /** Account email the recovery link was sent to (lowercased). */
  email: string
  phase: RecoveryPhase
  /**
   * SHA-256 of the emailed one-time token. Kept after consumption so a
   * replayed link reports `used` (the phase check makes it unusable); only
   * {@link complete} clears it.
   */
  tokenHash: string | null
  /** SHA-256 of the recovery session token; null until verified/cleared. */
  sessionTokenHash: string | null
  createdAt: string
  /** When the emailed token expires (epoch ms). */
  expiresAt: number
  tokenConsumedAt: string | null
  sessionExpiresAt: number | null
  /** Steps completed while in `verified` phase. */
  actions: RecoveryActions
  /** Last time a recovery email was sent; drives the resend throttle. */
  lastEmailSentAt: string
  completedAt: string | null
}

export type IssueRecoveryResult =
  | { ok: true; record: RecoveryRecord; token: string }
  | {
      ok: false
      reason: "resend_throttled"
      record: RecoveryRecord
      retryAfterSeconds: number
    }

export type ConsumeRecoveryResult =
  | {
      ok: true
      record: RecoveryRecord
      sessionToken: string
      sessionExpiresAt: string
    }
  | { ok: false; reason: "expired" | "used" | "invalid" }

export interface AccountRecoveryStore {
  /**
   * Opens (or restarts) a recovery for the user and returns the raw emailed
   * token. Returns `resend_throttled` when a recovery email was sent within
   * {@link RECOVERY_RESEND_MS} — the existing record is left untouched so an
   * in-flight verified session is not disturbed.
   */
  issue(input: { userId: string; email: string }): IssueRecoveryResult
  /** Records that a recovery email was just sent (starts the resend window). */
  markEmailSent(userId: string): void
  /**
   * Exchanges the emailed one-time token for a recovery session token.
   * Single-use: a consumed token reports `used`, an expired one `expired`,
   * anything unknown `invalid`.
   */
  consumeToken(rawToken: string): ConsumeRecoveryResult
  /** The record behind a live recovery session token, or null. */
  getBySessionToken(rawToken: string): RecoveryRecord | null
  /** The user's non-completed recovery, if any. */
  getActive(userId: string): RecoveryRecord | null
  /** Stamps the password-reset step (verified phase only). */
  markPasswordReset(userId: string): void
  /** Stamps the email-verified step (verified phase only). */
  markEmailVerified(userId: string): void
  /** `verified` → `completed`; clears every token hash. */
  complete(userId: string): RecoveryRecord | null
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex")
}

function randomToken(): string {
  return randomBytes(32).toString("base64url")
}

function isActive(phase: RecoveryPhase): boolean {
  return phase === "pending" || phase === "verified"
}

export class MemoryAccountRecoveryStore implements AccountRecoveryStore {
  private readonly byUser = new Map<string, RecoveryRecord>()

  constructor(
    private readonly tokenTtlMs = RECOVERY_TOKEN_TTL_MS,
    private readonly sessionTtlMs = RECOVERY_SESSION_TTL_MS,
    private readonly resendMs = RECOVERY_RESEND_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  issue(input: { userId: string; email: string }): IssueRecoveryResult {
    const existing = this.byUser.get(input.userId)
    const at = this.now()
    if (existing && isActive(existing.phase)) {
      const sinceLastSend = at - Date.parse(existing.lastEmailSentAt)
      if (sinceLastSend < this.resendMs) {
        return {
          ok: false,
          reason: "resend_throttled",
          record: { ...existing },
          retryAfterSeconds: Math.ceil((this.resendMs - sinceLastSend) / 1000),
        }
      }
    }

    const raw = randomToken()
    const nowIso = new Date(at).toISOString()
    const record: RecoveryRecord = {
      id: randomUUID(),
      userId: input.userId,
      email: input.email.trim().toLowerCase(),
      phase: "pending",
      tokenHash: sha256(raw),
      sessionTokenHash: null,
      createdAt: nowIso,
      expiresAt: at + this.tokenTtlMs,
      tokenConsumedAt: null,
      sessionExpiresAt: null,
      actions: { passwordResetAt: null, emailVerifiedAt: null },
      lastEmailSentAt: nowIso,
      completedAt: null,
    }
    this.byUser.set(input.userId, record)
    return { ok: true, record: { ...record }, token: raw }
  }

  markEmailSent(userId: string): void {
    const record = this.byUser.get(userId)
    if (record && isActive(record.phase)) {
      record.lastEmailSentAt = new Date(this.now()).toISOString()
    }
  }

  consumeToken(rawToken: string): ConsumeRecoveryResult {
    const hash = sha256(rawToken)
    for (const record of this.byUser.values()) {
      if (record.tokenHash !== hash) continue
      if (record.phase === "completed" || record.phase === "verified") {
        return { ok: false, reason: "used" }
      }
      if (record.expiresAt <= this.now()) return { ok: false, reason: "expired" }

      const at = this.now()
      const sessionToken = randomToken()
      record.phase = "verified"
      record.tokenConsumedAt = new Date(at).toISOString()
      // tokenHash is retained (not nulled) so a replayed link resolves to
      // this record and reports "used"; the phase check above already makes
      // it impossible to consume twice. complete() clears the hash.
      record.sessionTokenHash = sha256(sessionToken)
      record.sessionExpiresAt = at + this.sessionTtlMs
      return {
        ok: true,
        record: { ...record },
        sessionToken,
        sessionExpiresAt: new Date(record.sessionExpiresAt).toISOString(),
      }
    }
    return { ok: false, reason: "invalid" }
  }

  getBySessionToken(rawToken: string): RecoveryRecord | null {
    const hash = sha256(rawToken)
    for (const record of this.byUser.values()) {
      if (record.sessionTokenHash !== hash) continue
      if (record.phase !== "verified") return null
      if (record.sessionExpiresAt === null || record.sessionExpiresAt <= this.now()) {
        return null
      }
      return { ...record }
    }
    return null
  }

  getActive(userId: string): RecoveryRecord | null {
    const record = this.byUser.get(userId)
    return record && isActive(record.phase) ? { ...record } : null
  }

  markPasswordReset(userId: string): void {
    const record = this.byUser.get(userId)
    if (record?.phase === "verified") {
      record.actions.passwordResetAt = new Date(this.now()).toISOString()
    }
  }

  markEmailVerified(userId: string): void {
    const record = this.byUser.get(userId)
    if (record?.phase === "verified") {
      record.actions.emailVerifiedAt = new Date(this.now()).toISOString()
    }
  }

  complete(userId: string): RecoveryRecord | null {
    const record = this.byUser.get(userId)
    if (!record || record.phase !== "verified") return null
    record.phase = "completed"
    record.completedAt = new Date(this.now()).toISOString()
    record.tokenHash = null
    record.sessionTokenHash = null
    record.sessionExpiresAt = null
    return { ...record }
  }

  /** Test hook: drops all records. */
  clear(): void {
    this.byUser.clear()
  }
}

let store: AccountRecoveryStore = new MemoryAccountRecoveryStore()

/** Single seam for the recovery store (swap for a durable backend in prod). */
export function getAccountRecoveryStore(): AccountRecoveryStore {
  return store
}

/** Test hook: replaces the store. */
export function setAccountRecoveryStoreForTests(next: AccountRecoveryStore | undefined): void {
  store = next ?? new MemoryAccountRecoveryStore()
}

// ---------------------------------------------------------------------------
// Request-body schemas (kept here so schemas.ts stays untouched)
// ---------------------------------------------------------------------------

export const recoveryRequestSchema = z.object({ email: emailField })

export const recoveryTokenSchema = z.object({
  token: z.string().min(1).max(512),
})

export const recoverySessionSchema = z.object({
  sessionToken: z.string().min(1).max(512),
})

export const recoveryPasswordSchema = z.object({
  sessionToken: z.string().min(1).max(512),
  password: z.string().min(8).max(1024),
})

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export type AccountRecoveryAuditStep =
  "requested" | "token_verified" | "password_reset" | "email_verified" | "completed" | "failed"

/**
 * Emits `account.recovery.<step>` audit events. The `AuthAuditEventType`
 * union in `./audit` does not yet include the recovery types (that module
 * is owned elsewhere), so the literal is cast — the runtime store accepts
 * any string. FOLLOW-UP: add `account.recovery.*` members to the union and
 * drop the cast.
 */
export function recordAccountRecoveryEvent(
  step: AccountRecoveryAuditStep,
  input: Omit<AuthAuditEventInput, "type"> = {},
): void {
  recordAuthEvent({
    type: `account.recovery.${step}` as unknown as AuthAuditEventInput["type"],
    ...input,
  })
}
