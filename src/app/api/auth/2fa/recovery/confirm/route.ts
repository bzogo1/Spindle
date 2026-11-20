import {
  consumeBackupCode as consumeManagedBackupCode,
  getBackupCodeStatus,
} from "@/lib/auth/backup-codes"
import { getAuthBackend } from "@/lib/auth/backend"
import { accessTokenFromRequest, fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import {
  getTotpRecoveryStore,
  hashRecoveryToken,
  recordRecoveryAuditEvent,
  recoveryConfirmSchema,
} from "@/lib/auth/totp-recovery"
import { auditContextFromRequest } from "@/lib/auth/audit"
import { createRateLimiter, clientIp } from "@/lib/site-forms"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const limiter = createRateLimiter({ limit: 10, windowMs: 60 * 1000 })

/**
 * POST /api/auth/2fa/recovery/confirm — consumes the emailed recovery token
 * and moves the recovery into the cooldown phase. 2FA is NOT disabled here:
 * it stays on until `executeAt` (72h) so the account owner can cancel an
 * unauthorized request.
 *
 * Ordering (each step chosen to burn the cheapest thing first):
 *  1. Pending-recovery pre-check — no consumption at all, so a stray or
 *     replayed request can never invalidate a live link.
 *  2. Optional backup code — validated/consumed BEFORE the email token so a
 *     typo'd code returns 400 with the recovery link still usable.
 *  3. Email token consume + userId/hash checks — the backend only knows the
 *     shared `"verify"` kind, so `tokenHash` binding is what stops
 *     email-verification or other verify-kind tokens from driving recovery.
 *  4. Final awaiting_token re-check + `consumeToken` run synchronously with
 *     no intervening `await`, so a concurrent cancel cannot slip between
 *     them (JS runs the pair atomically).
 *
 * Residual: a VALID backup code submitted with an invalid/expired token is
 * still consumed (backup codes have no verify-only API). That requires the
 * caller to already hold session + pending recovery + a real code, so the
 * blast radius is one single-use code.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return fail(403, "forbidden", "Cross-origin request blocked.")
  if (!limiter.check(clientIp(request))) {
    return fail(429, "rate_limited", "Too many attempts. Try again later.")
  }

  const access = accessTokenFromRequest(request)
  if (!access) return fail(401, "unauthenticated", "Sign in required.")

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Invalid request body.")
  }
  const parsed = recoveryConfirmSchema.safeParse(body)
  if (!parsed.success) return fail(400, "invalid_request", "Invalid request body.")

  const backend = getAuthBackend()
  const user = await backend.getUserById(access.uid)
  if (!user) return fail(401, "unauthenticated", "Sign in required.")

  const store = getTotpRecoveryStore()
  // Step 1: pending-recovery pre-check before ANY consumption.
  const pending = store.getActive(user.id)
  if (!pending || pending.phase !== "awaiting_token") {
    return fail(409, "no_pending_recovery", "No recovery is waiting for confirmation.")
  }
  if (!(await backend.isTotpEnabled(user.id))) {
    return fail(403, "totp_not_enabled", "Two-factor authentication is not enabled.")
  }

  // Step 2: optional backup code, consumed before the email token so a bad
  // code never invalidates the recovery link. Same two-store rule as
  // verify-login — a managed set supersedes enrollment codes.
  if (parsed.data.backupCode) {
    const code = parsed.data.backupCode
    const okCode = getBackupCodeStatus(user.id).managed
      ? await consumeManagedBackupCode(user.id, code)
      : await backend.consumeBackupCode(user.id, code)
    if (!okCode) {
      recordRecoveryAuditEvent("failed", {
        userId: user.id,
        email: user.email,
        ...auditContextFromRequest(request),
        metadata: { step: "backup_code" },
      })
      return fail(400, "invalid_backup_code", "That backup code isn't valid.")
    }
  }

  // Step 3: consume + validate the email token.
  const consumed = await backend.consumeOneTimeToken(parsed.data.token, "verify")
  if (!consumed.ok) {
    const messages = {
      expired: "This recovery link has expired. Request a new one.",
      used: "This recovery link has already been used.",
      invalid: "This recovery link isn't valid.",
    } as const
    return fail(401, "invalid_token", messages[consumed.reason], {
      reason: consumed.reason,
    })
  }
  // The token must belong to the signed-in user — a valid token for a
  // different account must not confirm this user's recovery.
  if (consumed.record.userId !== user.id) {
    return fail(401, "invalid_token", "This recovery link isn't valid.", {
      reason: "invalid",
    })
  }
  // Purpose isolation: only the exact token bound at request time may
  // confirm. Any other "verify"-kind token (e.g. a 24h email-verification
  // link) fails here even though the backend kind matches.
  if (!pending.tokenHash || hashRecoveryToken(parsed.data.token) !== pending.tokenHash) {
    return fail(401, "invalid_token", "This recovery link isn't valid.", {
      reason: "invalid",
    })
  }

  // Step 4: synchronous re-check + transition — no `await` between them, so
  // a concurrent cancel cannot interleave (single-threaded JS).
  const stillPending = store.getActive(user.id)
  if (!stillPending || stillPending.phase !== "awaiting_token") {
    return fail(409, "no_pending_recovery", "No recovery is waiting for confirmation.")
  }
  const record = store.consumeToken(user.id)
  if (!record) {
    return fail(409, "no_pending_recovery", "No recovery is waiting for confirmation.")
  }

  recordRecoveryAuditEvent("token_verified", {
    userId: user.id,
    email: user.email,
    ...auditContextFromRequest(request),
    metadata: { backupCode: Boolean(parsed.data.backupCode) },
  })
  recordRecoveryAuditEvent("cooldown_started", {
    userId: user.id,
    email: user.email,
    ...auditContextFromRequest(request),
    metadata: { executeAt: record.executeAt },
  })

  return ok({ state: "cooldown", executeAt: record.executeAt })
}
