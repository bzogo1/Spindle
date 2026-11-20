import { z } from "zod"

import { hashPassword, verifyPassword } from "@/lib/auth/password"

/**
 * Password rotation policies: per-principal rules governing how long a
 * password may live and how many previous passwords are remembered so they
 * cannot be reused.
 *
 * A policy is owned by one principal (user id):
 *
 *  - `maxPasswordAgeDays` — maximum age of the current password in days.
 *    `0` means "never expires" (rotation disabled). Positive values are
 *    whole days; typical choices are 30/60/90.
 *  - `passwordHistoryCount` — how many previous password hashes are kept.
 *    When a credential write supplies a candidate password, any of the last
 *    N stored hashes that verify against it is rejected as a reuse.
 *    `0` disables reuse prevention.
 *
 * STORE SEAM: like {@link MemorySecurityPolicyStore} and the login-alert
 * store, rotation state (policy + `passwordChangedAt` + history hashes)
 * lives in a bounded in-memory map inside one process and is lost on
 * restart. `getPasswordRotationStore`/`setPasswordRotationStoreForTests`
 * is the single seam where a durable backend (Prisma) plugs in — see
 * prisma/AUTH-SCHEMA.md.
 *
 * ENFORCEMENT MODEL (PLANNED — NOT YET WIRED):
 * Nothing calls {@link checkPasswordRotation} or
 * {@link recordPasswordChange} from the auth routes today, so rotation is
 * advisory only: `status.expired`/`changeRequired` describe what
 * enforcement WILL do once wired, not what is currently enforced. Until
 * then `passwordChangedAt` stays null for principals that never recorded
 * a change, so `expired` is permanently true under any max-age policy —
 * consumers MUST check `passwordAgeTracked`/`passwordChangedAt` before
 * presenting "change required" to a user.
 *
 *  - Sign-in: `checkPasswordRotation(userId, { now })` returns a
 *    `password_expired` violation when the password is older than
 *    `maxPasswordAgeDays` (or when the change date is unknown while a
 *    max-age policy is set). Integration point: `/api/auth/signin`,
 *    `/api/auth/2fa/verify-login`, OAuth callback, and passwordless verify
 *    should call it after credential verification and force a password
 *    change instead of issuing a session (same pattern as
 *    `checkPolicy` in `src/lib/auth/security-policies.ts`).
 *  - Credential writes: `checkPasswordRotation(userId, { newPassword })`
 *    additionally returns `password_reused` when the candidate matches one
 *    of the last `passwordHistoryCount` hashes. Integration point:
 *    `/api/auth/password/reset/confirm`, `/api/auth/recovery/password`,
 *    signup, and any future change-password route should call it before
 *    `backend.setPassword`, then call `recordPasswordChange(userId,
 *    password)` after a successful write so `passwordChangedAt` and the
 *    history stay current.
 *
 * BOOKKEEPING SEAM (SPOOFABLE): `POST /api/auth/password/rotation/record`
 * accepts arbitrary plaintext from any signed-in session with no proof
 * that a password change actually occurred. It exists so internal
 * callers can perform the bookkeeping above without editing the
 * credential routes first; until those routes call
 * {@link recordPasswordChange} themselves, `passwordChangedAt` and the
 * history are user-forgeable and must be treated as untrusted hints.
 */

export interface PasswordRotationPolicy {
  /** Max password age in days; `0` = never expires. */
  maxPasswordAgeDays: number
  /** Number of previous passwords blocked from reuse; `0` = disabled. */
  passwordHistoryCount: number
}

export const DEFAULT_PASSWORD_ROTATION_POLICY: PasswordRotationPolicy = {
  maxPasswordAgeDays: 0,
  passwordHistoryCount: 0,
}

/** Upper bound for stored history hashes (matches schema max). */
export const MAX_PASSWORD_HISTORY = 20
const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * zod schema for a full rotation policy (PUT body). Kept here — not in
 * `schemas.ts` — because this module owns the policy contract.
 */
export const passwordRotationPolicySchema = z
  .object({
    maxPasswordAgeDays: z.number().int().min(0).max(3650),
    passwordHistoryCount: z.number().int().min(0).max(MAX_PASSWORD_HISTORY),
  })
  .strict()

