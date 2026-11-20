import { fail, isSameOriginRequest } from "@/lib/auth/http"
import { isNotificationStreamEvent } from "@/lib/notifications/events"
import { publishNotificationEvent } from "@/lib/notifications/hub"
import { notificationPrincipalFromRequest } from "@/lib/notifications/principal"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/notifications — publish a realtime notification event.
 *
 * Body is a single `NotificationStreamEvent` (`notification`, `read`, or
 * `read_all`; see `src/lib/notifications/events.ts`). The event is fanned out
 * through the in-memory hub to every stream connection held by the caller's
 * principal — other tabs and devices of the same user. Events can only ever
 * reach the publisher's own channel, so no cross-user targeting is possible.
 *
 * Server-side producers (agent runs, automations, …) should call
 * `publishNotificationEvent` directly once a backend exists; this route is
 * the client-side entry point used by `AppNotificationsProvider`.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }

  const principal = notificationPrincipalFromRequest(request)
  if (!principal) {
    return fail(401, "unauthenticated", "Sign in to publish notification updates.")
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Request body must be JSON.")
  }

  if (!isNotificationStreamEvent(body)) {
    return fail(400, "invalid_event", "Unsupported notification event.")
  }

  publishNotificationEvent(principal, body)
  return Response.json({ ok: true })
}
