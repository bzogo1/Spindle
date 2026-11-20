import { z } from "zod"

import { fail, isSameOriginRequest } from "@/lib/auth/http"
import { createRateLimiter } from "@/lib/site-forms"
import { isDigestDue, sendNotificationDigest } from "@/lib/notifications/digest"
import { notificationRecipientFromRequest } from "@/lib/notifications/principal"
import { logger } from "@/lib/logger"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/notifications/digest — send the caller's notification email digest.
 *
 * The notification feed and preferences currently live client-side
 * (localStorage), so the caller supplies a snapshot:
 *
 *   { frequency: "daily" | "weekly",
 *     notifications: [{ title, body?, href?, category?, createdAt? }],
 *     preferences: { email, categories },          // sanitized server-side
 *     lastSentAt?: string }                        // ISO; enables cadence check
 *
 * The recipient is always the authenticated session's email — the body cannot
 * redirect the digest to another address. `lastSentAt` is optional because
 * nothing persists it yet; when provided and the cadence has not elapsed the
 * route answers `{ delivery: "not-due" }` without sending. Once a server-side
 * notifications store lands, a scheduler can call `sendNotificationDigest`
 * directly and this route becomes a manual/test trigger.
 */

const digestSchema = z.object({
  frequency: z.enum(["daily", "weekly"]),
  notifications: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        body: z.string().max(2000).optional(),
        href: z.string().max(500).optional(),
        category: z.string().max(50).optional(),
        createdAt: z.string().max(64).optional(),
      }),
    )
    .max(200),
  // Passed through `sanitizeDigestPreferences` — untrusted by design.
  preferences: z.unknown().optional(),
  lastSentAt: z.string().max(64).optional(),
})

// Best-effort per-instance limit keyed by recipient; see createRateLimiter.
const limiter = createRateLimiter({ limit: 10, windowMs: 60 * 60 * 1000 })

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }

  const recipient = notificationRecipientFromRequest(request)
  if (!recipient) {
    return fail(401, "unauthenticated", "Sign in to send a notification digest.")
  }

  if (!limiter.check(recipient)) {
    return fail(429, "rate_limited", "Too many digest requests. Try again later.")
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Request body must be JSON.")
  }

  const parsed = digestSchema.safeParse(body)
  if (!parsed.success) {
    return fail(400, "invalid_request", "Unsupported digest payload.")
  }

  const { frequency, notifications, preferences, lastSentAt } = parsed.data

  if (lastSentAt && !isDigestDue({ frequency, lastSentAt })) {
    return Response.json({ ok: true, delivery: "not-due" })
  }

  try {
    const result = await sendNotificationDigest({
      to: recipient,
      frequency,
      notifications,
      preferences,
    })

    logger.info(
      {
        event: "notifications.digest",
        delivery: result.delivery,
        itemCount: result.itemCount,
        overflowCount: result.overflowCount,
        frequency,
      },
      "Notification digest processed",
    )

    return Response.json({ ok: true, ...result })
  } catch (error) {
    logger.error(
      { event: "notifications.digest_failed", err: error },
      "Notification digest send failed",
    )
    return fail(502, "delivery_failed", "The digest could not be sent. Try again later.")
  }
}
