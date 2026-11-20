import { fail, ok } from "@/lib/auth/http"
import { getEmailChangeStatus, resolveEmailChangeIdentity } from "@/lib/email-change"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/auth/email-change — effective sign-in email plus any pending
 * change (new address, timestamps, resend cooldown) for the session.
 */
export async function GET(request: Request) {
  const identity = await resolveEmailChangeIdentity(request)
  if (!identity) {
    return fail(401, "unauthenticated", "Sign in to view your email settings.")
  }
  return ok({ emailChange: getEmailChangeStatus(identity) })
}
