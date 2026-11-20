import { createHash, randomBytes } from "node:crypto"

import { z } from "zod"

import { recordAuthEvent, type AuthAuditEventInput } from "@/lib/auth/audit"
import { emailField } from "@/lib/auth/schemas"
import { generateBackupCodes, hashBackupCode, normalizeBackupCode } from "@/lib/auth/totp"

/**
 * Emergency access codes ("break-glass" codes) for account recovery when the
 * normal paths fail — lost authenticator AND lost inbox access, for example.
 *
 * This is deliberately separate from BOTH the TOTP backup codes
 * (`./backup-codes`, single-use sign-in second factors that still require the
 * password) and the account-recovery flow (`./recovery-store`, which proves
 * inbox control via an emailed link). An emergency code is a last-resort
 * credential: it is shown once at issue time, stored only as a SHA-256 hash,
 * single-use by default, and expires (default: one year).
 *
 * Redemption model (the SAFE choice — no full session is ever granted):
 *
 *   code + account email ──▶ consumeEmergencyCode ──▶ restricted access session
 *
 * The redeem route then, server-side:
 *   1. burns every remaining emergency code for the account (one leaked code
 *      must not leave siblings usable),
 *   2. revokes ALL existing auth sessions (a stolen session cannot survive a
 *      break-glass redemption),
 *   3. emails a security notice to the account address (best-effort),
 *   4. issues a short-lived ACCESS token (hashed at rest,
 *      {@link EMERGENCY_ACCESS_TTL_MS}) that authorises ONLY the dedicated
 *      `/api/auth/emergency-codes/access/*` endpoints: set a new password,
 *      mark the email verified, and complete. It is NOT a sign-in session —
 *      it cannot read data, refresh tokens, or call any other API.
 *
 * Completion is gated on the password having been reset during the access
 * session, so the account always ends with fresh credentials and every prior
 * session dead.
 *
 * Like {@link MemoryBackupCodeStore} and the account-recovery store this is a
 * DEVELOPMENT store: records live in process-local maps and are lost on
 * restart. Production MUST persist them (see prisma/AUTH-SCHEMA.md) behind
 * the same `EmergencyCodeStore` seam.
 *
 * Only SHA-256 hashes are stored — for codes AND access tokens. Plaintext is
 * returned to the caller exactly once (codes at issue, the access token at
 * redeem) and is never persisted or logged.
 */

/** Codes issued per generate/regenerate. */
export const EMERGENCY_CODE_ISSUE_COUNT = 10

/** Each code works once by default. */
export const EMERGENCY_CODE_MAX_USES = 1

/** Default code lifetime: one year. */
export const EMERGENCY_CODE_TTL_MS = 365 * 24 * 60 * 60 * 1000

/** How long a redeemed access session stays usable. */
export const EMERGENCY_ACCESS_TTL_MS = 30 * 60 * 1000 // 30 minutes

/** Length of the normalized code body (`XXXX-XXXX` -> `XXXXXXXX`). */
const EMERGENCY_CODE_BODY_LENGTH = 8

export type EmergencyCodeStatus = {
  /** True while at least one unexpired, unused code exists. */
  active: boolean
  /** Live (unexpired, unused) codes left; null when no set was ever issued. */
  remaining: number | null
  /** ISO expiry shared by the whole issued set; null when unmanaged. */
  expiresAt: string | null
}

export type ConsumeEmergencyCodeResult =
  { ok: true } | { ok: false; reason: "invalid" | "expired" | "used" }

export type EmergencyAccessRecord = {
  userId: string
  /** Account email the code was redeemed against (lowercased). */
  email: string
  createdAt: string
  /** Epoch ms when the access session expires. */
  expiresAt: number
  /** ISO timestamp when the password was reset via this access session. */
  passwordResetAt: string | null
  /** ISO timestamp when the email was marked verified via this session. */
  emailVerifiedAt: string | null
  completedAt: string | null
}

export type EmergencyAccessSession = {
  record: EmergencyAccessRecord
  /** Raw bearer token; returned to the redeem caller exactly once. */
  accessToken: string
  accessExpiresAt: string
}

