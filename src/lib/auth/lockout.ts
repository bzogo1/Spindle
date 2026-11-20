/**
 * Account lockout — progressive backoff for repeated failed password
 * sign-ins.
 *
 * Two failure dimensions are tracked independently:
 *
 *  - `ip + email` pair — a single source hammering one account locks quickly
 *    (5 failures in 10 minutes → 15 minute lock, doubling on repeat up to 1h).
 *  - `email` alone — distributed guessing across many IPs still locks the
 *    account (8 failures in 10 minutes → 30 minute lock, doubling up to 4h).
 *
 * The effective lock is the stricter of the two. A successful sign-in (or a
 * correct password that advances to the TOTP challenge) clears all state for
 * the email, including every IP pair.
 *
 * Anti-enumeration: lock state is keyed ONLY on the submitted email string
 * (and source IP). It never consults whether an account exists, so unknown
 * emails accumulate failures and lock identically to real ones — the route
 * returns the same 429 + `retryAfter` envelope either way. The trade-off is
 * that an attacker who knows a victim's email can keep it locked; that is
 * inherent to account lockout and is surfaced to the user via the existing
 * `brute_force` login alert (see `login-alerts.ts` — alerts are notification,
 * this module is enforcement; it deliberately does not create alerts).
 *
 * Like {@link MemoryAuthBackend} and the auth audit log this is a DEVELOPMENT
 * store: state lives in a bounded in-memory map inside one process and is
 * lost on restart. Production MUST persist it behind the same
 * `getSignInLockout`/`setSignInLockoutForTests` seam.
 *
 * NEVER store passwords, tokens, or request bodies here — only timestamps.
 */

export type LockoutStatus = {
  locked: boolean
  /** Epoch ms when the lock lifts; null when not locked. */
  lockedUntil: number | null
  /** Whole seconds until unlock (rounded up); 0 when not locked. */
  retryAfterSeconds: number
}

export interface SignInLockout {
  /**
   * Current lock state for an (email, ip) pair WITHOUT recording anything.
   * Unknown emails are tracked exactly like known ones.
   */
  check(email: string, ip?: string | null, now?: number): LockoutStatus
  /**
   * Records one failed sign-in attempt and returns the resulting lock state.
   * Attempts made while already locked do not extend the lock — the lock
   * expires on the schedule set when it was triggered.
   */
  recordFailure(email: string, ip?: string | null, now?: number): LockoutStatus
  /** Clears all failure and lock state for the email (all IP pairs too). */
  recordSuccess(email: string, now?: number): void
  /** Diagnostics: number of tracked keys per dimension. */
  size(): { emails: number; pairs: number }
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

/** Failed attempts older than this no longer count toward a lock. */
export const LOCKOUT_FAILURE_WINDOW_MS = 10 * 60 * 1000
/** Consecutive-ish failures on one ip+email pair that trigger a pair lock. */
export const LOCKOUT_PAIR_THRESHOLD = 5
/** Failures across all IPs for one email that trigger an account lock. */
export const LOCKOUT_EMAIL_THRESHOLD = 8
/** First pair lock duration; each repeat doubles it up to the cap. */
export const LOCKOUT_PAIR_BASE_MS = 15 * 60 * 1000
export const LOCKOUT_PAIR_MAX_MS = 60 * 60 * 1000
/** First account-wide lock duration; each repeat doubles it up to the cap. */
export const LOCKOUT_EMAIL_BASE_MS = 30 * 60 * 1000
export const LOCKOUT_EMAIL_MAX_MS = 4 * 60 * 60 * 1000
/**
 * How long the escalation level survives after the last lock. Past this,
 * a fresh attack starts again at the base duration instead of the maximum.
 */
export const LOCKOUT_ESCALATION_DECAY_MS = 24 * 60 * 60 * 1000

/**
 * Bounds for the tracking maps. Once the tracked-key count passes
 * {@link LOCKOUT_PRUNE_THRESHOLD} stale entries are swept; at
 * {@link LOCKOUT_MAX_ENTRIES} the oldest entries are evicted so a spray of
 * unique emails cannot grow memory without bound (same opportunistic-prune
 * pattern as `createRateLimiter` in site-forms).
 */
export const LOCKOUT_PRUNE_THRESHOLD = 500
export const LOCKOUT_MAX_ENTRIES = 1000

const PAIR_KEY_SEPARATOR = "\u001f"

const UNLOCKED: LockoutStatus = { locked: false, lockedUntil: null, retryAfterSeconds: 0 }

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function normalizeIp(ip: string | null | undefined): string {
  return ip?.trim() ?? ""
}

type LockoutPolicy = {
  threshold: number
  windowMs: number
  baseLockMs: number
  maxLockMs: number
}

type LockoutEntry = {
  /** Failed-attempt timestamps inside the tracking window (ascending). */
  failures: number[]
  /** Epoch ms when the current lock lifts; 0 when not locked. */
  lockedUntil: number
  /** Number of consecutive lockouts (drives exponential backoff). */
  lockCount: number
  /** Epoch ms of the most recent lock trigger (escalation decay anchor). */
  lastLockAt: number
  /** Epoch ms of the most recent activity (LRU eviction anchor). */
  lastSeenAt: number
}

function freshEntry(now: number): LockoutEntry {
  return { failures: [], lockedUntil: 0, lockCount: 0, lastLockAt: 0, lastSeenAt: now }
}

function statusFor(entry: LockoutEntry | undefined, now: number): LockoutStatus {
  if (!entry || entry.lockedUntil <= now) return UNLOCKED
  return {
    locked: true,
    lockedUntil: entry.lockedUntil,
    retryAfterSeconds: Math.max(1, Math.ceil((entry.lockedUntil - now) / 1000)),
  }
}

function worseStatus(a: LockoutStatus, b: LockoutStatus): LockoutStatus {
  if (!a.locked) return b
  if (!b.locked) return a
  const lockedUntil = Math.max(a.lockedUntil ?? 0, b.lockedUntil ?? 0)
  return {
    locked: true,
    lockedUntil,
    retryAfterSeconds: Math.max(a.retryAfterSeconds, b.retryAfterSeconds),
  }
}

/**
 * Failure tracker for one dimension (email, or ip+email pair). All policy
 * math lives here so the two dimensions stay perfectly symmetric.
 */
class DimensionTracker {
  private readonly entries = new Map<string, LockoutEntry>()

