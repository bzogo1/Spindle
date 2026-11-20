/**
 * User retention analytics — pure functions over user activity events.
 *
 * Sibling to `src/lib/cohorts.ts` (weekly signup-cohort retention). Where
 * cohorts.ts consumes pre-bucketed `weeklyActivity` counts, this module
 * works directly on raw activity events (`{ userId, timestamp }`), so it can
 * be fed from JSONL exports, DB dumps, or the `/api/analytics` ingest store.
 *
 * DATA SOURCE HONESTY: there is no production user/activity datastore yet —
 * the same caveat documented in cohorts.ts applies. The `--demo` path of
 * `scripts/analytics/retention/report.mjs` uses `generateDemoActivityEvents`,
 * a deterministic synthetic population; feed real event arrays into
 * `buildRetentionReport` when a source exists and the math is unchanged.
 *
 * All functions are pure (no I/O, no `Date.now()` unless passed `now`).
 */

export const DAY_MS = 24 * 60 * 60 * 1000
export const WEEK_MS = 7 * DAY_MS
/** Rolling windows for the activity metrics; MAU is approximated as 30 days. */
export const WINDOW_DAYS = { dau: 1, wau: 7, mau: 30 } as const

/** Raw activity event, epoch milliseconds. */
export interface ActivityEventInput {
  userId: string
  /** Epoch milliseconds. */
  timestamp: number
}

/** Per-user activity summary derived from raw events. */
export interface UserActivity {
  userId: string
  /** Earliest event timestamp — the retention anchor ("signup" proxy). */
  firstSeenAt: number
  lastSeenAt: number
  eventCount: number
  /** Unique UTC day indexes (days since epoch) with ≥1 event, ascending. */
  activeDayIndexes: number[]
}

export interface ActivityWindowMetrics {
  /** Distinct users active within the trailing `days`-day window. */
  dau: number
  wau: number
  mau: number
  /** dau / wau — "stickiness"; 1.0 means every weekly user was daily. */
  dauWauRatio: number | null
}

export interface ChurnMetrics {
  /** Trailing window length in days. */
  windowDays: number
  /** Users active during the window *before* the churn window. */
  cohortSize: number
  /** Cohort users with zero activity inside the churn window. */
  churned: number
  /** Cohort users still active inside the churn window. */
  retained: number
  /** churned / cohortSize; null when the cohort is empty. */
  churnRate: number | null
}

export interface NDayRetentionCell {
  /** Days after the user's anchor day (0 = anchor day itself). */
  dayOffset: number
  /** Users with ≥1 event exactly on anchor day + dayOffset. */
  activeUsers: number
  /** activeUsers / cohort size; null while that day hasn't fully elapsed. */
  retention: number | null
}

export interface NDayRetentionCohort {
  /** ISO date (UTC) of the anchor day. */
  anchorDay: string
  /** Distinct users whose first activity fell on this day. */
  cohortSize: number
  cells: NDayRetentionCell[]
}

export interface SurvivalPoint {
  /** Days since each user's anchor day. */
  day: number
  /**
   * Users whose anchor day is at least `day` days old — the only ones for
   * which day-`day` survival is observable.
   */
  eligible: number
  /**
   * Eligible users with activity on or after anchor day + `day` — i.e. their
   * last active day is at least `day` days after first activity.
   */
  retained: number
  /** retained / eligible; null when no user is old enough to observe. */
  survival: number | null
}

export interface RetentionReport {
  generatedAt: string
  /** "demo" for the synthetic generator, "events" for real input. */
  dataSource: "demo" | "events"
  users: number
  events: number
  windows: ActivityWindowMetrics
  churn: ChurnMetrics
  /** Most recent anchor-day cohorts, newest first. */
  nDayRetention: NDayRetentionCohort[]
  /** Day-by-day survival curve pooled across all cohorts. */
  survival: SurvivalPoint[]
  /**
   * Users skipped because their `userId` was missing/empty or the timestamp
   * was not a finite number.
   */
  excludedEvents: number
}

// ---------------------------------------------------------------------------
// Indexing
// ---------------------------------------------------------------------------

/** UTC day index (days since epoch) for an epoch-ms timestamp. */
export function dayIndexOf(timestamp: number): number {
  return Math.floor(timestamp / DAY_MS)
}

/** ISO date (YYYY-MM-DD, UTC) for a day index. */
export function isoDateOfDayIndex(dayIndex: number): string {
  return new Date(dayIndex * DAY_MS).toISOString().slice(0, 10)
}

function isValidEvent(event: ActivityEventInput): boolean {
  return (
    typeof event.userId === "string" &&
    event.userId.length > 0 &&
    typeof event.timestamp === "number" &&
    Number.isFinite(event.timestamp)
  )
}

/**
 * Groups raw events into per-user activity summaries.
 * Invalid events (missing userId, non-finite timestamp) are dropped and
 * counted in `excludedEvents` on the returned report-level helper.
 */
