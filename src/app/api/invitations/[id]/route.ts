import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { invitationStore } from "@/lib/invitations"
import { canManageInvites } from "@/lib/members/permissions"

import { invitationView, resolveInvitationActor } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

/**
 * DELETE /api/invitations/[id] — revokes a pending invitation. Ownership is
 * enforced inside the store (`inviterId` scope); missing, terminal, or
 * foreign invites all answer 404 so the endpoint cannot probe other
 * inviters' invite ids.
 */
export async function DELETE(request: Request, { params }: Params) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }

  const actor = await resolveInvitationActor(request)
  if (!actor) return fail(401, "unauthenticated", "Sign in to manage invitations.")
  if (!canManageInvites(actor.role)) {
    return fail(403, "forbidden", "Your role cannot manage invitations.")
  }

  const { id } = await params
  const revoked = invitationStore.revoke(actor.inviterId, id)
  if (!revoked) return fail(404, "not_found", "Invitation not found.")
  return ok({ invitation: invitationView(revoked) })
}
