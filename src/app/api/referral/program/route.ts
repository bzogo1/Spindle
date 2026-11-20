import { z } from "zod"

import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import {
  getOrCreateReferralCode,
  getReferralCodeForUser,
  getReferralProgramSettings,
  getReferralStatsForUser,
  ReferralProgramError,
  setVanityReferralCode,
} from "@/lib/referral-program"
import { resolveReferralCaller } from "../caller"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * /api/referral/program
 *
 * GET  — public-safe program settings (`enabled`, `rewardLabel`,
 *        `rewardAmountCents` — no internal ids) plus, when the caller is
 *        signed in, their own referral `code` (null until one is created)
 *        and per-user `stats`. Unauthenticated callers get settings only.
 * POST — same-origin, auth required. Ensures the caller has a referral
 *        code (generates `SPN-XXXX-XXXX` on first call) and returns the
 *        same payload as GET. An optional `{ vanity }` field upgrades the
 *        code to a user-chosen `SPN-<slug>` (validated + uniqueness
 *        enforced by `setVanityReferralCode`).
 *
 * Auth resolves like `/api/profile` / `/api/affiliate` (see `../caller.ts`).
 * The store is the in-memory dev seam in `src/lib/referral-program.ts`;
 * `rewardAmountCents` is reporting metadata only — no payouts.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const createSchema = z
  .object({
    vanity: z.string().trim().min(1).max(64).optional(),
  })
  .optional()

function publicSettings() {
  const settings = getReferralProgramSettings()
  return {
    enabled: settings.enabled,
    rewardLabel: settings.rewardLabel,
    rewardAmountCents: settings.rewardAmountCents,
  }
}

async function programPayload(request: Request) {
  const caller = await resolveReferralCaller(request)
  if (!caller) {
    return ok({ settings: publicSettings(), code: null, stats: null })
  }
  const record = getReferralCodeForUser(caller.userId)
  return ok({
    settings: publicSettings(),
    code: record ? { code: record.code, vanity: record.vanity, createdAt: record.createdAt } : null,
    stats: getReferralStatsForUser(caller.userId),
  })
}

export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()
  return programPayload(request)
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const caller = await resolveReferralCaller(request)
  if (!caller) {
    return fail(401, "unauthenticated", "Sign in to get your referral code.")
  }

  let body: unknown
  const contentType = request.headers.get("content-type") ?? ""
  if (contentType.includes("application/json")) {
    try {
      body = await request.json()
    } catch {
      return fail(400, "invalid_request", "Request body must be JSON.")
    }
  }

  const parsed = createSchema.safeParse(body ?? {})
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request."
    return fail(400, "invalid_request", message)
  }

  try {
    if (parsed.data?.vanity) {
      setVanityReferralCode(caller.userId, parsed.data.vanity)
    } else {
      getOrCreateReferralCode(caller.userId)
    }
  } catch (error) {
    if (error instanceof ReferralProgramError) {
      const status = error.code === "conflict" ? 409 : error.code === "limit" ? 503 : 400
      return fail(status, error.code === "conflict" ? "conflict" : "invalid_request", error.message)
    }
    return fail(500, "internal", "Could not create your referral code.")
  }

  return programPayload(request)
}