/** Per-principal rotation state persisted by the store. */
export interface PasswordRotationRecord {
  policy: PasswordRotationPolicy
  /** ISO timestamp of the last recorded password change; null = unknown. */
  passwordChangedAt: string | null
  /**
   * scrypt hash strings, most-recent first. Bounded by
   * {@link MAX_PASSWORD_HISTORY}; entries beyond the configured
   * `passwordHistoryCount` are retained so raising the count later still
   * has data to check against (bounded by the max).
   */
  historyHashes: string[]
}

export interface PasswordRotationStore {
  getRecord(userId: string): PasswordRotationRecord
  setPolicy(userId: string, policy: PasswordRotationPolicy): PasswordRotationRecord
  /** Records a completed password change; `passwordHash` is a scrypt string. */
  recordChange(userId: string, passwordHash: string, changedAt?: Date): PasswordRotationRecord
}

function cloneRecord(record: PasswordRotationRecord): PasswordRotationRecord {
  return {
    policy: { ...record.policy },
    passwordChangedAt: record.passwordChangedAt,
    historyHashes: [...record.historyHashes],
  }
}

function defaultRecord(): PasswordRotationRecord {
  return {
    policy: { ...DEFAULT_PASSWORD_ROTATION_POLICY },
    passwordChangedAt: null,
    historyHashes: [],
  }
}

/**
 * In-memory rotation store. One record per principal id; absent entries
 * read as {@link defaultRecord}. Bounded by the number of principals that
 * ever save a policy or change a password — acceptable for the dev seam,
 * and trivially replaceable by a durable backend.
 */
export class MemoryPasswordRotationStore implements PasswordRotationStore {
  private records = new Map<string, PasswordRotationRecord>()

  private ensure(userId: string): PasswordRotationRecord {
    let record = this.records.get(userId)
    if (!record) {
      record = defaultRecord()
      this.records.set(userId, record)
    }
    return record
  }

  getRecord(userId: string): PasswordRotationRecord {
    const record = this.records.get(userId)
    return record ? cloneRecord(record) : defaultRecord()
  }

  setPolicy(userId: string, policy: PasswordRotationPolicy): PasswordRotationRecord {
    const record = this.ensure(userId)
    record.policy = { ...policy }
    return cloneRecord(record)
  }

  recordChange(
    userId: string,
    passwordHash: string,
    changedAt: Date = new Date(),
  ): PasswordRotationRecord {
    const record = this.ensure(userId)
    record.passwordChangedAt = changedAt.toISOString()
    record.historyHashes = [passwordHash, ...record.historyHashes].slice(0, MAX_PASSWORD_HISTORY)
    return cloneRecord(record)
  }
}

let rotationStore: PasswordRotationStore = new MemoryPasswordRotationStore()

/** Single seam for the rotation store (swap for a durable backend in prod). */
export function getPasswordRotationStore(): PasswordRotationStore {
  return rotationStore
}

/** Test hook: replaces the rotation store. */
export function setPasswordRotationStoreForTests(next: PasswordRotationStore | undefined): void {
  rotationStore = next ?? new MemoryPasswordRotationStore()
}

export interface PasswordRotationStatus {
  policy: PasswordRotationPolicy
  passwordChangedAt: string | null
  /** ISO expiry instant; null when no max-age policy is set. */
  expiresAt: string | null
  /** Whole days until expiry; null when no max-age policy is set. */
  daysRemaining: number | null
  /**
   * True when `passwordChangedAt` is known, i.e. the password's age can
   * actually be evaluated. When false under an active max-age policy,
   * `expired`/`changeRequired` are enforcement predictions only — the UI
   * should present a "not yet tracked" state, not "change required".
   */
  passwordAgeTracked: boolean
  /**
   * Advisory enforcement signal (enforcement not yet wired — see module
   * header): true when the password is older than `maxPasswordAgeDays`.
   * When a max-age policy is set but `passwordChangedAt` is unknown, the
   * password is treated as expired so callers can force a rotation once
   * enforcement is enabled.
   */
  expired: boolean
  /** Alias of `expired`; advisory until enforcement is wired. */
  changeRequired: boolean
  /** How many previous hashes are currently remembered. */
  historySize: number
}

