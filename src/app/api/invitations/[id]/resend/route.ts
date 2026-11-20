import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { invitationResendCooldown, invitationStore } from "@/lib/invitations"
import { canManageInvites } from "@/lib/members/permissions"
import { logger } from "@/lib/logger"

import { deliverInvitationEmail, invitationView, resolveInvitationActor } from "../../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const limiter = createAuthRateLimiter(AUTH_LIMITS.emailSend)

type Params = { params: Promise<{ id: string }> }

function rateLimited(retryAfter: number): Response {
  const response = fail(
    429,
    "rate_limited",
    "Please wait a moment before resending this invitation.",
    { retryAfter },
  )
  response.headers.set("Retry-After", String(retryAfter))
  return response
}

/**
 * POST /api/invitations/[id]/resend — extends the expiry window, stamps a new
 * `lastSentAt`, and emails a FRESH accept-link token. Because tokens embed
 * `lastSentAt` (`sts`), every previously emailed link for this invite stops
 * resolving the moment the resend lands — only the newest email works.
 *
 * The per-email cooldown mirrors create: checked before the store mutation
 * so repeat clicks cannot mail-bomb the invitee.
 *
 * Expired-but-pending invites ARE resendable by design — resend is the
 * recovery path for lapsed invites (see `MemoryInvitationStore.resend`).
 * Accepted/revoked invites still 404 above.
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
  const existing = invitationStore.getById(id)
  // Same 404 for missing, foreign, and terminal invites — no enumeration.
  // "expired" is NOT terminal here: resend is the documented recovery path
  // for lapsed invites (the store flips them back to "pending").
  if (
    !existing ||
    existing.inviterId !== actor.inviterId ||
    (existing.status !== "pending" && existing.status !== "expired")
  ) {
    return fail(404, "not_found", "Invitation not found.")
  }

  const retryAfter = invitationResendCooldown.remainingSeconds(existing.email)
  if (retryAfter > 0) return rateLimited(retryAfter)

  const resent = invitationStore.resend(actor.inviterId, id)
  if (!resent) return fail(404, "not_found", "Invitation not found.")
  invitationResendCooldown.markSent(resent.email)

  try {
    await deliverInvitationEmail(resent)
  } catch (error) {
    logger.warn(
      { event: "invitations.resend-failed", invitationId: resent.id },
      "Invitation resend email could not be sent.",
    )
    void error
  }

  return ok({
    invitation: invitationView(resent),
    retryAfter: invitationResendCooldown.remainingSeconds(resent.email),
  })
}
