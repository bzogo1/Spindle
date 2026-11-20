/**
 * Per-email resend cooldown for verification emails.
 *
 * Tracks the last successful send per address so `POST
 * /api/auth/verify-email/resend` can answer 429 + `retryAfter` instead of
 * mailing a fresh link on every request. State lives in this process only —
 * the same best-effort model as `createRateLimiter` in `@/lib/site-forms`:
 * it blunts casual abuse on a single instance, and a shared store (Redis/DB)
 * is the upgrade path if multi-instance enforcement becomes necessary.
 */

/** Default window between two verification emails to the same address. */
export const VERIFY_EMAIL_RESEND_COOLDOWN_SECONDS = 60
export const VERIFY_EMAIL_RESEND_COOLDOWN_MS = VERIFY_EMAIL_RESEND_COOLDOWN_SECONDS * 1000

export type ResendCooldown = {
  /**
   * Whole seconds until another send is allowed for `email`; 0 when a send
   * may proceed. Always >= 0.
   */
  remainingSeconds(email: string): number
  /** Records a successful send, (re)starting the cooldown window. */
  markSent(email: string): void
  /** Drops all tracked state. Intended for tests. */
  reset(): void
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function createResendCooldown({
  cooldownMs = VERIFY_EMAIL_RESEND_COOLDOWN_MS,
  now = () => Date.now(),
}: {
  cooldownMs?: number
  now?: () => number
} = {}): ResendCooldown {
  const lastSentAt = new Map<string, number>()

  // Opportunistic cleanup so the map cannot grow without bound under
  // sustained traffic with many distinct addresses.
  function prune(at: number) {
    if (lastSentAt.size < 500) return
    for (const [email, sentAt] of lastSentAt) {
      if (sentAt + cooldownMs <= at) lastSentAt.delete(email)
    }
  }

  return {
    remainingSeconds(email) {
      const sentAt = lastSentAt.get(normalizeEmail(email))
      if (sentAt === undefined) return 0
      const remainingMs = sentAt + cooldownMs - now()
      if (remainingMs <= 0) {
        lastSentAt.delete(normalizeEmail(email))
        return 0
      }
      return Math.ceil(remainingMs / 1000)
    },

    markSent(email) {
      const key = normalizeEmail(email)
      lastSentAt.set(key, now())
      prune(now())
    },

    reset() {
      lastSentAt.clear()
    },
  }
}

/**
 * Shared instance used by the resend route. Module-level like the in-memory
 * auth backend — per-process, reset between tests via `.reset()`.
 */
export const verifyEmailResendCooldown = createResendCooldown()