export interface EmergencyCodeStore {
  /** Replaces any existing set; returns plaintext codes exactly once. */
  issue(
    userId: string,
    options?: { count?: number; ttlMs?: number; maxUses?: number },
  ): Promise<{ codes: string[]; remaining: number; expiresAt: string }>
  status(userId: string): EmergencyCodeStatus
  /** Consumes one use of a code for the user. Never throws on bad input. */
  consume(userId: string, code: string): Promise<ConsumeEmergencyCodeResult>
  /** Drops the whole set (returns true when a set existed). */
  revoke(userId: string): boolean
  /** Issues a restricted access session after a successful redemption. */
  createAccess(input: { userId: string; email: string }): EmergencyAccessSession
  /** The live access record behind a raw token, or null. */
  getAccess(rawToken: string): EmergencyAccessRecord | null
  /** Stamps the password-reset step (live access session only). */
  markAccessPasswordReset(rawToken: string): void
  /** Stamps the email-verified step (live access session only). */
  markAccessEmailVerified(rawToken: string): void
  /** Marks the access session completed; the token can never be reused. */
  completeAccess(rawToken: string): EmergencyAccessRecord | null
}

type StoredCode = {
  /** SHA-256 hex digest of the normalized code. */
  hash: string
  usesLeft: number
  usedAt: string | null
}

type StoredSet = {
  codes: StoredCode[]
  /** Epoch ms shared expiry for the set; null = never expires. */
  expiresAt: number | null
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex")
}

function randomAccessToken(): string {
  return randomBytes(32).toString("base64url")
}

export class MemoryEmergencyCodeStore implements EmergencyCodeStore {
  private readonly setsByUser = new Map<string, StoredSet>()
  private readonly accessByHash = new Map<string, EmergencyAccessRecord & { tokenHash: string }>()

  constructor(private readonly now: () => number = () => Date.now()) {}

  async issue(userId: string, options: { count?: number; ttlMs?: number; maxUses?: number } = {}) {
    const count = options.count ?? EMERGENCY_CODE_ISSUE_COUNT
    const maxUses = options.maxUses ?? EMERGENCY_CODE_MAX_USES
    const ttlMs = options.ttlMs ?? EMERGENCY_CODE_TTL_MS
    const codes = generateBackupCodes(count)
    const hashes = await Promise.all(codes.map(hashBackupCode))
    const expiresAt = this.now() + ttlMs
    this.setsByUser.set(userId, {
      codes: hashes.map((hash) => ({ hash, usesLeft: maxUses, usedAt: null })),
      expiresAt,
    })
    return {
      codes,
      remaining: hashes.length,
      expiresAt: new Date(expiresAt).toISOString(),
    }
  }

  status(userId: string): EmergencyCodeStatus {
    const set = this.setsByUser.get(userId)
    if (!set) return { active: false, remaining: null, expiresAt: null }
    const at = this.now()
    const setExpired = set.expiresAt !== null && set.expiresAt <= at
    const live = set.codes.filter((code) => code.usesLeft > 0 && !setExpired).length
    return {
      active: live > 0,
      remaining: live,
      expiresAt: set.expiresAt === null ? null : new Date(set.expiresAt).toISOString(),
    }
  }

  async consume(userId: string, code: string): Promise<ConsumeEmergencyCodeResult> {
    const set = this.setsByUser.get(userId)
    if (!set) return { ok: false, reason: "invalid" }
    // Cheap shape check before hashing: normalized codes are always 8 chars.
    if (normalizeBackupCode(code).length !== EMERGENCY_CODE_BODY_LENGTH) {
      return { ok: false, reason: "invalid" }
    }
    const at = this.now()
    if (set.expiresAt !== null && set.expiresAt <= at) {
      return { ok: false, reason: "expired" }
    }
    const hash = await hashBackupCode(code)
    const stored = set.codes.find((entry) => entry.hash === hash)
    if (!stored) return { ok: false, reason: "invalid" }
    if (stored.usesLeft <= 0) return { ok: false, reason: "used" }

    stored.usesLeft -= 1
    if (stored.usesLeft === 0) stored.usedAt = new Date(at).toISOString()
    return { ok: true }
  }

  revoke(userId: string): boolean {
    return this.setsByUser.delete(userId)
  }

  createAccess(input: { userId: string; email: string }): EmergencyAccessSession {
    const raw = randomAccessToken()
    const tokenHash = sha256(raw)
    const expiresAt = this.now() + EMERGENCY_ACCESS_TTL_MS
    const record: EmergencyAccessRecord & { tokenHash: string } = {
      userId: input.userId,
      email: input.email.trim().toLowerCase(),
      createdAt: new Date(this.now()).toISOString(),
      expiresAt,
      passwordResetAt: null,
      emailVerifiedAt: null,
      completedAt: null,
      tokenHash,
    }
    this.accessByHash.set(tokenHash, record)
    const { tokenHash: _tokenHash, ...publicRecord } = record
    return {
      record: { ...publicRecord },
      accessToken: raw,
      accessExpiresAt: new Date(expiresAt).toISOString(),
    }
  }

