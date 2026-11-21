/**
 * Funnel analysis — ordered step conversion over product-analytics events.
 *
 * Pure, data-source agnostic: every function takes an array of events (the
 * shape produced by `src/lib/analytics.ts` — `StoredAnalyticsEvent` is a
 * compatible superset) plus a `FunnelDefinition`, and returns conversion,
 * drop-off, and time-in-step metrics. No I/O, no imports, so the same module
 * backs unit tests, the in-memory store, and `scripts/analytics/funnel/report.mjs`
 * (which imports this file directly — Node ≥22.18 strips the types natively,
 * which is why this file must stay import-free and use only erasable TS).
 *
 * Semantics: a "reached" actor is one whose events contain an ordered
 * subsequence matching every step in order. For each step we take the first
 * matching event at/after the previous step's matched timestamp (repeats are
 * fine — earlier out-of-order noise is ignored). When the definition sets
 * `windowMs`, all steps must complete within that span of the first step.
 *
 * Actors are identified by `actorId` ?? `anonymousId` ?? `props.anonymousId`;
 * events with no identifier are skipped (`skippedEvents` counts them).
 */

/* ------------------------------------------------------------------------ */
/* Types                                                                     */
/* ------------------------------------------------------------------------ */

/** Event shape accepted by the funnel engine (subset of StoredAnalyticsEvent). */
export interface FunnelEvent {
  name: string
  type?: string
  path?: string | null
  feature?: string | null
  endpoint?: string | null
  props?: Record<string, unknown>
  /** Epoch milliseconds. */
  timestamp: number
  /** Session principal (`user:<uid>` / `mock:<email>`) or any stable id. */
  actorId?: string | null
  /** Per-tab anonymous id sent by the client tracker. */
  anonymousId?: string | null
}

/**
 * One way an event can satisfy a funnel step. Every field that is present
 * must match (AND); omit a field to leave it unconstrained.
 */
export interface StepMatcher {
  /** Exact event names, e.g. `["signup_submitted"]`. */
  names?: string[]
  /** Exact event `type` (`page_view`, `feature_use`, `api_call`). */
  type?: string
  /** Exact `path` / `props.path` value. */
  path?: string
  /** `path` prefix match (e.g. `/projects/`). */
  pathPrefix?: string
  /** Exact API endpoint, e.g. `/api/auth/signup`. */
  endpoint?: string
  /** Exact `feature` prop value. */
  feature?: string
  /** Subset equality on `props` (string/number/boolean/null only). */
  props?: Record<string, unknown>
}

export interface FunnelStep {
  id: string
  label: string
  /** A step matches when ANY of these matchers matches the event. */
  anyOf: StepMatcher[]
}

export interface FunnelDefinition {
  id: string
  name: string
  description?: string
  steps: FunnelStep[]
  /**
   * Max milliseconds allowed between the first matched step and the last.
   * Actors who cannot complete the funnel inside the window drop at the step
   * they were on when it expired. Omit for no time bound.
   */
  windowMs?: number
}

export interface FunnelStepResult {
  stepId: string
  label: string
  /** Actors whose ordered journey completed this step. */
  reached: number
  /** Actors with at least one event matching this step (order ignored). */
  entered: number
  /** reached[i] - reached[i-1]; null for the first step. */
  dropOff: number | null
  /** reached[i] / reached[i-1]; null when previous reached is 0 or i=0. */
  conversionFromPrevious: number | null
  /** reached[i] / reached[0]; null when step 0 reached is 0 or i=0 (=1 handled below). */
  conversionFromTop: number | null
  /** Mean ms between reaching this step and the next, over actors who did both. */
  avgTimeToNextMs: number | null
  /** Median ms between reaching this step and the next. */
  medianTimeToNextMs: number | null
  /** Actors who reached this step but not the next. */
  droppedHere: number | null
}

export interface FunnelReport {
  funnelId: string
  funnelName: string
  generatedAt: number
  /** Distinct actors with at least one event matching any step. */
  totalActors: number
  /** Events skipped because they carried no actor identifier. */
  skippedEvents: number
  windowMs: number | null
  steps: FunnelStepResult[]
  /** reached[last] / reached[0]; null when either is 0. */
  overallConversion: number | null
}

/* ------------------------------------------------------------------------ */
/* Matching                                                                  */
/* ------------------------------------------------------------------------ */

function eventPath(event: FunnelEvent): string | null {
  if (typeof event.path === "string" && event.path.length > 0) return event.path
  const p = event.props?.path
  return typeof p === "string" && p.length > 0 ? p : null
}

