import { timingSafeEqual } from "node:crypto"

import { fail } from "@/lib/auth/http"
import { getServerEnv } from "@/lib/env.server"
import { invitationStore } from "@/lib/invitations"
import type { EmailDelivery } from "@/lib/email"
import { clientIp, createRateLimiter } from "@/lib/site-forms"
import { logger } from "@/lib/logger"

import { deliverInvitationReminderEmail } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Best-effort per-instance limit; see createRateLimiter for caveats.
const limiter = createRateLimiter({ limit: 30, windowMs: 60 * 60 * 1000 })

function bearerMatches(token: string, secret: string): boolean {
  const left = Buffer.from(token)
  const right = Buffer.from(secret)
  return left.length === right.length && timingSafeEqual(left, right)
}

/**
 * POST /api/invitations/tick — cron entry point for invitation expiry sweeps
 * and automated reminder emails.
 *
 * Each tick:
 *  1. `sweepExpired()` flips past-due pending invites to `"expired"`;
 *  2. `pendingReminders()` returns live invites inside the last 24h of their
 *     expiry window that still have reminder budget (max 3 per invite,
 *     min 8h apart — shared with the manual remind route);
 *  3. each eligible invite gets a reminder email carrying its EXISTING
 *     accept link (no token rotation, no expiry extension), then
 *     `markReminder()` stamps the send — but ONLY when the provider
 *     actually accepted it (`"sent"`). An "unconfigured" outcome (no
 *     RESEND_API_KEY) or a thrown error skips the stamp, so failed
 *     deliveries never burn reminder budget; the invite stays eligible
 *     for the next tick. `markReminder` re-validates cap/interval
 *     atomically, so a concurrent manual remind cannot push the counter
 *     past the cap.
 *
 * Auth mirrors `/api/email-series/tick`:
 *  - `SESSION_SECRET` set → requires `Authorization: Bearer <secret>`.
 *  - `SESSION_SECRET` unset → allowed only outside production; in
 *    production the route fails closed with 503.
 */
export async function POST(request: Request) {
  if (!limiter.check(clientIp(request))) {
    return fail(429, "rate_limited", "Too many attempts. Try again later.")
  }

  const env = getServerEnv()
  const secret = env.SESSION_SECRET
  if (!secret) {
    if (env.NODE_ENV === "production") {
      return fail(
        503,
        "unconfigured",
        "SESSION_SECRET is required to authorize ticks in production.",
      )
    }
  } else {
    const header = request.headers.get("authorization") ?? ""
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : ""
    if (!token || !bearerMatches(token, secret)) {
      return fail(401, "unauthorized", "A valid bearer token is required.")
    }
  }

  try {
    const swept = invitationStore.sweepExpired()
    const due = invitationStore.pendingReminders()

    let sent = 0
    let failed = 0
    let unconfigured = 0
    for (const record of due) {
      let delivery: EmailDelivery
      try {
        delivery = await deliverInvitationReminderEmail(record)
      } catch (error) {
        failed += 1
        logger.warn(
          { event: "invitations.tick.reminder-failed", invitationId: record.id },
          "Invitation reminder could not be sent; will retry next tick.",
        )
        void error
        continue
      }
      if (delivery === "unconfigured") {
        // No provider configured — nothing was delivered. Skip the stamp so
        // the reminder budget is not burned on phantom sends; the invite
        // stays eligible and the tick reports the gap honestly.
        unconfigured += 1
        logger.warn(
          { event: "invitations.tick.reminder-unconfigured", invitationId: record.id },
          "Invitation reminder skipped: email provider is not configured.",
        )
        continue
      }
      // Re-validates cap/interval atomically — a manual remind may have
      // claimed this invite's last slot while the email was in flight. The
      // send already happened; a null return just means the counter was
      // already consumed, which is fine.
      invitationStore.markReminder(record.id)
      sent += 1
    }

    const summary = {
      swept: swept.length,
      eligible: due.length,
      sent,
      failed,
      unconfigured,
    }
    logger.info({ event: "invitations.tick", ...summary }, "Invitation tick completed")
    return Response.json({ ok: true, ...summary })
  } catch (error) {
    logger.error({ event: "invitations.tick_failed", err: error }, "Invitation tick failed")
    return fail(500, "tick_failed", "The invitation tick failed.")
  }
}