export function buildUserActivity(events: ActivityEventInput[]): {
  users: UserActivity[]
  excludedEvents: number
} {
  const byUser = new Map<
    string,
    { first: number; last: number; count: number; days: Set<number> }
  >()
  let excludedEvents = 0

  for (const event of events) {
    if (!isValidEvent(event)) {
      excludedEvents += 1
      continue
    }
    let entry = byUser.get(event.userId)
    if (!entry) {
      entry = { first: event.timestamp, last: event.timestamp, count: 0, days: new Set() }
      byUser.set(event.userId, entry)
    }
    entry.count += 1
    entry.days.add(dayIndexOf(event.timestamp))
    if (event.timestamp < entry.first) entry.first = event.timestamp
    if (event.timestamp > entry.last) entry.last = event.timestamp
  }

  const users: UserActivity[] = [...byUser.entries()].map(([userId, e]) => ({
    userId,
    firstSeenAt: e.first,
    lastSeenAt: e.last,
    eventCount: e.count,
    activeDayIndexes: [...e.days].sort((a, b) => a - b),
  }))
  users.sort((a, b) => a.firstSeenAt - b.firstSeenAt || a.userId.localeCompare(b.userId))
  return { users, excludedEvents }
}

/**
 * Set of userIds with ≥1 event inside the trailing `days`-day window ending
 * at the end of `now`'s UTC day.
 */