  constructor(
    private readonly policy: LockoutPolicy,
    private readonly now: () => number = () => Date.now(),
  ) {}

  status(key: string, at: number): LockoutStatus {
    return statusFor(this.entries.get(key), at)
  }

  recordFailure(key: string, at: number): LockoutStatus {
    let entry = this.entries.get(key)
    if (entry && entry.lockedUntil > at) {
      // Already locked: reject without recording so the lock cannot be
      // extended (or shortened) by continued hammering.
      entry.lastSeenAt = at
      return statusFor(entry, at)
    }

    if (!entry) {
      this.ensureCapacity(at)
      entry = freshEntry(at)
      this.entries.set(key, entry)
    } else {
      // Re-insert so the entry moves to the newest position for LRU eviction.
      this.entries.delete(key)
      this.entries.set(key, entry)
    }
    entry.lastSeenAt = at

    const cutoff = at - this.policy.windowMs
    let start = 0
    while (start < entry.failures.length && entry.failures[start] <= cutoff) start += 1
    if (start > 0) entry.failures = entry.failures.slice(start)
    entry.failures.push(at)

    if (entry.failures.length >= this.policy.threshold) {
      const escalated = at - entry.lastLockAt > LOCKOUT_ESCALATION_DECAY_MS ? 0 : entry.lockCount
      entry.lockCount = escalated + 1
      const duration = Math.min(
        this.policy.baseLockMs * 2 ** (entry.lockCount - 1),
        this.policy.maxLockMs,
      )
      entry.lockedUntil = at + duration
      entry.lastLockAt = at
    }

    return statusFor(entry, at)
  }

  clear(key: string): void {
    this.entries.delete(key)
  }

  /** Removes every key accepted by `match` (used to clear all IP pairs). */
  clearWhere(match: (key: string) => boolean): void {
    for (const key of this.entries.keys()) {
      if (match(key)) this.entries.delete(key)
    }
  }

  size(): number {
    return this.entries.size
  }

