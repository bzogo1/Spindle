/**
 * One-time backup codes for TOTP two-factor authentication.
 *
 * The generation/normalization/hashing primitives live in `./totp` (shared
 * with enrollment, which issues the first set inside the auth backend). This
 * module is the per-user STORE for code sets managed through
 * `/api/auth/2fa/backup-codes`: regenerating replaces the whole set, and
 * `verify-login` prefers this store once a user has an active managed set —
 * codes issued at enrollment are superseded (regenerate invalidates old).
 *
 * Like `MemoryAuthAuditLog` this is a DEVELOPMENT store: hashes live in a
 * process-local map and are lost on restart. Production MUST persist them in
 * the `user_backup_codes` table (see prisma/AUTH-SCHEMA.md) behind the same
 * `BackupCodeStore` seam.
 *
 * Only SHA-256 hashes are stored. Plaintext codes are returned to the caller
 * exactly once, at issue time, and are never persisted or logged.
 */

import { generateBackupCodes, hashBackupCode, normalizeBackupCode } from "@/lib/auth/totp"

/** Codes issued per regenerate (enrollment issues its own set of 8). */
export const BACKUP_CODE_ISSUE_COUNT = 10

/** Length of the normalized code body (`XXXX-XXXX` -> `XXXXXXXX`). */
const BACKUP_CODE_BODY_LENGTH = 8

export type BackupCodeStatus = {
  /**
   * True once the user has an API-managed set. A managed set supersedes the
   * enrollment codes held by the backend — old codes stop working.
   */
  managed: boolean
  /** Unused codes left in the managed set; null when none is managed here. */
  remaining: number | null
}

export interface BackupCodeStore {
  /** Replaces any existing set; returns plaintext codes exactly once. */
  issue(userId: string, count?: number): Promise<{ codes: string[]; remaining: number }>
  status(userId: string): BackupCodeStatus
  /** Consumes an unused code (single-use). Never throws on bad input. */
  consume(userId: string, code: string): Promise<boolean>
  /** Drops the managed set entirely (e.g. on 2FA disable). */
  clear(userId: string): void
}

/**
 * In-memory store. `codesByUser` maps userId -> SHA-256 hex digests of the
 * unused codes; consuming splices the digest out, so each code works once.
 * An entry is kept even at zero remaining codes so `managed` stays true and
 * superseded enrollment codes cannot come back to life.
 */
export class MemoryBackupCodeStore implements BackupCodeStore {
  private readonly codesByUser = new Map<string, string[]>()

  async issue(userId: string, count = BACKUP_CODE_ISSUE_COUNT) {
    const codes = generateBackupCodes(count)
    const hashes = await Promise.all(codes.map(hashBackupCode))
    this.codesByUser.set(userId, hashes)
    return { codes, remaining: hashes.length }
  }

  status(userId: string): BackupCodeStatus {
    const hashes = this.codesByUser.get(userId)
    if (!hashes) return { managed: false, remaining: null }
    return { managed: true, remaining: hashes.length }
  }

  async consume(userId: string, code: string): Promise<boolean> {
    const hashes = this.codesByUser.get(userId)
    if (!hashes) return false
    // Cheap shape check before hashing: normalized backup codes are always
    // 8 chars from an unambiguous alphabet.
    if (normalizeBackupCode(code).length !== BACKUP_CODE_BODY_LENGTH) return false
    const hash = await hashBackupCode(code)
    // Single hash lookup — no per-code iteration, so comparison cost does not
    // leak which stored code (if any) was targeted.
    const index = hashes.indexOf(hash)
    if (index === -1) return false
    hashes.splice(index, 1)
    return true
  }

  clear(userId: string): void {
    this.codesByUser.delete(userId)
  }

  /** Test hook: number of managed users (not codes). */
  get managedUserCount(): number {
    return this.codesByUser.size
  }
}

let store: BackupCodeStore = new MemoryBackupCodeStore()

/** Single seam for the backup-code store (swap for a durable backend in prod). */
export function getBackupCodeStore(): BackupCodeStore {
  return store
}

/** Test hook: replaces the store. */
export function setBackupCodeStoreForTests(next: BackupCodeStore | undefined): void {
  store = next ?? new MemoryBackupCodeStore()
}

export function issueBackupCodes(
  userId: string,
  count = BACKUP_CODE_ISSUE_COUNT,
): Promise<{ codes: string[]; remaining: number }> {
  return getBackupCodeStore().issue(userId, count)
}

export function getBackupCodeStatus(userId: string): BackupCodeStatus {
  return getBackupCodeStore().status(userId)
}

export function consumeBackupCode(userId: string, code: string): Promise<boolean> {
  return getBackupCodeStore().consume(userId, code)
}

export function clearUserBackupCodes(userId: string): void {
  getBackupCodeStore().clear(userId)
}
