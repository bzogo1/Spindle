import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { invitationStore } from "@/lib/invitations"
import type { EmailDelivery } from "@/lib/email"
import { canManageInvites } from "@/lib/members/permissions"
import { logger } from "@/lib/logger"

import {
  deliverInvitationReminderEmail,
  invitationView,
  resolveInvitationActor,
} from "../../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const limiter = createAuthRateLimiter(AUTH_LIMITS.emailSend)

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/invitations/[id]/remind — sends the invitee a reminder email
 * containing the EXISTING accept link. Unlike resend this does not rotate
 * the token or extend expiry: the link in the original invite email keeps
 * working, and the invitee only ever holds one valid link. Resend remains
 * the recovery path for expired invites.
 *
 * Manual reminders share the automated tick's budget: at most
 * INVITATION_REMINDER_MAX_COUNT per invite and a minimum interval between
 * sends. Unlike the tick there is NO near-expiry window restriction —
 * `remind` is an eligibility check only and allows reminders at any point
 * while the invite is pending (intentional; see the store docs).
 *
 * The reminder counter is stamped via `markReminder` only AFTER the provider
 * accepts the email, so an unconfigured provider ("unconfigured") or a send
 * failure never burns reminder budget — the caller gets an honest error and
 * can retry. `markReminder` re-validates cap/interval atomically, so a
 * concurrent remind cannot push the counter past the cap.
 */
export async function POST(request: Request, { params }: Params) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const actor = await resolveInvitationActor(request)
  if (!actor) return fail(401, "unauthenticated", "Sign in to manage invitations.")
  if (!canManageInvites(actor.role)) {
    return fail(403, "forbidden", "Your role cannot manage invitations.")
  }

  const { id } = await params
  const result = invitationStore.remind(actor.inviterId, id)
  if (!result.ok) {
    switch (result.reason) {
      case "expired":
        return fail(
          410,
          "invite_expired",
          "This invitation has expired. Resend it to issue a fresh link.",
        )
      case "cap":
        return fail(409, "reminder_limit", "This invitation has reached its reminder limit.")
      case "cooldown": {
        const response = fail(
          429,
          "rate_limited",
          "Please wait before sending another reminder for this invitation.",
          { retryAfter: result.retryAfterSeconds ?? 0 },
        )
        response.headers.set("Retry-After", String(result.retryAfterSeconds ?? 0))
        return response
      }
      default:
        return fail(404, "not_found", "Invitation not found.")
    }
  }

  let delivery: EmailDelivery
  try {
    delivery = await deliverInvitationReminderEmail(result.invitation)
  } catch (error) {
    logger.warn(
      { event: "invitations.reminder-failed", invitationId: result.invitation.id },
      "Invitation reminder email could not be sent.",
    )
    void error
    return fail(502, "email_send_failed", "The reminder email could not be sent. Try again.")
  }
  if (delivery === "unconfigured") {
    // No RESEND_API_KEY — nothing was delivered. Do NOT stamp the reminder
    // counter: burning a slot here would be phantom budget.
    return fail(503, "email_unconfigured", "Email delivery is not configured on this server.")
  }

  // Atomic re-validation: a concurrent remind may have consumed the last
  // slot or restarted the interval while the email was in flight. The send
  // already happened either way; the counter just stays honest.
  invitationStore.markReminder(result.invitation.id)

  const updated = invitationStore.getById(result.invitation.id)
  return ok({ invitation: invitationView(updated ?? result.invitation) })
}
