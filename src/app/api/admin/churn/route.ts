import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/admin-guard"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, ok } from "@/lib/auth/http"
import { CHURN_RISKS, churnRiskAtLeast, scoreAllUsers, type ChurnRisk } from "@/lib/churn"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/admin/churn?minRisk=low|medium|high&limit=N — ranked churn-risk
 * scores for every discoverable user, highest score first. Admin-only via
 * `requireAdmin` (401 unauthenticated / 403 non-admin), same seam as
 * `/api/admin/users`.
 *
 * SCORING: heuristic, not ML — see src/lib/churn.ts for the weighted
 * signals and known gaps (NPS is anonymous and cannot be attributed;
 * session/onboarding/feedback stores are in-memory dev seams). `minRisk`
 * keeps scores at that band or higher (default `low` = everything);
 * `limit` defaults to 200, clamped to [1, 500]. The response includes
 * `method: "heuristic"` and `computedAt` so clients can label the data
 * honestly.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const DEFAULT_LIMIT = 200
const MAX_LIMIT = 500

function parseMinRisk(value: string | null): ChurnRisk | null {
  if (value === null) return "low"
  return (CHURN_RISKS as readonly string[]).includes(value) ? (value as ChurnRisk) : null
}

function parseLimit(value: string | null): number | null {
  if (value === null) return DEFAULT_LIMIT
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) return null
  return parsed
}

export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const params = new URL(request.url).searchParams
  const minRisk = parseMinRisk(params.get("minRisk"))
  if (minRisk === null) {
    return fail(400, "invalid_request", "minRisk must be 'low', 'medium', or 'high'.")
  }
  const limit = parseLimit(params.get("limit"))
  if (limit === null) {
    return fail(400, "invalid_request", `limit must be an integer between 1 and ${MAX_LIMIT}.`)
  }

  let all
  try {
    all = await scoreAllUsers()
  } catch {
    return fail(500, "internal", "Could not compute churn scores.")
  }

  const matching = all.filter((score) => churnRiskAtLeast(score.risk, minRisk))
  const scores = matching.slice(0, limit)

  return ok({
    method: "heuristic",
    computedAt: scores[0]?.computedAt ?? new Date().toISOString(),
    minRisk,
    limit,
    total: matching.length,
    returned: scores.length,
    scores,
  })
}
