/**
 * Business metrics — definitions and pure computation.
 *
 * This module is the single source of truth for the top-level business
 * metrics of the Spindle research workspace (see
 * docs/analytics/business-metrics.md). It is deliberately dependency-free
 * and data-source agnostic: callers feed it normalized signup and product
 * analytics records, and `computeBusinessMetrics` returns a report.
 *
 * Data sources it expects (all already exist in the product):
 *
 * - Signups: the `users` table (`prisma/schema.prisma`, `User.createdAt`) or
 *   an equivalent JSONL export. There is no billing table — see the
 *   `conversions` metric for the revenue proxy.
 * - Activity: consent-gated product analytics events stored by
 *   `src/lib/analytics.ts` behind `/api/analytics` (`type`, `name`, `feature`,
 *   `userId`, `anonymousId`, `timestamp`). The store is in-memory and
 *   per-process, so offline reports consume a JSONL export of the same shape.
 *
 * Honesty notes (mirroring src/lib/cohorts.ts):
 *
 * - `activation` and `retention_week1` are *proxies* — they measure product
 *   analytics activity, not verified outcomes.
 * - There is no payment processor wired yet (see src/lib/pricing.ts — Hobby
 *   is donation-funded and Enterprise is a custom agreement). `conversions`
 *   therefore counts checkout-style analytics events by name and reports
 *   `billingWired: false`.
 */

/* ------------------------------------------------------------------------ */
/* Catalog                                                                   */
/* ------------------------------------------------------------------------ */

export type BusinessMetricUnit = "count" | "ratio" | "per_user"

export interface BusinessMetricDefinition {
  id: string
  name: string
  /** One-sentence definition shown in the doc and reports. */
  definition: string
  /** Where the underlying data comes from. */
  source: string
  /** Target / healthy range, or "n/a" when no target exists yet. */
  target: string
  unit: BusinessMetricUnit
  /** False for metrics that need a data source the product does not have. */
  available: boolean
}

export const BUSINESS_METRIC_CATALOG: readonly BusinessMetricDefinition[] = [
  {
    id: "signups",
    name: "Signups",
    definition: "New accounts created in the window, with a daily series for trend lines.",
    source: "users.created_at (Prisma) or signups JSONL export",
    target: "Growth-plan dependent — no fixed target yet",
    unit: "count",
    available: true,
  },
  {
    id: "active_users",
    name: "Active users (DAU / WAU)",
    definition:
      "Distinct subjects (signed-in userId, else anonymousId) with at least one analytics event in the trailing 1 or 7 days.",
    source: "/api/analytics event store (page_view, feature_use, api_call)",
    target: "WAU/MAU-style stickiness > 20% is a common SaaS bar; no target set",
    unit: "count",
    available: true,
  },
  {
    id: "activation",
    name: "Activation rate",
    definition:
      "Share of users who signed up at least `activationWindowDays` ago and recorded a non-page_view event (feature_use or api_call) within that many days of signup.",
    source: "users.created_at joined to /api/analytics events by userId",
    target: "n/a — baseline first, then set per onboarding work",
    unit: "ratio",
    available: true,
  },
  {
    id: "retention_week1",
    name: "Week-1 retention (proxy)",
    definition:
      "Share of users whose signup is at least 14 days old that recorded any analytics event between day 7 and day 14 after signup.",
    source: "users.created_at joined to /api/analytics events by userId",
    target: "n/a — proxy until a real activity datastore exists",
    unit: "ratio",
    available: true,
  },
  {
    id: "engagement",
    name: "Engagement per active user",
    definition:
      "Total analytics events in the window divided by distinct active subjects; also split page_view vs feature_use vs api_call.",
    source: "/api/analytics event store",
    target: "n/a",
    unit: "per_user",
    available: true,
  },
  {
    id: "feature_adoption",
    name: "Top features",
    definition:
      "Feature names ranked by unique subjects using them in the window (from the `feature` prop on feature_use events).",
    source: "/api/analytics event store (props.feature)",
    target: "n/a — used to prioritise onboarding and docs",
    unit: "count",
    available: true,
  },
  {
    id: "conversions",
    name: "Paid conversions (proxy)",
    definition:
      "Count of analytics events whose name matches a checkout-style event (checkout_completed, subscription_started, plan_upgraded, purchase), divided by signups in the window. There is no billing system yet — this is a proxy that becomes real when payments land.",
    source: "/api/analytics event store (event name match)",
    target: "n/a — no billing wired",
    unit: "ratio",
    available: false,
  },
]

/** Analytics event names treated as paid-conversion proxies. */
export const CONVERSION_EVENT_NAMES: readonly string[] = [
  "checkout_completed",
  "subscription_started",
  "plan_upgraded",
  "purchase",
]