export function usersActiveInWindow(users: UserActivity[], now: Date, days: number): Set<string> {
  const endDay = dayIndexOf(now.getTime()) // inclusive
  const startDay = endDay - (days - 1)
  const active = new Set<string>()
  for (const user of users) {
    // activeDayIndexes is sorted; any day in [startDay, endDay] counts.
    for (const day of user.activeDayIndexes) {
      if (day > endDay) break
      if (day >= startDay) {
        active.add(user.userId)
        break
      }
    }
  }
  return active
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/** DAU / WAU / MAU style rolling activity windows. */
export function computeActivityWindows(users: UserActivity[], now: Date): ActivityWindowMetrics {
  const dau = usersActiveInWindow(users, now, WINDOW_DAYS.dau).size
  const wau = usersActiveInWindow(users, now, WINDOW_DAYS.wau).size
  const mau = usersActiveInWindow(users, now, WINDOW_DAYS.mau).size
  return {
    dau,
    wau,
    mau,
    dauWauRatio: wau > 0 ? dau / wau : null,
  }
}

/**
 * Churn over a trailing window: of the users active during the *previous*
 * equal-length window, what fraction went silent inside the latest window.
 *
 * Example with windowDays=7 and now=Friday: the cohort is users active in
 * days [-14, -8) relative to today and churned means no activity in days
 * [-7, 0]. The gap-free windows are [start, now - window) and
 * [now - window, now].
 */
export function computeChurn(
  users: UserActivity[],
  now: Date,
  windowDays: number = WINDOW_DAYS.wau,
): ChurnMetrics {
  const endDay = dayIndexOf(now.getTime())
  const churnStartDay = endDay - windowDays + 1 // inclusive start of churn window
  const cohortStartDay = churnStartDay - windowDays // start of previous window
  const cohortEndDay = churnStartDay - 1 // inclusive end of previous window

  const inRange = (user: UserActivity, lo: number, hi: number): boolean =>
    user.activeDayIndexes.some((d) => d >= lo && d <= hi)

  let cohortSize = 0
  let churned = 0
  for (const user of users) {
    if (!inRange(user, cohortStartDay, cohortEndDay)) continue
    cohortSize += 1
    if (!inRange(user, churnStartDay, endDay)) churned += 1
  }

  return {
    windowDays,
    cohortSize,
    churned,
    retained: cohortSize - churned,
    churnRate: cohortSize > 0 ? churned / cohortSize : null,
  }
}

/**
 * N-day retention by anchor day (each user's first-activity UTC day).
 * A user counts as retained on `dayOffset` when they have ≥1 event exactly
 * on anchor day + dayOffset. Cells whose target day has not fully elapsed
 * report `retention: null`.
 */
export function computeNDayRetention(
  users: UserActivity[],
  options: { now?: Date; dayOffsets?: number[]; maxCohorts?: number } = {},
): NDayRetentionCohort[] {
  const now = options.now ?? new Date()
  const dayOffsets = options.dayOffsets ?? [1, 7, 30]
  const maxCohorts = options.maxCohorts ?? 14
  const today = dayIndexOf(now.getTime())

  // anchorDay -> members
  const cohorts = new Map<number, UserActivity[]>()
  for (const user of users) {
    const anchor = dayIndexOf(user.firstSeenAt)
    const list = cohorts.get(anchor) ?? []
    list.push(user)
    cohorts.set(anchor, list)
  }

  const anchorDays = [...cohorts.keys()].sort((a, b) => b - a).slice(0, maxCohorts)

  return anchorDays.map((anchor) => {
    const members = cohorts.get(anchor) ?? []
    const activeSets = members.map((u) => new Set(u.activeDayIndexes))
    const cells: NDayRetentionCell[] = dayOffsets.map((offset) => {
      const targetDay = anchor + offset
      const complete = targetDay <= today
      let activeUsers = 0
      if (complete) {
        for (const days of activeSets) {
          if (days.has(targetDay)) activeUsers += 1
        }
      }
      return {
        dayOffset: offset,
        activeUsers: complete ? activeUsers : 0,
        retention: complete && members.length > 0 ? activeUsers / members.length : null,
      }
    })
    return {
      anchorDay: isoDateOfDayIndex(anchor),
      cohortSize: members.length,
      cells,
    }
  })
}

/**
 * Pooled survival curve: for each tenure `day`, the fraction of users old
 * enough to observe that day whose last activity is still ≥ `day` days after
 * their first activity. Day 0 is 100% by construction.
 */
export function computeSurvivalCurve(
  users: UserActivity[],
  options: { now?: Date; maxDays?: number } = {},
): SurvivalPoint[] {
  const now = options.now ?? new Date()
  const maxDays = options.maxDays ?? 30
  const today = dayIndexOf(now.getTime())

  const points: SurvivalPoint[] = []
  for (let d = 0; d <= maxDays; d++) {
    let eligible = 0
    let retained = 0
    for (const user of users) {
      const anchor = dayIndexOf(user.firstSeenAt)
      // Only users whose anchor is at least d days old can be observed at d.
      if (anchor + d > today) continue
      eligible += 1
      const lastDay = dayIndexOf(user.lastSeenAt)
      if (lastDay >= anchor + d) retained += 1
    }
    points.push({
      day: d,
      eligible,
      retained,
      survival: eligible > 0 ? retained / eligible : null,
    })
  }
  return points
}

/**
 * Full retention report over a raw event stream.
 */
export function buildRetentionReport(
  events: ActivityEventInput[],
  options: {
    now?: Date
    dataSource?: "demo" | "events"
    dayOffsets?: number[]
    maxCohorts?: number
    churnWindowDays?: number
    survivalMaxDays?: number
  } = {},
): RetentionReport {
  const now = options.now ?? new Date()
  const { users, excludedEvents } = buildUserActivity(events)

  return {
    generatedAt: now.toISOString(),
    dataSource: options.dataSource ?? "events",
    users: users.length,
    events: events.length - excludedEvents,
    windows: computeActivityWindows(users, now),
    churn: computeChurn(users, now, options.churnWindowDays ?? WINDOW_DAYS.wau),
    nDayRetention: computeNDayRetention(users, {
      now,
      dayOffsets: options.dayOffsets,
      maxCohorts: options.maxCohorts,
    }),
    survival: computeSurvivalCurve(users, { now, maxDays: options.survivalMaxDays }),
    excludedEvents,
  }
}

// ---------------------------------------------------------------------------
// Deterministic demo population (same pattern as generateDemoCohortUsers)
// ---------------------------------------------------------------------------

/** mulberry32 — small seeded PRNG so demo data is stable across runs. */
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
 * Generates a plausible synthetic event stream for `--demo` runs.
 * Each "user" is a first-seen timestamp plus a per-user daily activity
 * probability that decays over time, producing realistic churn and
 * survival shapes. Output is deterministic for a given `now`.
 */
export function generateDemoActivityEvents(
  now: Date,
  userCount = 160,
  spanDays = 60,
): ActivityEventInput[] {
  const rand = mulberry32(0x2e7a91)
  const events: ActivityEventInput[] = []
  const today = dayIndexOf(now.getTime())
  const startDay = today - spanDays

  for (let i = 0; i < userCount; i++) {
    const userId = `demo-user-${String(i + 1).padStart(3, "0")}`
    // Anchor day spread over the span, biased toward recent days.
    const offset = Math.floor(rand() * rand() * (spanDays + 1))
    const anchorDay = today - offset
    if (anchorDay < startDay) continue
    const anchorTs = Math.min(anchorDay * DAY_MS + Math.floor(rand() * DAY_MS), now.getTime())
    events.push({ userId, timestamp: anchorTs })

    // Per-user daily activity probability: high on day 0, decaying a few
    // %/day with noise. Days are independent so users can return after gaps.
    const initialP = 0.65 + rand() * 0.3
    const decay = 0.94 + rand() * 0.04
    const maxDay = Math.min(today - anchorDay, 45)
    for (let d = 0; d <= maxDay; d++) {
      const dayTs = anchorDay * DAY_MS + d * DAY_MS
      if (dayTs > now.getTime()) break
      if (rand() < initialP * Math.pow(decay, d)) {
        // 1–4 events spread through the day.
        const eventCount = 1 + Math.floor(rand() * 4)
        for (let e = 0; e < eventCount; e++) {
          const ts = Math.min(dayTs + Math.floor(rand() * DAY_MS), now.getTime())
          events.push({ userId, timestamp: ts })
        }
      }
    }
  }

  return events
}
