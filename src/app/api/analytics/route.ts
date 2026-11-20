import { fail, isSameOriginRequest, ok, readCookie } from "@/lib/auth/http"
import { CONSENT_COOKIE, CONSENT_VERSION } from "@/lib/consent"
import { parseAnalyticsEventsPayload, recordAnalyticsEvents } from "@/lib/analytics"
import { notificationPrincipalFromRequest } from "@/lib/notifications/principal"
import { clientIp, createRateLimiter } from "@/lib/site-forms"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/analytics — ingest consented product-analytics events.
 *
 * Body: `{ events: AnalyticsEventInput[] }` (1–20 events; see
 * `parseAnalyticsEventsPayload` in `src/lib/analytics.ts` for the schema).
 *
 * Gates, in order:
 *  1. Same-origin check (CSRF) — cookie-authenticated writes must not be
 *     triggerable cross-site.
 *  2. Per-IP rate limit (in-memory fixed window, same trade-off as the
 *     contact/newsletter forms).
 *  3. Consent cookie — the `spindle_consent` cookie must record an
 *     affirmative `analytics` choice at the current policy version. The
 *     client only sends after consent anyway; this is the server-side
 *     enforcement so direct POSTs can't bypass the banner.
 *
 * Events are attributed to the caller's session principal when a session
 * cookie is present (`user:<uid>` or `mock:<email>` via
 * `notificationPrincipalFromRequest`); otherwise they stay anonymous and are
 * keyed only by the client-generated `anonymousId`.
 */

// Generous for real usage (one event per navigation/interaction) while still
// blunting scripted floods; each request may carry up to 20 events.
const ingestLimiter = createRateLimiter({ limit: 300, windowMs: 60_000 })

function analyticsConsentGranted(request: Request): boolean {
  const raw = readCookie(request, CONSENT_COOKIE)
  if (!raw) return false
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; analytics?: unknown }
    return parsed.version === CONSENT_VERSION && parsed.analytics === true
  } catch {
    return false
  }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }

  if (!ingestLimiter.check(`ingest:${clientIp(request)}`)) {
    return fail(429, "rate_limited", "Too many analytics events. Try again later.")
  }

  if (!analyticsConsentGranted(request)) {
    return fail(403, "consent_required", "Analytics consent has not been granted.")
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Request body must be JSON.")
  }

  const events = parseAnalyticsEventsPayload(body)
  if (!events) {
    return fail(400, "invalid_events", "Unsupported analytics event payload.")
  }

  const principal = notificationPrincipalFromRequest(request)
  recordAnalyticsEvents(events, { userId: principal })

  return ok({ accepted: events.length })
}