/** Computes the current rotation status for a principal. */
export function getPasswordRotationStatus(
  userId: string,
  now: Date = new Date(),
  store: PasswordRotationStore = getPasswordRotationStore(),
): PasswordRotationStatus {
  const record = store.getRecord(userId)
  const { maxPasswordAgeDays } = record.policy
  let expiresAt: string | null = null
  let daysRemaining: number | null = null
  let expired = false

  if (maxPasswordAgeDays > 0) {
    if (record.passwordChangedAt === null) {
      // Unknown age under an active max-age policy → treat as expired so
      // enforcement (once wired) forces a rotation. Advisory until then.
      expired = true
    } else {
      const changedAt = new Date(record.passwordChangedAt).getTime()
      const expiresAtMs = changedAt + maxPasswordAgeDays * MS_PER_DAY
      expiresAt = new Date(expiresAtMs).toISOString()
      daysRemaining = Math.ceil((expiresAtMs - now.getTime()) / MS_PER_DAY)
      expired = now.getTime() >= expiresAtMs
    }
  }

  return {
    policy: { ...record.policy },
    passwordChangedAt: record.passwordChangedAt,
    expiresAt,
    daysRemaining,
    passwordAgeTracked: record.passwordChangedAt !== null,
    expired,
    changeRequired: expired,
    historySize: record.historyHashes.length,
  }
}

export type PasswordRotationViolationCode = "password_expired" | "password_reused"

export interface PasswordRotationViolation {
  code: PasswordRotationViolationCode
  message: string
  severity: "enforced" | "advisory"
}

export interface PasswordRotationCheckContext {
  /** Evaluation instant; defaults to `new Date()`. */
  now?: Date
  /**
   * Candidate plaintext password for a credential write. When supplied, the
   * last `passwordHistoryCount` stored hashes are checked for reuse.
   */
  newPassword?: string
}

/**
 * Enforcement check for password rotation. Returns every violation found;
 * empty array = allowed.
 *
 *  - `password_expired` (enforced): sign-in should be redirected to a
 *    forced password-change flow. Call from the session-creation routes
 *    after credential verification.
 *  - `password_reused` (enforced): credential writes should be rejected.
 *    Requires `context.newPassword`; compares against the most recent
 *    `passwordHistoryCount` hashes via {@link verifyPassword}.
 *
 * Async because reuse checking runs scrypt verification per stored hash.
 */
export async function checkPasswordRotation(
  userId: string,
  context: PasswordRotationCheckContext = {},
  store: PasswordRotationStore = getPasswordRotationStore(),
): Promise<PasswordRotationViolation[]> {
  const record = store.getRecord(userId)
  const violations: PasswordRotationViolation[] = []
  const now = context.now ?? new Date()

  const status = getPasswordRotationStatus(userId, now, store)
  if (status.expired) {
    violations.push({
      code: "password_expired",
      message: "Your password has expired and must be changed before you can continue.",
      severity: "enforced",
    })
  }

  const { newPassword } = context
  const { passwordHistoryCount } = record.policy
  if (newPassword !== undefined && passwordHistoryCount > 0 && record.historyHashes.length > 0) {
    const candidates = record.historyHashes.slice(0, passwordHistoryCount)
    for (const storedHash of candidates) {
      if (await verifyPassword(newPassword, storedHash)) {
        violations.push({
          code: "password_reused",
          message: `This password matches one of your last ${passwordHistoryCount} passwords. Choose a different one.`,
          severity: "enforced",
        })
        break
      }
    }
  }

  return violations
}

/**
 * Records a completed password change: stamps `passwordChangedAt` and
 * prepends the new password's scrypt hash to the history (bounded by
 * {@link MAX_PASSWORD_HISTORY}). Call AFTER the credential write succeeds.
 *
 * The argument is ALWAYS treated as plaintext and hashed here — there is
 * deliberately no hash-detection heuristic, so a real password that
 * happens to start with `scrypt$` is still hashed correctly. Internal
 * callers that already hold a scrypt hash must use
 * {@link recordPasswordHash} instead.
 */
export async function recordPasswordChange(
  userId: string,
  password: string,
  changedAt: Date = new Date(),
  store: PasswordRotationStore = getPasswordRotationStore(),
): Promise<PasswordRotationRecord> {
  const passwordHash = await hashPassword(password)
  return store.recordChange(userId, passwordHash, changedAt)
}

/**
 * Internal variant of {@link recordPasswordChange} for callers that
 * already computed the scrypt hash during the credential write (avoids a
 * second hash). NOT exposed over HTTP — the public record route accepts
 * plaintext only via {@link recordPasswordChange}.
 */
export async function recordPasswordHash(
  userId: string,
  passwordHash: string,
  changedAt: Date = new Date(),
  store: PasswordRotationStore = getPasswordRotationStore(),
): Promise<PasswordRotationRecord> {
  return store.recordChange(userId, passwordHash, changedAt)
}
