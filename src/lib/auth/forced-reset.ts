/**
 * Forced password reset — per-user "must reset password" flag.
 *
 * An admin (or a future breach-response flow) marks an account as requiring
 * a password reset. While the flag is set:
 *
 *  - `POST /api/auth/signin` refuses to issue a session after credentials
 *    verify and answers `403 password_reset_required` instead (see
 *    `src/app/api/auth/signin/route.ts`).
 *  - `POST /api/auth/2fa/verify-login` re-checks the flag on the challenge
 *    payload so a TOTP/backup-code challenge issued before the flag was set
 *    cannot mint a session (see `src/app/api/auth/2fa/verify-login/route.ts`).
 *  - `GET /api/auth/forced-reset/status` reports the flag so the app shell
 *    can render a persistent banner (`ForcedResetBanner`).
 *  - `POST /api/auth/password/reset/confirm` clears the flag once the user
 *    actually sets a new password — the only path that lifts it.
 *
 * Like {@link MemorySignInLockout} and the auth audit log this is a
 * DEVELOPMENT store: flags live in a bounded in-memory map inside one
 * process and are lost on restart. Production MUST persist them behind the
 * same `getForcedResetStore`/`setForcedResetStoreForTests` seam (e.g. a
 * `mustResetPassword` column on the user record).
 *
 * NEVER store passwords, tokens, or request bodies here — only the flag,
 * an optional admin-supplied reason, and the actor id.
 */

export type ForcedResetRequirement = {
  /** Always `true` — a stored entry means the reset is mandatory. */
  required: true
  /** Optional human-readable reason shown to admins/auditors. */
  reason: string | null
  /** Id (or email) of the admin/actor who set the flag. */
  setBy: string | null
  /** ISO-8601 timestamp when the flag was set. */
  setAt: string
}

export type ForcedResetMeta = {
  reason?: string | null
  setBy?: string | null
}

export interface ForcedResetStore {
  /**
   * Sets (or refreshes) the forced-reset flag for `userId`. Re-requiring an
   * already-flagged user updates `reason`/`setBy`/`setAt` — the newest
   * requirement wins.
   */
  require(userId: string, meta?: ForcedResetMeta, now?: number): ForcedResetRequirement
  /** Lifts the flag. No-op when the user was not flagged. */
  clear(userId: string): void
  /**
   * Current flag for `userId`, or `null` when no reset is required. This is
   * the only read the enforcement paths need — `null` means "not forced".
   */
  get(userId: string): ForcedResetRequirement | null
}

/**
 * Bounds for the flag map. Flags are rare (admin-initiated), but a durable
 * seam swap could replay bulk imports; the cap keeps memory bounded the
 * same way the lockout store does. At the cap the oldest entries are
 * evicted — a cleared-by-eviction user simply is not forced anymore, which
 * fails open; acceptable for a dev store, and production persistence makes
 * it moot.
 */
export const FORCED_RESET_MAX_ENTRIES = 1000

function normalizeUserId(userId: string): string {
  return userId.trim()
}

/**
 * Bounded in-memory flag store. See the module docstring for the
 * persistence caveat.
 */
export class MemoryForcedResetStore implements ForcedResetStore {
  private readonly flags = new Map<string, ForcedResetRequirement>()

  require(
    userId: string,
    meta: ForcedResetMeta = {},
    now: number = Date.now(),
  ): ForcedResetRequirement {
    const key = normalizeUserId(userId)
    if (!key) throw new Error("require() needs a non-empty userId")
    // Re-insert so the entry moves to the newest position for eviction.
    this.flags.delete(key)
    const flag: ForcedResetRequirement = {
      required: true,
      reason: meta.reason?.trim() ? meta.reason.trim() : null,
      setBy: meta.setBy?.trim() ? meta.setBy.trim() : null,
      setAt: new Date(now).toISOString(),
    }
    this.flags.set(key, flag)
    while (this.flags.size > FORCED_RESET_MAX_ENTRIES) {
      const oldest = this.flags.keys().next()
      if (oldest.done) break
      this.flags.delete(oldest.value)
    }
    return flag
  }

  clear(userId: string): void {
    this.flags.delete(normalizeUserId(userId))
  }

  get(userId: string): ForcedResetRequirement | null {
    const key = normalizeUserId(userId)
    if (!key) return null
    const flag = this.flags.get(key)
    return flag ? { ...flag } : null
  }
}

let store: ForcedResetStore = new MemoryForcedResetStore()

/** Single seam for the flag store (swap for a durable backend in prod). */
export function getForcedResetStore(): ForcedResetStore {
  return store
}

/** Convenience boolean check used by the signin enforcement path. */
export function mustResetPassword(userId: string): boolean {
  return getForcedResetStore().get(userId) !== null
}

/** Test hook: replaces the flag store. */
export function setForcedResetStoreForTests(next: ForcedResetStore | undefined): void {
  store = next ?? new MemoryForcedResetStore()
}
