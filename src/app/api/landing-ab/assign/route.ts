import { z } from "zod"

import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import {
  assignVariant,
  createExperiment,
  DEFAULT_LANDING_EXPERIMENT_NAME,
  findExperimentByName,
  updateExperiment,
} from "@/lib/landing-ab"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/landing-ab/assign — resolve a landing-page A/B variant.
 *
 * Public endpoint hit by experiment-aware surfaces (currently the
 * `/r/[code]` referral landing). Body: `{ experimentId?, experiment?,
 * visitorId? }`.
 *
 *  - `experimentId` selects an experiment directly; `experiment` selects by
 *    surface name and defaults to `"referral-landing"`.
 *  - `visitorId` is an optional client-generated anonymous id; when absent
 *    the request IP hash stands in so assignment is still sticky per
 *    visitor-ish. The id is never stored raw in assignment keys (only its
 *    sha256 is kept by the store).
 *
 * AUTO-CREATE SEAM: when `experiment` names the default referral-landing
 * surface and NO experiment with that name has ever existed, a seeded
 * two-variant experiment (control vs. treatment, 50/50) is created and
 * started on the spot so the landing page always has something to test.
 * Auto-create fires at most once per surface name — after an admin
 * concludes (or pauses) the experiment, later visitors keep resolving the
 * concluded winner (or fall back to control) instead of silently starting
 * a brand-new test. This is a development-store convenience — in
 * production the experiment would be provisioned via
 * `/api/admin/landing-ab` instead. Auto-create only applies to
 * `DEFAULT_LANDING_EXPERIMENT_NAME`; other names return
 * `assignment: null` when nothing is resolvable.
 *
 * Response is intentionally minimal: `{ ok, assignment: { experimentId,
 * variantId, config } | null }`. `assignment: null` means "render control"
 * (draft/paused/outside window/unknown surface) — never an error, so the
 * landing page degrades gracefully.
 *
 * Rate limited per IP (publicRead tier) and same-origin enforced.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const assignSchema = z.object({
  experimentId: z.string().trim().min(1).max(120).optional(),
  experiment: z.string().trim().min(1).max(120).optional(),
  visitorId: z.string().trim().min(1).max(128).optional(),
})

/**
 * Seeded default for the referral landing page (see AUTO-CREATE SEAM
 * above). Only called when `findExperimentByName` confirms no experiment
 * with this surface name exists at all — first visit seeds the test, and
 * it is never re-created after an admin concludes or pauses it.
 */
function ensureDefaultExperiment() {
  const existing = findExperimentByName(DEFAULT_LANDING_EXPERIMENT_NAME)
  if (existing) return existing
  const created = createExperiment({
    name: DEFAULT_LANDING_EXPERIMENT_NAME,
    variants: [
      {
        id: "control",
        weight: 50,
        config: {
          headline: "You've been invited to Spindle.",
          ctaLabel: "Create free workspace",
          showSocialProof: true,
        },
      },
      {
        id: "treatment",
        weight: 50,
        config: {
          headline: "Your invite to Spindle is ready.",
          ctaLabel: "Claim your free workspace",
          showSocialProof: true,
        },
      },
    ],
  })
  return updateExperiment(created.id, { status: "running" })
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  if (!limiter.check(clientIp(request))) return authRateLimited()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Request body must be JSON.")
  }

  const parsed = assignSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid assignment request."
    return fail(400, "invalid_request", message)
  }

  const { experimentId, experiment: experimentName, visitorId } = parsed.data
  const selector = experimentId ?? experimentName ?? DEFAULT_LANDING_EXPERIMENT_NAME

  // Resolve/create before assigning so `assignVariant` sees a running
  // record. `findExperimentByName` matches ANY status: a completed
  // experiment resolves to its winner via `assignVariant`, and a
  // draft/paused one yields `assignment: null` (control) — auto-create only
  // runs when the surface has never had an experiment.
  let resolved = experimentId ? null : findExperimentByName(selector)
  if (!resolved && !experimentId && selector === DEFAULT_LANDING_EXPERIMENT_NAME) {
    try {
      resolved = ensureDefaultExperiment()
    } catch {
      resolved = null
    }
  }
  const effectiveVisitor = visitorId ?? `ip:${createHashFallback(clientIp(request))}`

  try {
    const assignment = assignVariant(resolved?.id ?? selector, effectiveVisitor)
    if (!assignment) {
      return ok({ assignment: null })
    }
    return ok({
      assignment: {
        experimentId: assignment.experimentId,
        variantId: assignment.variantId,
        config: assignment.variant.config,
      },
    })
  } catch {
    return ok({ assignment: null })
  }
}

function createHashFallback(value: string): string {
  // Cheap non-crypto fallback for the visitor key when the client sends no
  // id — the store hashes whatever it receives anyway.
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }
  return hash.toString(16)
}