function eventEndpoint(event: FunnelEvent): string | null {
  if (typeof event.endpoint === "string" && event.endpoint.length > 0) return event.endpoint
  const e = event.props?.endpoint
  return typeof e === "string" && e.length > 0 ? e : null
}

function eventFeature(event: FunnelEvent): string | null {
  if (typeof event.feature === "string" && event.feature.length > 0) return event.feature
  const f = event.props?.feature
  return typeof f === "string" && f.length > 0 ? f : null
}

function scalarEqual(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return a === b
  return a === b
}

/** Returns true when `matcher` fully matches `event`. */
export function matchesStep(event: FunnelEvent, matcher: StepMatcher): boolean {
  if (matcher.names && !matcher.names.includes(event.name)) return false
  if (matcher.type && event.type !== matcher.type) return false

  if (matcher.path !== undefined) {
    if (eventPath(event) !== matcher.path) return false
  }
  if (matcher.pathPrefix !== undefined) {
    const p = eventPath(event)
    if (p === null || !p.startsWith(matcher.pathPrefix)) return false
  }
  if (matcher.endpoint !== undefined) {
    if (eventEndpoint(event) !== matcher.endpoint) return false
  }
  if (matcher.feature !== undefined) {
    if (eventFeature(event) !== matcher.feature) return false
  }
  if (matcher.props) {
    const props = event.props ?? {}
    for (const [key, expected] of Object.entries(matcher.props)) {
      if (!scalarEqual(props[key], expected)) return false
    }
  }
  return true
}

/** True when the event satisfies at least one of the step's matchers. */
export function matchesFunnelStep(event: FunnelEvent, step: FunnelStep): boolean {
  return step.anyOf.some((matcher) => matchesStep(event, matcher))
}

/* ------------------------------------------------------------------------ */
/* Actor grouping                                                            */
/* ------------------------------------------------------------------------ */

export function actorKeyFor(event: FunnelEvent): string | null {
  if (typeof event.actorId === "string" && event.actorId.length > 0) return event.actorId
  if (typeof event.anonymousId === "string" && event.anonymousId.length > 0) {
    return `anon:${event.anonymousId}`
  }
  const p = event.props?.anonymousId
  if (typeof p === "string" && p.length > 0) return `anon:${p}`
  return null
}

interface ActorJourney {
  /** For each step index: timestamp of the matched event, or -1. */
  stepTimes: number[]
  /** For each step index: count of matching events seen. */
  stepEntries: number[]
}

/* ------------------------------------------------------------------------ */
/* Core analysis                                                             */
/* ------------------------------------------------------------------------ */

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

/**
 * Computes the funnel report for one definition over a flat event array.
 *
 * `now` is injectable for tests; it only stamps `generatedAt`.
 */
