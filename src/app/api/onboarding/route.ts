import { accessTokenFromRequest, fail, isSameOriginRequest, ok, readCookie } from "@/lib/auth/http"
import { decodeMockSession, MOCK_SESSION_COOKIE, mockAuthEnabled } from "@/lib/auth/mock-session"
import {
  clampStepIndex,
  completeOnboarding,
  getOnboardingRecord,
  isOnboardingStepId,
  ONBOARDING_STEP_IDS,
  onboardingProgressSnapshot,
  parseOnboardingAnswers,
  saveOnboardingProgress,
  type OnboardingRecord,
} from "@/lib/onboarding"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET/PUT/POST /api/onboarding — per-user onboarding wizard progress.
 *
 * Session resolution mirrors `GET/PUT /api/profile`: the `spindle_at` access
 * cookie is verified with expiry enforced, falling back to the
 * `spindle_mock_session` cookie only when mock auth is enabled. Records live
 * in the process-local store in `src/lib/onboarding.ts`, keyed by the session
 * principal — the same stopgap `src/lib/profile.ts` uses until a real
 * backend endpoint exists.
 *
 *  - GET    → `{ onboarding, steps, progress }` (`onboarding` is null when the
 *    user has no record yet; `progress` mirrors it with the derived percent,
 *    completed steps, and resume index, or is null alongside it)
 *  - PUT    → body `{ stepIndex, answers?, completedStep? }` saves in-progress
 *    state and appends a step visit to the record's history. When the
 *    `answers` key is present it REPLACES the stored answers wholesale, so
 *    cleared fields (emptied display name, unset role) are deleted; omitting
 *    `answers` keeps the previously stored answers. `completedStep` (a step
 *    id) marks the step the user advanced past — idempotent, drives the
 *    progress percentage and resume target.
 *  - POST   → body `{ skipped? }` marks the flow finished or skipped
 */

type OnboardingIdentity = {
  principal: string
}

async function resolveOnboardingIdentity(request: Request): Promise<OnboardingIdentity | null> {
  const access = accessTokenFromRequest(request)
  if (access) {
    return { principal: `user:${access.uid}` }
  }

  if (mockAuthEnabled) {
    const session = decodeMockSession(readCookie(request, MOCK_SESSION_COOKIE))
    if (session) {
      return { principal: `mock:${session.user.email.trim().toLowerCase()}` }
    }
  }

  return null
}

function onboardingPayload(record: OnboardingRecord | null) {
  return {
    onboarding: record,
    steps: ONBOARDING_STEP_IDS,
    progress: onboardingProgressSnapshot(record),
  }
}

export async function GET(request: Request) {
  const identity = await resolveOnboardingIdentity(request)
  if (!identity) {
    return fail(401, "unauthenticated", "Sign in to continue onboarding.")
  }
  return ok(onboardingPayload(getOnboardingRecord(identity.principal)))
}

export async function PUT(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }

  const identity = await resolveOnboardingIdentity(request)
  if (!identity) {
    return fail(401, "unauthenticated", "Sign in to save onboarding progress.")
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Request body must be JSON.")
  }

  const payload = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {}
  const { stepIndex, answers, completedStep } = payload
  // `answers` present (even as {}) means full replacement — cleared fields
  // are dropped by parseOnboardingAnswers and stay deleted.
  const hasAnswers = Object.prototype.hasOwnProperty.call(payload, "answers")
  const hasCompletedStep = Object.prototype.hasOwnProperty.call(payload, "completedStep")

  if (typeof stepIndex !== "number" || !Number.isInteger(stepIndex)) {
    return fail(422, "invalid_step", "stepIndex must be an integer.")
  }
  if (stepIndex < 0 || stepIndex >= ONBOARDING_STEP_IDS.length) {
    return fail(
      422,
      "invalid_step",
      `stepIndex must be between 0 and ${ONBOARDING_STEP_IDS.length - 1}.`,
    )
  }
  if (hasCompletedStep && !isOnboardingStepId(completedStep)) {
    return fail(422, "invalid_step", "completedStep must be a valid onboarding step id.")
  }

  const record = saveOnboardingProgress(identity.principal, {
    stepIndex: clampStepIndex(stepIndex),
    ...(hasAnswers ? { answers: parseOnboardingAnswers(answers), replaceAnswers: true } : {}),
    ...(hasCompletedStep && isOnboardingStepId(completedStep) ? { completedStep } : {}),
  })
  return ok(onboardingPayload(record))
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }

  const identity = await resolveOnboardingIdentity(request)
  if (!identity) {
    return fail(401, "unauthenticated", "Sign in to finish onboarding.")
  }

  let body: unknown = {}
  const text = await request.text()
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      return fail(400, "invalid_request", "Request body must be JSON.")
    }
  }

  const skipped =
    typeof body === "object" && body !== null
      ? (body as { skipped?: unknown }).skipped === true
      : false

  const record = completeOnboarding(identity.principal, { skipped })
  return ok(onboardingPayload(record))
}
