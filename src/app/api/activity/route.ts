import { fail, isSameOriginRequest } from "@/lib/auth/http"
import { publishActivityEvent } from "@/lib/activity/hub"
import { isActivityStreamEvent } from "@/lib/activity/events"
import { notificationPrincipalFromRequest } from "@/lib/notifications/principal"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/activity — publish a realtime activity event.
 *
 * Body is a single `ActivityStreamEvent` (`{ type: "activity", activity }`;
 * see `src/lib/activity/events.ts`). The event is fanned out through the
 * in-memory hub to every stream connection held by the caller's principal —
 * other tabs and devices of the same user. Events can only ever reach the
 * publisher's own channel, so no cross-user targeting is possible.
 *
 * This mirrors `POST /api/notifications`. The session-principal resolver is
 * shared (`notificationPrincipalFromRequest` is a generic session → channel
 * key mapping, not notification-specific). Server-side producers (agent
 * runs, automations, …) should call `publishActivityEvent` directly once a
 * backend exists; this route is the client-side entry point used by
 * `pushActivityEvent` in `src/lib/activity/client.ts`.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }

  const principal = notificationPrincipalFromRequest(request)
  if (!principal) {
    return fail(401, "unauthenticated", "Sign in to publish activity updates.")
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Request body must be JSON.")
  }

  if (!isActivityStreamEvent(body)) {
    return fail(400, "invalid_event", "Unsupported activity event.")
  }

  publishActivityEvent(principal, body)
  return Response.json({ ok: true })
}