export function analyzeFunnel(
  events: readonly FunnelEvent[],
  funnel: FunnelDefinition,
  options: { now?: number } = {},
): FunnelReport {
  const now = options.now ?? Date.now()
  const steps = funnel.steps

  // Group identified events by actor, sorted by timestamp (stable for ties).
  const byActor = new Map<string, FunnelEvent[]>()
  let skippedEvents = 0

  for (const event of events) {
    if (typeof event.timestamp !== "number" || !Number.isFinite(event.timestamp)) continue
    const key = actorKeyFor(event)
    if (key === null) {
      skippedEvents += 1
      continue
    }
    const list = byActor.get(key)
    if (list) list.push(event)
    else byActor.set(key, [event])
  }

  // Per-actor ordered matching. `stepTimes[i]` is the timestamp of the event
  // that completed step i, or -1.
  const journeys: ActorJourney[] = []
  const enteredCounts = steps.map(() => 0)
  let totalActors = 0

  for (const actorEvents of byActor.values()) {
    actorEvents.sort((a, b) => a.timestamp - b.timestamp)

    const stepTimes = steps.map(() => -1)
    const stepEntries = steps.map(() => 0)
    let anyMatch = false

    for (const event of actorEvents) {
      for (let i = 0; i < steps.length; i += 1) {
        if (matchesFunnelStep(event, steps[i])) {
          stepEntries[i] += 1
          anyMatch = true
        }
      }
    }
    if (!anyMatch) continue

    totalActors += 1
    for (let i = 0; i < steps.length; i += 1) {
      enteredCounts[i] += stepEntries[i] > 0 ? 1 : 0
    }

    // Ordered subsequence scan: each step must match at/after the previous
    // step's matched timestamp. With windowMs, matches must also fall inside
    // [t0, t0 + windowMs].
    let cursor = -Infinity
    let windowEnd = Infinity
    for (let i = 0; i < steps.length; i += 1) {
      let matched = -1
      for (const event of actorEvents) {
        if (event.timestamp < cursor) continue
        if (event.timestamp > windowEnd) break
        if (matchesFunnelStep(event, steps[i])) {
          matched = event.timestamp
          break
        }
      }
      if (matched === -1) break
      stepTimes[i] = matched
      if (i === 0 && funnel.windowMs !== undefined) {
        windowEnd = matched + funnel.windowMs
      }
      cursor = matched
    }

    journeys.push({ stepTimes, stepEntries })
  }

  // Reached counts + time-to-next samples.
  const reachedCounts = steps.map((_, i) => journeys.filter((j) => j.stepTimes[i] !== -1).length)
  const timeToNext: number[][] = steps.map(() => [])
  for (const journey of journeys) {
    for (let i = 0; i < steps.length - 1; i += 1) {
      const t0 = journey.stepTimes[i]
      const t1 = journey.stepTimes[i + 1]
      if (t0 !== -1 && t1 !== -1 && t1 >= t0) {
        timeToNext[i].push(t1 - t0)
      }
    }
  }

  const topReached = reachedCounts[0] ?? 0
  const stepResults: FunnelStepResult[] = steps.map((step, i) => {
    const reached = reachedCounts[i]
    const prevReached = i > 0 ? reachedCounts[i - 1] : null
    const nextReached = i < steps.length - 1 ? reachedCounts[i + 1] : null
    const times = timeToNext[i]
    return {
      stepId: step.id,
      label: step.label,
      reached,
      entered: enteredCounts[i],
      dropOff: prevReached === null ? null : prevReached - reached,
      conversionFromPrevious:
        prevReached === null || prevReached === 0 ? null : reached / prevReached,
      conversionFromTop: topReached === 0 ? null : reached / topReached,
      avgTimeToNextMs: mean(times),
      medianTimeToNextMs: median(times),
      droppedHere: nextReached === null ? null : Math.max(0, reached - nextReached),
    }
  })

  const lastReached = reachedCounts[reachedCounts.length - 1] ?? 0
  return {
    funnelId: funnel.id,
    funnelName: funnel.name,
    generatedAt: now,
    totalActors,
    skippedEvents,
    windowMs: funnel.windowMs ?? null,
    steps: stepResults,
    overallConversion: topReached === 0 ? null : lastReached / topReached,
  }
}

/** Runs every funnel in `funnels` (defaults to the built-in catalog). */
export function analyzeFunnels(
  events: readonly FunnelEvent[],
  funnels: readonly FunnelDefinition[] = FUNNELS,
  options: { now?: number } = {},
): FunnelReport[] {
  return funnels.map((funnel) => analyzeFunnel(events, funnel, options))
}

/* ------------------------------------------------------------------------ */
/* Funnel catalog                                                            */
/* ------------------------------------------------------------------------ */
//
// Inferred from the app routes under src/app: (auth) sign-in/sign-up/
// magic-link/verify-email, api/auth/* endpoints, (app) dashboard + app/*
// screens, and the team invite flow (src/components/app/team-members-screen).
// Matchers accept BOTH the analytics event names a developer might emit via
// trackEvent()/trackFeatureUse() AND the api_call/page_view shapes the
// ingest route already records, so funnels work with whatever is instrumented.