  private liveAccess(rawToken: string) {
    const hash = sha256(rawToken)
    const record = this.accessByHash.get(hash)
    if (!record || record.completedAt !== null) return null
    if (record.expiresAt <= this.now()) return null
    return record
  }

  getAccess(rawToken: string): EmergencyAccessRecord | null {
    const record = this.liveAccess(rawToken)
    if (!record) return null
    const { tokenHash: _tokenHash, ...rest } = record
    return { ...rest }
  }

  markAccessPasswordReset(rawToken: string): void {
    const record = this.liveAccess(rawToken)
    if (record) record.passwordResetAt = new Date(this.now()).toISOString()
  }

  markAccessEmailVerified(rawToken: string): void {
    const record = this.liveAccess(rawToken)
    if (record) record.emailVerifiedAt = new Date(this.now()).toISOString()
  }

  completeAccess(rawToken: string): EmergencyAccessRecord | null {
    const record = this.liveAccess(rawToken)
    if (!record) return null
    record.completedAt = new Date(this.now()).toISOString()
    const { tokenHash: _tokenHash, ...rest } = record
    return { ...rest }
  }

  /** Test hook: drops all code sets and access sessions. */
  clear(): void {
    this.setsByUser.clear()
    this.accessByHash.clear()
  }
}

let store: EmergencyCodeStore = new MemoryEmergencyCodeStore()

/** Single seam for the emergency-code store (swap for durable storage in prod). */
export function getEmergencyCodeStore(): EmergencyCodeStore {
  return store
}

/** Test hook: replaces the store. */
export function setEmergencyCodeStoreForTests(next: EmergencyCodeStore | undefined): void {
  store = next ?? new MemoryEmergencyCodeStore()
}

export function issueEmergencyCodes(
  userId: string,
  options?: { count?: number; ttlMs?: number; maxUses?: number },
): Promise<{ codes: string[]; remaining: number; expiresAt: string }> {
  return getEmergencyCodeStore().issue(userId, options)
}

export function getEmergencyCodeStatus(userId: string): EmergencyCodeStatus {
  return getEmergencyCodeStore().status(userId)
}

export function consumeEmergencyCode(
  userId: string,
  code: string,
): Promise<ConsumeEmergencyCodeResult> {
  return getEmergencyCodeStore().consume(userId, code)
}

export function revokeEmergencyCodes(userId: string): boolean {
  return getEmergencyCodeStore().revoke(userId)
}

export function createEmergencyAccess(input: {
  userId: string
  email: string
}): EmergencyAccessSession {
  return getEmergencyCodeStore().createAccess(input)
}

export function getEmergencyAccess(rawToken: string): EmergencyAccessRecord | null {
  return getEmergencyCodeStore().getAccess(rawToken)
}

export function markEmergencyAccessPasswordReset(rawToken: string): void {
  getEmergencyCodeStore().markAccessPasswordReset(rawToken)
}

export function markEmergencyAccessEmailVerified(rawToken: string): void {
  getEmergencyCodeStore().markAccessEmailVerified(rawToken)
}

export function completeEmergencyAccess(rawToken: string): EmergencyAccessRecord | null {
  return getEmergencyCodeStore().completeAccess(rawToken)
}

// ---------------------------------------------------------------------------
// Request-body schemas (kept here so schemas.ts stays untouched)
// ---------------------------------------------------------------------------

export const emergencyRedeemSchema = z.object({
  email: emailField,
  code: z.string().min(1).max(64),
})

export const emergencyAccessTokenSchema = z.object({
  accessToken: z.string().min(1).max(512),
})

export const emergencyAccessPasswordSchema = z.object({
  accessToken: z.string().min(1).max(512),
  password: z.string().min(8).max(1024),
})

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export type EmergencyCodeAuditStep =
  | "generated"
  | "revoked"
  | "redeemed"
  | "redeem_failed"
  | "password_reset"
  | "email_verified"
  | "completed"
  | "access_failed"

/**
 * Emits `emergency_code.<step>` audit events. The `AuthAuditEventType` union
 * in `./audit` does not yet include the emergency-code types (that module is
 * owned elsewhere), so the literal is cast — the runtime store accepts any
 * string. FOLLOW-UP: add `emergency_code.*` members to the union and drop
 * the cast.
 */
export function recordEmergencyCodeEvent(
  step: EmergencyCodeAuditStep,
  input: Omit<AuthAuditEventInput, "type"> = {},
): void {
  recordAuthEvent({
    type: `emergency_code.${step}` as unknown as AuthAuditEventInput["type"],
    ...input,
  })
}