/* ------------------------------------------------------------------------ */
/* Input types                                                               */
/* ------------------------------------------------------------------------ */

export interface BusinessUserInput {
  /** Stable user id (matches the userId suffix in analytics events). */
  id: string
  /** Signup time — epoch ms or ISO-8601 string. */
  signedUpAt: number | string
}

export interface BusinessEventInput {
  /** "page_view" | "feature_use" | "api_call" (or any string; unknown → feature_use). */
  type?: string
  /** Event name (e.g. "page_view", feature name, endpoint). */
  name?: string
  /** Feature label lifted from props.feature by trackFeatureUse. */
  feature?: string | null
  /** Session principal: "user:<uid>" / "mock:<email>" / null. */
  userId?: string | null
  /** Per-tab anonymous id from trackEvent payloads. */
  anonymousId?: string | null
  /** Event time — epoch ms or ISO-8601 string. Defaults to `receivedAt`. */
  timestamp?: number | string | null
  receivedAt?: number | string | null
}

export interface BusinessMetricsOptions {
  /** Trailing window in days. Default 30, clamped 1–365. */
  windowDays?: number
  /** Days after signup allowed for an activation event. Default 7. */
  activationWindowDays?: number
  /** Reference time. Default Date.now(). */
  now?: number
  /** Max rows in topFeatures. Default 10. */
  topFeatures?: number
}

/* ------------------------------------------------------------------------ */
/* Report shape                                                             */
/* ------------------------------------------------------------------------ */

export interface DailyCount {
  /** UTC calendar day, YYYY-MM-DD. */
  date: string
  count: number
}

export interface SubjectTypeCounts {
  pageViews: number
  featureUses: number
  apiCalls: number
  total: number
}

export interface FeatureAdoptionEntry {
  feature: string
  events: number
  /** Distinct subjects that used the feature. */
  subjects: number
}

export interface BusinessMetricsReport {
  generatedAt: number
  windowDays: number
  windowStart: string
  signups: {
    total: number
    daily: DailyCount[]
  }
  activeUsers: {
    dau: number
    wau: number
    /** Distinct subjects with ≥1 event in the whole window. */
    mau: number
    daily: DailyCount[]
    byType: SubjectTypeCounts
  }
  activation: {
    /** Users old enough for the activation window to be fully observed. */
    eligible: number
    activated: number
    /** activated / eligible; null when eligible === 0. */
    rate: number | null
    windowDays: number
  }
  retentionWeek1: {
    /** Users whose signup is ≥14 days old (full week-1 observable). */
    cohort: number
    retained: number
    /** retained / cohort; null when cohort === 0. */
    rate: number | null
  }
  engagement: {
    eventsPerActiveUser: number | null
    events: number
    activeSubjects: number
  }
  topFeatures: FeatureAdoptionEntry[]
  conversions: {
    /** False until a billing/checkout source exists — count is a name-match proxy. */
    billingWired: false
    count: number
    /** count / signups in window; null when no signups. */
    rate: number | null
    matchedNames: string[]
  }
}

/* ------------------------------------------------------------------------ */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------ */

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_WINDOW_DAYS = 30
const MAX_WINDOW_DAYS = 365
const DEFAULT_ACTIVATION_WINDOW_DAYS = 7
const RETENTION_OBSERVATION_DAYS = 14
const WEEK_MS = 7 * DAY_MS

