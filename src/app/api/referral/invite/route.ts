import { z } from "zod"

import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { sendEmail } from "@/lib/email"
import { logger } from "@/lib/logger"
import { composeReferralInviteEmail, isReferralEmailSuppressed } from "@/lib/referral-emails"
import {
  getOrCreateReferralCode,
  getReferralCodeByCode,
  getReferralProgramSettings,
} from "@/lib/referral-program"
import { resolveReferralCaller, type ReferralCaller } from "../caller"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/referral/invite — email a referral invite to a friend.
 *
 * Authenticated (`resolveReferralCaller`, same as `/api/referral/program`).
 * Body: `{ email, code? }` where `email` is the friend's address (zod
 * `z.email()`, max 320) and `code` is an optional `SPN-…` code.
 *
 * Code handling: the invite always carries the *caller's own* share link —
 * `code` is honored only when it resolves to a referral-code record owned by
 * the caller (e.g. pinning a vanity code); anything else falls back to the
 * caller's canonical code, which is created on first use. This keeps the
 * endpoint from being used to send invites under someone else's code.
 *
 * The email is composed by `composeReferralInviteEmail` (share URL + UTM,
 * optional reward mention from program settings, per-recipient
 * `"marketing"`-scoped unsubscribe link). Addresses that opted out of
 * marketing/newsletter/all are skipped silently.
 *
 * RESPONSE POLICY: every valid request returns the same generic `200 {}` —
 * suppressed addresses, send failures, and unconfigured delivery are all
 * indistinguishable, and nothing about the invite is persisted (no
 * sensitive record is written; the attribution store only sees clicks that
 * actually happen later via `/r/<code>`). Only malformed JSON/schema
 * violations, cross-origin requests, missing auth, and rate limiting fail.
 *
 * Rate limited per IP with the `emailSend` preset (5 / 10 min) since each
 * call can trigger outbound mail; same-origin enforced.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.emailSend)

const inviteSchema = z.object({
  email: z.email("Enter a valid email address.").max(320),
  code: z.string().trim().min(1).max(64).optional(),
})

/** Best-effort display name for the "X invited you" copy. */
async function referrerDisplayName(caller: ReferralCaller): Promise<string | undefined> {
  if (caller.userId.startsWith("mock:")) return undefined
  try {
    const mod = await import("@/lib/auth/backend")
    const user = await mod.getAuthBackend().getUserById(caller.userId)
    const name = user?.name?.trim()
    return name || undefined
  } catch {
    return undefined
  }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const caller = await resolveReferralCaller(request).catch(() => null)
  if (!caller) {
    return fail(401, "unauthorized", "Sign in required.")
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Request body must be JSON.")
  }

  const parsed = inviteSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid invite request."
    return fail(400, "invalid_request", message)
  }

  const recipientEmail = parsed.data.email.trim().toLowerCase()

  // Resolve the share code: honor `code` only when it is a valid referral
  // code owned by the caller; otherwise fall back to the caller's own code
  // (created on first use). Program disabled → no invite is sent, but the
  // response stays generic.
  let code: string | null = null
  try {
    const settings = getReferralProgramSettings()
    if (settings.enabled) {
      const own = getOrCreateReferralCode(caller.userId)
      code = own.code
      if (parsed.data.code) {
        const requested = getReferralCodeByCode(parsed.data.code)
        if (requested && requested.userId === caller.userId) {
          code = requested.code
        }
      }
    }
  } catch (error) {
    logger.warn(
      {
        event: "referral.invite_code_failed",
        error: error instanceof Error ? error.message : String(error),
      },
      "Referral invite code resolution failed",
    )
  }

  if (!code) return ok({})

  // Opt-out suppression — checked before composing so no token work or
  // send attempt happens for suppressed addresses.
  if (isReferralEmailSuppressed(recipientEmail)) {
    logger.info(
      { event: "referral.invite_suppressed" },
      "Referral invite suppressed by email opt-out",
    )
    return ok({})
  }

  try {
    const referrerName = await referrerDisplayName(caller)
    const composed = composeReferralInviteEmail({
      recipientEmail,
      ...(referrerName ? { referrerName } : {}),
      code,
    })
    await sendEmail({
      to: recipientEmail,
      subject: composed.subject,
      text: composed.text,
      html: composed.html,
    })
    logger.info({ event: "referral.invite_sent" }, "Referral invite emailed")
  } catch (error) {
    // Delivery failures are logged but never surfaced — the response must
    // not reveal whether the address exists or was mailed.
    logger.warn(
      {
        event: "referral.invite_failed",
        error: error instanceof Error ? error.message : String(error),
      },
      "Referral invite email failed",
    )
  }

  return ok({})
}