export const FUNNELS: FunnelDefinition[] = [
  {
    id: "signup_activation",
    name: "Signup → activation",
    description:
      "Visitor lands on /sign-up, submits credentials, verifies email, and reaches the app dashboard.",
    windowMs: 7 * 24 * 60 * 60 * 1000,
    steps: [
      {
        id: "signup_view",
        label: "Viewed sign-up page",
        anyOf: [
          { type: "page_view", path: "/sign-up" },
          { names: ["signup_viewed", "signup_started"] },
        ],
      },
      {
        id: "signup_submit",
        label: "Submitted sign-up",
        anyOf: [
          { type: "api_call", endpoint: "/api/auth/signup" },
          { names: ["signup_submitted", "signup_completed"] },
        ],
      },
      {
        id: "email_verify",
        label: "Verified email",
        anyOf: [
          { type: "api_call", endpoint: "/api/auth/verify-email" },
          { type: "page_view", path: "/verify-email" },
          { names: ["email_verified", "email_verification_completed"] },
        ],
      },
      {
        id: "first_project",
        label: "Created first project",
        anyOf: [
          { type: "feature_use", feature: "project_created" },
          { names: ["project_created", "first_project_created"] },
        ],
      },
      {
        id: "activated",
        label: "Reached app dashboard",
        anyOf: [
          { type: "page_view", path: "/dashboard" },
          { type: "page_view", pathPrefix: "/app" },
          { names: ["activated", "onboarding_completed"] },
        ],
      },
    ],
  },
  {
    id: "passwordless_signin",
    name: "Passwordless sign-in",
    description: "Sign-in page → magic-link request → link verify → authenticated app.",
    windowMs: 60 * 60 * 1000,
    steps: [
      {
        id: "signin_view",
        label: "Viewed sign-in page",
        anyOf: [{ type: "page_view", path: "/sign-in" }, { names: ["signin_viewed"] }],
      },
      {
        id: "magic_link_request",
        label: "Requested magic link",
        anyOf: [
          { type: "api_call", endpoint: "/api/auth/passwordless/request" },
          { names: ["magic_link_requested", "passwordless_requested"] },
        ],
      },
      {
        id: "magic_link_verify",
        label: "Verified magic link",
        anyOf: [
          { type: "api_call", endpoint: "/api/auth/passwordless/verify" },
          { type: "page_view", path: "/magic-link" },
          { names: ["magic_link_verified", "passwordless_verified"] },
        ],
      },
      {
        id: "signed_in",
        label: "Reached app",
        anyOf: [
          { type: "page_view", pathPrefix: "/app" },
          { type: "page_view", path: "/dashboard" },
          { names: ["signed_in", "login_completed"] },
        ],
      },
    ],
  },
  {
    id: "invite_join",
    name: "Invite → join",
    description: "Workspace member sends an invite, invitee accepts, and lands in the team screen.",
    windowMs: 14 * 24 * 60 * 60 * 1000,
    steps: [
      {
        id: "invite_sent",
        label: "Invite sent",
        anyOf: [
          { type: "feature_use", feature: "team_invite_sent" },
          { names: ["invite_sent", "team_invite_sent"] },
        ],
      },
      {
        id: "invite_opened",
        label: "Invite link opened",
        anyOf: [
          // Speculative matcher: no /invite route exists yet; kept for forward compatibility.
          { type: "page_view", pathPrefix: "/invite" },
          { type: "feature_use", feature: "invite_opened" },
          { names: ["invite_opened", "invite_link_opened"] },
        ],
      },
      {
        id: "invite_accepted",
        label: "Invite accepted",
        anyOf: [
          { type: "feature_use", feature: "invite_accepted" },
          { names: ["invite_accepted", "invite_joined"] },
        ],
      },
      {
        id: "member_active",
        label: "Member reached team screen",
        anyOf: [
          { type: "page_view", path: "/dashboard/members" },
          { type: "feature_use", feature: "team_members_viewed" },
          { names: ["member_joined", "team_member_active"] },
        ],
      },
    ],
  },
  {
    id: "project_creation",
    name: "Project creation",
    description: "User opens the projects list, creates a project, and views the project home.",
    windowMs: 24 * 60 * 60 * 1000,
    steps: [
      {
        id: "projects_view",
        label: "Viewed projects",
        anyOf: [
          { type: "page_view", path: "/projects" },
          { names: ["projects_viewed", "projects_view"] },
        ],
      },
      {
        id: "project_created",
        label: "Created project",
        anyOf: [
          { type: "feature_use", feature: "project_created" },
          { names: ["project_created", "project_create_submitted"] },
        ],
      },
      {
        id: "project_view",
        label: "Opened project",
        anyOf: [
          { type: "page_view", pathPrefix: "/projects/" },
          { names: ["project_opened", "project_viewed"] },
        ],
      },
    ],
  },
  {
    id: "feedback_submission",
    name: "Feedback submission",
    description: "User opens the feedback surface and the feedback POST succeeds.",
    windowMs: 24 * 60 * 60 * 1000,
    steps: [
      {
        id: "feedback_open",
        label: "Opened feedback",
        anyOf: [
          { type: "page_view", path: "/app/feedback" },
          { type: "feature_use", feature: "feedback_opened" },
          { names: ["feedback_opened"] },
        ],
      },
      {
        id: "feedback_submit",
        label: "Submitted feedback",
        anyOf: [
          { type: "api_call", endpoint: "/api/feedback" },
          { type: "feature_use", feature: "feedback_submitted" },
          { names: ["feedback_submitted"] },
        ],
      },
    ],
  },
]