  /**
   * Drops entries that can no longer produce a lock or affect escalation:
   * unlocked, with every failure outside the window, and inactive past the
   * escalation decay. Then evicts oldest-first if still at the hard cap.
   */
  private ensureCapacity(at: number): void {
    if (this.entries.size < LOCKOUT_PRUNE_THRESHOLD) return
    for (const [key, entry] of this.entries) {
      const failuresStale = entry.failures.every((t) => t <= at - this.policy.windowMs)
      const lastActivity = Math.max(
        entry.lastLockAt,
        entry.failures.length > 0 ? entry.failures[entry.failures.length - 1] : 0,
      )
      if (
        entry.lockedUntil <= at &&
        failuresStale &&
        at - lastActivity > LOCKOUT_ESCALATION_DECAY_MS
      ) {
        this.entries.delete(key)
      }
    }
    while (this.entries.size >= LOCKOUT_MAX_ENTRIES) {
      const oldest = this.entries.keys().next()
      if (oldest.done) return
      this.entries.delete(oldest.value)
    }
  }
}

const PAIR_POLICY: LockoutPolicy = {
  threshold: LOCKOUT_PAIR_THRESHOLD,
  windowMs: LOCKOUT_FAILURE_WINDOW_MS,
  baseLockMs: LOCKOUT_PAIR_BASE_MS,
  maxLockMs: LOCKOUT_PAIR_MAX_MS,
}

const EMAIL_POLICY: LockoutPolicy = {
  threshold: LOCKOUT_EMAIL_THRESHOLD,
  windowMs: LOCKOUT_FAILURE_WINDOW_MS,
  baseLockMs: LOCKOUT_EMAIL_BASE_MS,
  maxLockMs: LOCKOUT_EMAIL_MAX_MS,
}

function pairKey(email: string, ip: string | null | undefined): string {
  return `${email}${PAIR_KEY_SEPARATOR}${normalizeIp(ip)}`
}

function pairKeyPrefix(email: string): string {
  return `${email}${PAIR_KEY_SEPARATOR}`
}

/**
 * Bounded in-memory lockout store. See the module docstring for the policy
 * and the anti-enumeration contract.
 */
export class MemorySignInLockout implements SignInLockout {
  private readonly emails: DimensionTracker
  private readonly pairs: DimensionTracker

  constructor(now: () => number = () => Date.now()) {
    this.emails = new DimensionTracker(EMAIL_POLICY, now)
    this.pairs = new DimensionTracker(PAIR_POLICY, now)
  }

  check(email: string, ip?: string | null, now?: number): LockoutStatus {
    const at = now ?? Date.now()
    const key = normalizeEmail(email)
    if (!key) return UNLOCKED
    return worseStatus(this.emails.status(key, at), this.pairs.status(pairKey(key, ip), at))
  }

  recordFailure(email: string, ip?: string | null, now?: number): LockoutStatus {
    const at = now ?? Date.now()
    const key = normalizeEmail(email)
    if (!key) return UNLOCKED
    // While either dimension is locked the attempt is rejected before
    // credential evaluation (the route returns 429 without calling the
    // backend), so it must not count as a failure in the OTHER dimension
    // either — otherwise a pair lock could silently escalate into an
    // account-wide lock. Mirrors the route's check-then-record flow.
    const current = worseStatus(
      this.emails.status(key, at),
      this.pairs.status(pairKey(key, ip), at),
    )
    if (current.locked) return current
    // Record in both dimensions, then report the stricter outcome. When the
    // failure crosses a threshold the tracker locks immediately, so `locked`
    // here means "this attempt triggered the lock" (check() ran first).
    const emailStatus = this.emails.recordFailure(key, at)
    const pairStatus = this.pairs.recordFailure(pairKey(key, ip), at)
    return worseStatus(emailStatus, pairStatus)
  }

  recordSuccess(email: string, _now?: number): void {
    const key = normalizeEmail(email)
    if (!key) return
    this.emails.clear(key)
    // Pair keys are `${email}\u001f${ip}` — clear every IP pair for the email.
    this.pairs.clearWhere((k) => k.startsWith(pairKeyPrefix(key)))
  }

  size(): { emails: number; pairs: number } {
    return { emails: this.emails.size(), pairs: this.pairs.size() }
  }
}

let lockoutStore: SignInLockout = new MemorySignInLockout()

/** Single seam for the lockout store (swap for a durable backend in prod). */
export function getSignInLockout(): SignInLockout {
  return lockoutStore
}

/** Test hook: replaces the lockout store. */
export function setSignInLockoutForTests(next: SignInLockout | undefined): void {
  lockoutStore = next ?? new MemorySignInLockout()
}
