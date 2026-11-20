import { z } from "zod"

import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { emailField } from "@/lib/auth/schemas"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { invitationResendCooldown, invitationStore } from "@/lib/invitations"
import { canAssignRole, canInviteMembers, isWorkspaceRole } from "@/lib/members/permissions"
import { logger } from "@/lib/logger"

import { deliverInvitationEmail, invitationView, resolveInvitationActor } from "./_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const limiter = createAuthRateLimiter(AUTH_LIMITS.emailSend)
const readLimiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const createSchema = z.object({
  email: emailField,
  role: z.string(),
})

function rateLimited(retryAfter: number): Response {
  const response = fail(
    429,
    "rate_limited",
    "Please wait a moment before sending another invitation.",
    { retryAfter },
  )
  response.headers.set("Retry-After", String(retryAfter))
  return response
}

/**
 * GET /api/invitations — lists the caller's invitations, newest first.
 * Pending invites past their expiry report `status: "expired"`.
 */
export async function GET(request: Request) {
  // Same per-IP budget as the other public read endpoints — the list is
  // behind auth, but the limiter still bounds cookie-guessing/ scraping.
  if (!readLimiter.check(clientIp(request))) return authRateLimited()

  const actor = await resolveInvitationActor(request)
  if (!actor) return fail(401, "unauthenticated", "Sign in to view invitations.")

  const invitations = invitationStore
    .listForInviter(actor.inviterId)
    .map((record) => invitationView(record))
  return ok({ invitations })
}

/**
 * POST /api/invitations — creates a pending invitation and emails the accept
 * link. RBAC mirrors the members screen: owner/admin only, and admins can
 * never grant `owner` (`canInviteMembers`/`canAssignRole`).
 *
 * The per-email cooldown is checked after permission checks but BEFORE the
 * store write, so a rejected duplicate still consumes the window — same
 * anti-retry-storm semantics as the verify-email resend route.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const actor = await resolveInvitationActor(request)
  if (!actor) return fail(401, "unauthenticated", "Sign in to send invitations.")

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Request body must be JSON.")
  }
  const parsed = createSchema.safeParse(body)
  if (!parsed.success || !isWorkspaceRole(parsed.data.role)) {
    return fail(400, "invalid_request", "Enter a valid email address and role.")
  }
  const { email, role } = parsed.data

  if (!canInviteMembers(actor.role) || !canAssignRole(actor.role, role)) {
    return fail(403, "forbidden", "Your role cannot send invitations for that role.")
  }
  if (email === actor.email) {
    return fail(422, "cannot_invite_self", "You cannot invite your own address.")
  }

  const retryAfter = invitationResendCooldown.remainingSeconds(email)
  if (retryAfter > 0) return rateLimited(retryAfter)
  invitationResendCooldown.markSent(email)

  const result = invitationStore.create({
    email,
    role,
    inviter: { id: actor.inviterId, email: actor.email, name: actor.name },
    workspaceName: actor.workspaceName,
    workspaceId: actor.workspaceId,
  })
  if (!result.ok) {
    // A live pending invite already exists for this address — hand it back so
    // the client can offer "resend" instead of a bare error.
    return fail(409, "duplicate_pending", "A pending invitation already exists for this email.", {
      invitation: result.invitation ? invitationView(result.invitation) : undefined,
    })
  }

  // Delivery is best-effort: the invite exists either way, and unconfigured
  // providers already log the accept link in development via sendAuthEmail.
  try {
    await deliverInvitationEmail(result.invitation)
  } catch (error) {
    logger.warn(
      { event: "invitations.deliver-failed", invitationId: result.invitation.id },
      "Invitation email could not be sent.",
    )
    void error
  }

  return ok({ invitation: invitationView(result.invitation) })
}
