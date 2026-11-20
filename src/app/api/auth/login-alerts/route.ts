import { z } from "zod"

import { getAuthBackend } from "@/lib/auth/backend"
import { accessTokenFromRequest, fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { getLoginAlertStore } from "@/lib/auth/login-alerts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const markReadSchema = z.object({
  action: z.literal("mark_read"),
  ids: z.array(z.string().min(1).max(100)).min(1).max(200),
})

const markAllReadSchema = z.object({
  action: z.literal("mark_all_read"),
})

const preferencesSchema = z.object({
  action: z.literal("update_preferences"),
  preferences: z
    .object({
      inAppNotifications: z.boolean().optional(),
      emailNotifications: z.boolean().optional(),
    })
    .refine(
      (value) => value.inAppNotifications !== undefined || value.emailNotifications !== undefined,
      { message: "At least one preference is required." },
    ),
})

const postBodySchema = z.discriminatedUnion("action", [
  markReadSchema,
  markAllReadSchema,
  preferencesSchema,
])

/**
 * Resolves the alert owner for a request. The access token carries `uid`;
 * the backend lookup confirms the account still exists so a stale token
 * cannot read or mutate alerts for a deleted user.
 */
async function alertOwner(request: Request) {
  const access = accessTokenFromRequest(request)
  if (!access) return null
  const user = await getAuthBackend().getUserById(access.uid)
  return user ? { userId: user.id } : null
}

function payload(userId: string) {
  const store = getLoginAlertStore()
  return {
    alerts: store.listAlerts(userId),
    unreadCount: store.unreadCount(userId),
    preferences: store.getPreferences(userId),
  }
}

/**
 * GET /api/auth/login-alerts — the caller's suspicious-login alerts
 * (newest first), unread count, and alert preferences.
 */
export async function GET(request: Request) {
  const owner = await alertOwner(request)
  if (!owner) return fail(401, "unauthenticated", "Sign in required.")
  return ok(payload(owner.userId))
}

/**
 * POST /api/auth/login-alerts — alert mutations. Body is one of:
 *  - `{ action: "mark_read", ids: string[] }` — mark specific alerts read.
 *  - `{ action: "mark_all_read" }` — mark the whole feed read.
 *  - `{ action: "update_preferences", preferences: {...} }` — merge new
 *    delivery preferences (both fields optional, booleans only).
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  const owner = await alertOwner(request)
  if (!owner) return fail(401, "unauthenticated", "Sign in required.")

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Invalid request body.")
  }
  const parsed = postBodySchema.safeParse(body)
  if (!parsed.success) {
    return fail(400, "invalid_request", "Unsupported alert action.")
  }

  const store = getLoginAlertStore()
  const data = parsed.data

  if (data.action === "mark_read") {
    store.markAlertsRead(owner.userId, data.ids)
  } else if (data.action === "mark_all_read") {
    store.markAllAlertsRead(owner.userId)
  } else {
    store.setPreferences(owner.userId, data.preferences)
  }

  // Echo the mutated state back so the client can reconcile without a refetch.
  return ok(payload(owner.userId))
}