function toTime(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function dayKey(time: number): string {
  return new Date(time).toISOString().slice(0, 10)
}

function clampWindow(days: number | undefined): number {
  if (typeof days !== "number" || !Number.isFinite(days)) return DEFAULT_WINDOW_DAYS
  return Math.min(MAX_WINDOW_DAYS, Math.max(1, Math.floor(days)))
}

/**
 * Stable subject key for an event. Signed-in principals (`user:<uid>`,
 * `mock:<email>`) win; anonymous hits fall back to their per-tab
 * anonymousId. Returns null for unattributable events — they still count
 * toward totals but never toward unique-user metrics.
 */
export function businessEventSubject(event: BusinessEventInput): string | null {
  if (typeof event.userId === "string" && event.userId.length > 0) return event.userId
  if (typeof event.anonymousId === "string" && event.anonymousId.length > 0) {
    return `anon:${event.anonymousId}`
  }
  return null
}

function eventType(event: BusinessEventInput): "page_view" | "feature_use" | "api_call" {
  if (event.type === "page_view" || event.type === "api_call") return event.type
  return "feature_use"
}

function eventTime(event: BusinessEventInput, now: number): number {
  return toTime(event.timestamp) ?? toTime(event.receivedAt) ?? now
}

/* ------------------------------------------------------------------------ */
/* Computation                                                               */
/* ------------------------------------------------------------------------ */

/**
 * Computes the business metric report. Pure: no I/O, no clock reads beyond
 * the injectable `now`. Malformed inputs (missing/invalid timestamps, empty
 * ids) are skipped rather than throwing — reports must survive dirty exports.
 */
export function computeBusinessMetrics(
  users: readonly BusinessUserInput[],
  events: readonly BusinessEventInput[],
  options: BusinessMetricsOptions = {},
): BusinessMetricsReport {
  const now = options.now ?? Date.now()
  const windowDays = clampWindow(options.windowDays)
  const activationWindowDays = Math.max(
    1,
    Math.floor(options.activationWindowDays ?? DEFAULT_ACTIVATION_WINDOW_DAYS),
  )
  const topN = Math.max(1, Math.floor(options.topFeatures ?? 10))

  const windowStart = new Date(now).setUTCHours(0, 0, 0, 0) - (windowDays - 1) * DAY_MS

  /* --- normalize users -------------------------------------------------- */

  interface NormUser {
    id: string
    signedUpAt: number
  }
  const normUsers: NormUser[] = []
  for (const user of users) {
    const id = typeof user.id === "string" ? user.id.trim() : ""
    const signedUpAt = toTime(user.signedUpAt)
    if (!id || signedUpAt === null) continue
    normUsers.push({ id, signedUpAt })
  }

  /* --- normalize events ------------------------------------------------- */

  interface NormEvent {
    time: number
    type: "page_view" | "feature_use" | "api_call"
    name: string
    feature: string | null
    subject: string | null
  }
  const normEvents: NormEvent[] = []
  for (const event of events) {
    const time = eventTime(event, now)
    if (time < windowStart || time > now + 60_000) continue // outside window / absurd future
    const type = eventType(event)
    const name =
      typeof event.name === "string" && event.name.length > 0
        ? event.name
        : type === "feature_use"
          ? (event.feature ?? "feature_use")
          : type
    const feature =
      typeof event.feature === "string" && event.feature.length > 0 ? event.feature : null
    normEvents.push({ time, type, name, feature, subject: businessEventSubject(event) })
  }

  /* --- signups ----------------------------------------------------------- */

  const signupDaily = new Map<string, number>()
  const usersById = new Map<string, NormUser[]>()
  let signupTotal = 0
  for (const user of normUsers) {
    if (user.signedUpAt < windowStart || user.signedUpAt > now) continue
    signupTotal += 1
    const key = dayKey(user.signedUpAt)
    signupDaily.set(key, (signupDaily.get(key) ?? 0) + 1)
    const list = usersById.get(user.id)
    if (list) list.push(user)
    else usersById.set(user.id, [user])
  }
  const dailySeries = (counts: Map<string, number>): DailyCount[] => {
    const out: DailyCount[] = []
    for (let i = 0; i < windowDays; i += 1) {
      const date = new Date(windowStart + i * DAY_MS).toISOString().slice(0, 10)
      out.push({ date, count: counts.get(date) ?? 0 })
    }
    return out
  }

  /* --- active users ------------------------------------------------------ */

  const dauSubjects = new Set<string>()
  const wauSubjects = new Set<string>()
  const allSubjects = new Set<string>()
  const activeDaily = new Map<string, Set<string>>()
  const byType: SubjectTypeCounts = { pageViews: 0, featureUses: 0, apiCalls: 0, total: 0 }

  for (const event of normEvents) {
    byType.total += 1
    if (event.type === "page_view") byType.pageViews += 1
    else if (event.type === "api_call") byType.apiCalls += 1
    else byType.featureUses += 1

    if (!event.subject) continue
    allSubjects.add(event.subject)
    const key = dayKey(event.time)
    let daySet = activeDaily.get(key)
    if (!daySet) {
      daySet = new Set()
      activeDaily.set(key, daySet)
    }
    daySet.add(event.subject)
    if (event.time >= now - DAY_MS) dauSubjects.add(event.subject)
    if (event.time >= now - WEEK_MS) wauSubjects.add(event.subject)
  }

  const activeDailyCounts = new Map<string, number>()
  for (const [date, subjects] of activeDaily) activeDailyCounts.set(date, subjects.size)

  /* --- per-user event index for activation / retention ------------------- */

  // userId "user:<id>" / "mock:<email>" — the signup id matches the part after
  // the first colon when present; otherwise the whole principal is the id.
  const userKey = (principal: string): string => {
    const idx = principal.indexOf(":")
    return idx >= 0 ? principal.slice(idx + 1) : principal
  }
  const eventsByUser = new Map<string, NormEvent[]>()
  for (const event of normEvents) {
    if (!event.subject || event.subject.startsWith("anon:")) continue
    const uid = userKey(event.subject)
    const list = eventsByUser.get(uid)
    if (list) list.push(event)
    else eventsByUser.set(uid, [event])
  }

  /* --- activation --------------------------------------------------------- */

  const activationCutoff = now - activationWindowDays * DAY_MS
  let activationEligible = 0
  let activationActivated = 0
  for (const user of normUsers) {
    // Cohort: signed up inside the report window and old enough that the
    // full activation window has been observed.
    if (user.signedUpAt < windowStart || user.signedUpAt > activationCutoff) continue
    activationEligible += 1
    const userEvents = eventsByUser.get(user.id) ?? []
    const deadline = user.signedUpAt + activationWindowDays * DAY_MS
    const activated = userEvents.some(
      (event) => event.type !== "page_view" && event.time <= deadline,
    )
    if (activated) activationActivated += 1
  }

  /* --- week-1 retention proxy --------------------------------------------- */

  const retentionCutoff = now - RETENTION_OBSERVATION_DAYS * DAY_MS
  // Fully-observable cohort: the whole days 7–14 window must fall inside the
  // report window, i.e. signup ∈ [windowStart − 7d, now − 14d]. Users outside
  // it are excluded rather than counted as churned on missing data.
  const retentionEarliest = windowStart - 7 * DAY_MS
  let retentionCohort = 0
  let retentionRetained = 0
  for (const user of normUsers) {
    if (user.signedUpAt < retentionEarliest || user.signedUpAt > retentionCutoff) continue
    retentionCohort += 1
    const week1Start = user.signedUpAt + 7 * DAY_MS
    const week1End = user.signedUpAt + RETENTION_OBSERVATION_DAYS * DAY_MS
    const retained = (eventsByUser.get(user.id) ?? []).some(
      (event) => event.time >= week1Start && event.time < week1End,
    )
    if (retained) retentionRetained += 1
  }

  /* --- engagement ----------------------------------------------------------- */

  const engagementEvents = byType.total
  const engagementSubjects = allSubjects.size

  /* --- top features --------------------------------------------------------- */

  const featureStats = new Map<string, { events: number; subjects: Set<string> }>()
  for (const event of normEvents) {
    if (event.type !== "feature_use") continue
    const feature = event.feature ?? event.name
    if (!feature) continue
    let stats = featureStats.get(feature)
    if (!stats) {
      stats = { events: 0, subjects: new Set() }
      featureStats.set(feature, stats)
    }
    stats.events += 1
    if (event.subject) stats.subjects.add(event.subject)
  }
  const topFeatures = [...featureStats.entries()]
    .map(([feature, stats]) => ({
      feature,
      events: stats.events,
      subjects: stats.subjects.size,
    }))
    .sort(
      (a, b) =>
        b.subjects - a.subjects || b.events - a.events || a.feature.localeCompare(b.feature),
    )
    .slice(0, topN)

  /* --- conversions (proxy) ---------------------------------------------------- */

  const conversionNames = new Set<string>(CONVERSION_EVENT_NAMES)
  const matchedNames = new Set<string>()
  let conversionCount = 0
  for (const event of normEvents) {
    if (conversionNames.has(event.name)) {
      conversionCount += 1
      matchedNames.add(event.name)
    }
  }

  /* --- assemble --------------------------------------------------------------- */

  return {
    generatedAt: now,
    windowDays,
    windowStart: new Date(windowStart).toISOString(),
    signups: { total: signupTotal, daily: dailySeries(signupDaily) },
    activeUsers: {
      dau: dauSubjects.size,
      wau: wauSubjects.size,
      mau: allSubjects.size,
      daily: dailySeries(activeDailyCounts),
      byType,
    },
    activation: {
      eligible: activationEligible,
      activated: activationActivated,
      rate: activationEligible > 0 ? activationActivated / activationEligible : null,
      windowDays: activationWindowDays,
    },
    retentionWeek1: {
      cohort: retentionCohort,
      retained: retentionRetained,
      rate: retentionCohort > 0 ? retentionRetained / retentionCohort : null,
    },
    engagement: {
      eventsPerActiveUser: engagementSubjects > 0 ? engagementEvents / engagementSubjects : null,
      events: engagementEvents,
      activeSubjects: engagementSubjects,
    },
    topFeatures,
    conversions: {
      billingWired: false,
      count: conversionCount,
      rate: signupTotal > 0 ? conversionCount / signupTotal : null,
      matchedNames: [...matchedNames].sort(),
    },
  }
}
