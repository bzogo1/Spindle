/**
 * Journey step tracking.
 *
 * Thin, typed wrapper over `trackEvent` from `src/lib/analytics.ts` — every
 * journey event is automatically consent-gated, queued while the visitor
 * hasn't decided, and POSTed to `/api/analytics` once analytics consent is
 * granted. Nothing here bypasses or duplicates that pipeline.
 *
 * Event shape (what lands in the analytics store / JSONL exports):
 *
 *   name:   "journey_step"
 *   type:   "feature_use"
 *   props:  {
 *     journey:     JourneyId            — e.g. "signup_to_first_project"
 *     step:        string               — step id from definitions.ts
 *     stepIndex:   number               — 0-based position in the journey
 *     journeySessionId?: string         — per-tab-session stitching id
 *     ...callerProps                    — aggregate, non-identifying only
 *   }
 *
 * Identity/stitching: the ingest route additionally stamps `userId`
 * (session principal) and the client attaches `anonymousId` (per-tab).
 * See session.ts for how the three keys combine.
 *
 * Privacy: props must stay aggregate and non-identifying — paths, feature
 * names, counts, booleans. Never pass emails, names, project contents, or
 * other personal data (same rule as `trackEvent`).
 */

import { trackEvent } from "@/lib/analytics"

import { JOURNEYS, journeyStepIndex, type JourneyId } from "./definitions"
import { getJourneySessionId } from "./session"

/** Event name emitted for every journey step. */
export const JOURNEY_EVENT_NAME = "journey_step" as const

const MAX_STEP_LENGTH = 128
const MAX_PROP_KEY_LENGTH = 64
/** Extra caller props are capped so a buggy call site can't bloat the store. */
const MAX_EXTRA_PROPS = 16

const knownSteps = new Map<JourneyId, Set<string>>(
  JOURNEYS.map((j) => [j.id, new Set(j.steps.map((s) => s.step))]),
)

export type JourneyStepProps = Record<string, unknown>

function isValidStep(journey: JourneyId, step: string): boolean {
  return (
    typeof step === "string" &&
    step.length > 0 &&
    step.length <= MAX_STEP_LENGTH &&
    knownSteps.get(journey)?.has(step) === true
  )
}

/**
 * Keeps caller props small and JSON-safe: drops non-string keys, oversized
 * keys, and excess entries. Values are passed through untouched —
 * `trackEvent`/the ingest route already bound payload size.
 */
function sanitizeProps(props: JourneyStepProps | undefined): JourneyStepProps {
  if (!props || typeof props !== "object") return {}
  const clean: JourneyStepProps = {}
  let count = 0
  for (const [key, value] of Object.entries(props)) {
    if (count >= MAX_EXTRA_PROPS) break
    if (typeof key !== "string" || key.length === 0 || key.length > MAX_PROP_KEY_LENGTH) continue
    // Reserved keys are owned by the tracker — callers can't override them.
    if (key === "journey" || key === "step" || key === "stepIndex" || key === "journeySessionId") {
      continue
    }
    clean[key] = value
    count += 1
  }
  return clean
}

/**
 * Records one step of a user journey.
 *
 * @param journey  Journey id from `JOURNEYS` (see definitions.ts).
 * @param step     Step id declared in that journey's `steps` list.
 * @param props    Optional aggregate, non-identifying extra properties
 *                 (e.g. `{ provider: "github" }`, `{ projectTemplate: "blank" }`).
 *
 * Unknown journeys/steps and invalid input are dropped silently — analytics
 * must never break the app. Safe to call from client components, server
 * actions, and route handlers (no-ops server-side via `trackEvent`).
 */
export function trackJourneyStep(journey: JourneyId, step: string, props?: JourneyStepProps): void {
  if (!isValidStep(journey, step)) return

  const stepIndex = journeyStepIndex(journey, step)
  const journeySessionId = getJourneySessionId()

  trackEvent(
    JOURNEY_EVENT_NAME,
    {
      journey,
      step,
      stepIndex,
      ...(journeySessionId ? { journeySessionId } : {}),
      ...sanitizeProps(props),
    },
    "feature_use",
  )
}

/**
 * Convenience alias for the first step of a journey — makes funnel entry
 * points read naturally at call sites:
 *
 *   trackJourneyStart("signup_to_first_project", "landing_view")
 */
export function trackJourneyStart(
  journey: JourneyId,
  firstStep: string,
  props?: JourneyStepProps,
): void {
  trackJourneyStep(journey, firstStep, props)
}