export function getFunnel(id: string): FunnelDefinition | undefined {
  return FUNNELS.find((funnel) => funnel.id === id)
}

/* ------------------------------------------------------------------------ */
/* Deterministic demo data                                                   */
/* ------------------------------------------------------------------------ */

/** mulberry32 — small seeded PRNG so demo events are stable across runs. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Per-step survival probabilities for the demo population, keyed by funnel
 * id. Chosen so reports show realistic drop-off at every step.
 */
const DEMO_SURVIVAL: Record<string, number[]> = {
  signup_activation: [1, 0.82, 0.66, 0.5, 0.42],
  passwordless_signin: [1, 0.78, 0.6, 0.52],
  invite_join: [1, 0.7, 0.55, 0.48],
  project_creation: [1, 0.85, 0.74],
  feedback_submission: [1, 0.6],
}

const DEMO_ACTORS_PER_FUNNEL = 60
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const MIN_MS_FLOOR = 60 * 1000

function eventFor(
  funnel: FunnelDefinition,
  stepIndex: number,
  actorId: string,
  timestamp: number,
): FunnelEvent {
  const step = funnel.steps[stepIndex]
  // Demo events use explicit names so they match every catalog funnel via
  // the `names` alternatives; type/props stay absent on purpose.
  const nameByStep: Record<string, string[]> = {
    signup_activation: [
      "signup_viewed",
      "signup_submitted",
      "email_verified",
      "project_created",
      "activated",
    ],
    passwordless_signin: [
      "signin_viewed",
      "magic_link_requested",
      "magic_link_verified",
      "signed_in",
    ],
    invite_join: ["invite_sent", "invite_opened", "invite_accepted", "member_joined"],
    project_creation: ["projects_viewed", "project_created", "project_opened"],
    feedback_submission: ["feedback_opened", "feedback_submitted"],
  }
  const names = nameByStep[funnel.id] ?? []
  return {
    name: names[stepIndex] ?? step.id,
    type: "feature_use",
    props: { feature: step.id, funnel: funnel.id, step: step.id },
    timestamp,
    actorId,
  }
}

/**
 * Generates a deterministic synthetic event stream covering every catalog
 * funnel: `DEMO_ACTORS_PER_FUNNEL` actors per funnel, each advancing through
 * steps with the survival probabilities in DEMO_SURVIVAL and realistic
 * inter-step delays. Used by --demo mode of scripts/analytics/funnel/report.mjs
 * and by tests.
 */
export function generateDemoFunnelEvents(now: Date = new Date()): FunnelEvent[] {
  const rand = mulberry32(0xf0f1)
  const events: FunnelEvent[] = []
  const base = now.getTime()

  for (const funnel of FUNNELS) {
    const survival = DEMO_SURVIVAL[funnel.id] ?? funnel.steps.map(() => 0.5)
    for (let i = 0; i < DEMO_ACTORS_PER_FUNNEL; i += 1) {
      const actorId = `demo:${funnel.id}:${String(i + 1).padStart(3, "0")}`
      // Spread actor start times over the last ~3 days.
      let t = base - Math.floor(rand() * 3 * DAY_MS)
      const journeyStart = t
      const deadline =
        funnel.windowMs === undefined ? Infinity : journeyStart + funnel.windowMs * 0.9
      let alive = true
      for (let s = 0; s < funnel.steps.length; s += 1) {
        if (!alive) break
        if (s > 0 && rand() > (survival[s] ?? 0.5) / (survival[s - 1] ?? 1)) {
          break
        }
        // Step delay: minutes for early funnel, up to a day for later ones —
        // capped so journeys can still fit inside the funnel's windowMs.
        const baseCap = s < 3 ? 2 * HOUR_MS : DAY_MS
        const cap =
          funnel.windowMs === undefined
            ? baseCap
            : Math.min(baseCap, Math.max(MIN_MS_FLOOR, Math.floor(funnel.windowMs / 6)))
        const delay = s === 0 ? 0 : Math.floor(rand() * cap)
        t += delay
        if (t > base || t > deadline) break
        events.push(eventFor(funnel, s, actorId, t))
      }
    }
  }

  // A few unattributed events to exercise the skippedEvents path.
  for (let i = 0; i < 5; i += 1) {
    events.push({
      name: "signup_viewed",
      type: "page_view",
      path: "/sign-up",
      timestamp: base - Math.floor(rand() * DAY_MS),
    })
  }

  return events.sort((a, b) => a.timestamp - b.timestamp)
}
