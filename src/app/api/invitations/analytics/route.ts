import { fail, ok } from "@/lib/auth/http"
import {
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
  AUTH_LIMITS,
} from "@/lib/auth-endpoint-rate-limit"
import { invitationStore } from "@/lib/invitations"
import { computeInvitationAnalytics } from "@/lib/invitation-analytics"

import { resolveInvitationActor } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const readLimiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

/**
 * GET /api/invitations/analytics — aggregate metrics over the caller's own
 * invitations (same inviter scoping as `GET /api/invitations`). Any
 * authenticated workspace member may read it: the numbers describe invites
 * THEY sent, not workspace-wide data, so no extra role gate is applied —
 * matching the list route, which is also available to every member.
 */
export async function GET(request: Request) {
  if (!readLimiter.check(clientIp(request))) return authRateLimited()

  const actor = await resolveInvitationActor(request)
  if (!actor) return fail(401, "unauthenticated", "Sign in to view invitation analytics.")

  const records = invitationStore.listForInviter(actor.inviterId)
  return ok({ analytics: computeInvitationAnalytics(records) })
}
