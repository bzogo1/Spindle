import { z } from "zod"

import { getAuthBackend } from "@/lib/auth/backend"
import { accessTokenFromRequest, fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { recordPasswordChange } from "@/lib/password-rotation"
import { createRateLimiter, clientIp } from "@/lib/site-forms"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const limiter = createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 })

const recordChangeSchema = z
  .object({
    /** Plaintext password just written by a credential-change flow. */
    password: z.string().min(1).max(1024),
  })
  .strict()

/**
 * POST /api/auth/password/rotation/record — bookkeeping hook for
 * password-change flows. `password` is PLAINTEXT ONLY: it is always
 * hashed with scrypt before storage (see `recordPasswordChange` — there
 * is intentionally no hash-detection heuristic).
 *
 * ⚠️ SPOOFABLE BOOKKEEPING: this endpoint accepts arbitrary plaintext
 * from any signed-in session with no proof that a password change
 * actually occurred. Any user can stamp `passwordChangedAt` and inject
 * history hashes, so both are user-forgeable until the real credential
 * routes (`/api/auth/password/reset/confirm`, `/api/auth/recovery/password`,
 * signup, change-password) call `recordPasswordChange` themselves after
 * `backend.setPassword` succeeds. This is an accepted seam, not a
 * security boundary — worst case today is weakened reuse prevention,
 * never authentication bypass. Do not rely on this data for enforcement
 * until it is wired into the credential flows.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  if (!limiter.check(clientIp(request))) {
    return fail(429, "rate_limited", "Too many attempts. Try again later.")
  }

  const access = accessTokenFromRequest(request)
  if (!access) return fail(401, "unauthenticated", "Sign in required.")
  const user = await getAuthBackend().getUserById(access.uid)
  if (!user) return fail(401, "unauthenticated", "Sign in required.")

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Invalid request body.")
  }
  const parsed = recordChangeSchema.safeParse(body)
  if (!parsed.success) {
    return fail(400, "invalid_request", "Invalid request body.")
  }

  const record = await recordPasswordChange(user.id, parsed.data.password)
  return ok({
    passwordChangedAt: record.passwordChangedAt,
    historySize: record.historyHashes.length,
  })
}
