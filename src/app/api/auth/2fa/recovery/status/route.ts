import { clearUserBackupCodes } from "@/lib/auth/backup-codes"
import { getAuthBackend } from "@/lib/auth/backend"
import { sendAuthEmail } from "@/lib/auth/mailer"
import { accessTokenFromRequest, fail, ok } from "@/lib/auth/http"
import {
  getTotpRecoveryStore,
  recordRecoveryAuditEvent,
  recoverySecondsRemaining,
} from "@/lib/auth/totp-recovery"
import { auditContextFromRequest } from "@/lib/auth/audit"
import { logger } from "@/lib/logger"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/auth/2fa/recovery/status — recovery state for the signed-in user.
 *
 * Finalization is lazy and ATOMIC: `store.finalize` performs the
 * `cooldown → completed` transition only when `executeAt` has passed, and
 * exactly one concurrent caller observes the transition — only that caller
 * wipes the TOTP secret, drops backup codes, audits, and emails. Losers of
 * the race re-read state and report it without repeating side effects.
 *
 * The wipe goes through `startTotpEnrollment` — the backend seam that resets
 * secret, enabled flag, and enrollment backup codes without needing the
 * account password. A dedicated `AuthBackend.disableTotpForRecovery` is the
 * cleaner follow-up.
 */
export async function GET(request: Request) {
  const access = accessTokenFromRequest(request)
  if (!access) return fail(401, "unauthenticated", "Sign in required.")

  const backend = getAuthBackend()
  const user = await backend.getUserById(access.uid)
  if (!user) return fail(401, "unauthenticated", "Sign in required.")

  const store = getTotpRecoveryStore()
  const record = store.getActive(user.id)
  if (!record) return ok({ state: "none" })

  if (record.phase === "awaiting_token") {
    return ok({ state: "awaiting_token" })
  }

  const done = store.finalize(user.id)
  if (done) {
    // `startTotpEnrollment` resets totpSecret, totpEnabledAt and the
    // enrollment backup codes — exactly the "disable without password"
    // effect recovery needs.
    await backend.startTotpEnrollment(user.id)
    clearUserBackupCodes(user.id)

    recordRecoveryAuditEvent("completed", {
      userId: user.id,
      email: user.email,
      ...auditContextFromRequest(request),
      metadata: { executeAt: done.executeAt },
    })

    try {
      await sendAuthEmail({
        to: user.email,
        subject: "Two-factor authentication disabled — Spindle",
        text: [
          "The 72-hour cooldown on your Spindle two-factor recovery has ended.",
          "Two-factor authentication is now disabled and your previous authenticator secret no longer works.",
          "",
          "Sign in with your email and password, then re-enable two-factor authentication from your security settings.",
          "If you did not request this recovery, change your password immediately and review your account's active sessions.",
        ].join("\n"),
        linkPath: "/app/account/security",
      })
    } catch (error) {
      logger.warn(
        { event: "auth.2fa.recovery.notify-failed", userId: user.id },
        "Recovery completion email failed.",
      )
      void error
    }

    return ok({ state: "completed", enabled: false })
  }

  // finalize() returned null: either the cooldown hasn't elapsed (report the
  // countdown) or a concurrent request already completed/cancelled (report
  // the fresh state — "none" once the record is terminal).
  const current = store.getActive(user.id)
  if (!current) return ok({ state: "none" })
  if (current.phase === "cooldown") {
    return ok({
      state: "cooldown",
      executeAt: current.executeAt,
      secondsRemaining: recoverySecondsRemaining(current),
    })
  }
  return ok({ state: current.phase })
}
