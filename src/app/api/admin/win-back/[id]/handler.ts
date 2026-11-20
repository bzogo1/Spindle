import { fail, ok } from "@/lib/auth/http"
import { unsubscribePageUrl } from "@/lib/email-unsubscribe"
import { runCampaign, WinBackError } from "@/lib/win-back"

/** Opt-out scope for win-back emails — matches `isWinBackSuppressed`. */
const WIN_BACK_UNSUBSCRIBE_SCOPE = "marketing"

/**
 * Shared handler for the two run entry points —
 * `POST /api/admin/win-back/[id]` and `POST /api/admin/win-back/[id]/run`.
 * Both execute `runCampaign` exactly once per call; there is no scheduler.
 *
 * Every sent email carries a per-recipient `/unsubscribe?token=…` link
 * built from the request origin so recipients can opt out.
 */
export async function runWinBackCampaign(id: string, request: Request) {
  try {
    const origin = new URL(request.url).origin
    const result = await runCampaign(id, {
      unsubscribeUrl: (email: string) =>
        unsubscribePageUrl({ email, origin, scope: WIN_BACK_UNSUBSCRIBE_SCOPE }),
    })
    return ok({
      campaign: result.campaign,
      candidates: result.candidates,
      sent: result.sent,
      suppressed: result.suppressed,
      failed: result.failed,
    })
  } catch (error) {
    if (error instanceof WinBackError) {
      const notFound = error.code === "not_found"
      return fail(notFound ? 404 : 400, notFound ? "not_found" : "invalid_request", error.message)
    }
    return fail(500, "internal", "Campaign run failed.")
  }
}
