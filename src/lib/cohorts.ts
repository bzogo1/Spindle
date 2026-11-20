/**
 * User cohort analysis — signup-week cohorts × weekly activity retention.
 *
 * DATA SOURCE HONESTY: the product has no user/activity datastore yet.
 * `MemoryAuthBackend` (`src/lib/auth/backend.ts`) stores a handful of
 * dev/test users and exposes no listing or activity feed, so there is no
 * real cohort data to compute over. Everything here is therefore derived
 * from `generateDemoCohortUsers` — a deterministic, clearly-labelled
 * synthetic population — the same "demo data until the backend lands"
 * pattern as `dashboard-mock.ts` / `lab-mock.ts`.
 *
 * The pure functions (`weekStartUtc`, `buildCohortReport`) are data-source
 * agnostic: when a real user/activity source exists, feed its records in
 * as `CohortUserInput[]` and the math stays unchanged.
 */

/** Number of weekly retention columns (W0 = signup week … W{n-1}). */
export const COHORT_WEEKS = 8
/** Most recent signup-week cohorts shown in the report. */
export const MAX_COHORTS = 12
/** How far back demo users can have signed up (weeks). */
const DEMO_SIGNUP_SPAN_WEEKS = 14
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export interface CohortUserInput {
  id: string
  /** ISO timestamp of account creation. */
  signedUpAt: string
  /**
   * Activity event counts per week offset from the user's signup week:
   * index 0 is the signup week, index 1 the following week, and so on.
   * Arrays shorter than COHORT_WEEKS mean "no further activity recorded".
   */
  weeklyActivity: number[]
}

export interface CohortCell {
  /** Week offset from the cohort's signup week (0-based). */
  week: number
  /** ISO date (Monday) of that week for this cohort. */
  weekStart: string
  /** Users in the cohort with activity > 0 during that week. */
  activeUsers: number
  /** activeUsers / cohort size; null while the week is still in progress. */
  retention: number | null
  /** False while the week is still in progress (retention keeps moving). */
  complete: boolean
}

export interface CohortRow {
  /** ISO date (Monday) of the signup week. */
  weekStart: string
  /** Display label, e.g. "Nov 10". */
  label: string
  /** Users who signed up during this week. */
  size: number
  /** Users with no activity in their cohort's latest complete week. */
  inactiveLatestWeek: number
  /**
   * Mean number of weeks (within COHORT_WEEKS) each user was active, counting
   * only weeks that have fully elapsed — the same weeks whose retention
   * cells report a final percentage. Activity in the in-progress week is
   * excluded so this metric never mixes provisional and final data.
   */
  avgActiveWeeks: number
  cells: CohortCell[]
}

export interface CohortReport {
  generatedAt: string
  /** Always "demo" until a real user/activity source is wired in. */
  dataSource: "demo"
  note: string
  weeks: number
  cohorts: CohortRow[]
  totals: {
    /**
     * Users with a parseable signup date — i.e. everyone who could be placed
     * into a signup-week cohort. May exceed the sum of displayed cohort
     * sizes when `maxCohorts` caps the report.
     */
    users: number
    /** Users skipped because `signedUpAt` could not be parsed. */
    excludedUsers: number
    /** Users active in the most recent complete week across all cohorts. */
    activeThisWeek: number
  }
}

// ---------------------------------------------------------------------------
// Week math (UTC, weeks start Monday — matches ISO-8601 week dating)
// ---------------------------------------------------------------------------

/** Monday 00:00:00 UTC of the week containing `date`. */
export function weekStartUtc(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  // getUTCDay: 0=Sun..6=Sat → shift so Monday is day 0.
  const offset = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - offset)
  return d
}

function formatWeekLabel(weekStart: Date): string {
  return weekStart.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
}

// ---------------------------------------------------------------------------
// Report computation
// ---------------------------------------------------------------------------

/**
 * Groups users into signup-week cohorts and computes per-week retention.
 *
 * A user counts as "active" in week offset `w` when
 * `weeklyActivity[w] > 0`. Cells whose week has not fully elapsed are marked
 * `complete: false` with `retention: null` so the UI can show them as
 * provisional rather than final.
 */
export function buildCohortReport(
  users: CohortUserInput[],
  options: { now?: Date; weeks?: number; maxCohorts?: number } = {},
): CohortReport {
  const now = options.now ?? new Date()
  const weeks = options.weeks ?? COHORT_WEEKS
  const maxCohorts = options.maxCohorts ?? MAX_COHORTS

  type Bucket = { user: CohortUserInput }
  const buckets = new Map<number, Bucket[]>()
  let excludedUsers = 0

  for (const user of users) {
    const signedUp = new Date(user.signedUpAt)
    if (Number.isNaN(signedUp.getTime())) {
      excludedUsers += 1
      continue
    }
    const start = weekStartUtc(signedUp).getTime()
    const list = buckets.get(start) ?? []
    list.push({ user })
    buckets.set(start, list)
  }

  // Most recent cohorts first, capped.
  const cohortStarts = [...buckets.keys()].sort((a, b) => b - a).slice(0, maxCohorts)

  const cohorts: CohortRow[] = cohortStarts.map((start) => {
    const members = buckets.get(start) ?? []
    const size = members.length
    const cells: CohortCell[] = []

    for (let w = 0; w < weeks; w++) {
      const weekStart = new Date(start + w * WEEK_MS)
      const isComplete = weekStart.getTime() + WEEK_MS <= now.getTime()
      let activeUsers = 0
      for (const { user } of members) {
        if ((user.weeklyActivity[w] ?? 0) > 0) activeUsers += 1
      }
      cells.push({
        week: w,
        weekStart: weekStart.toISOString(),
        activeUsers,
        retention: isComplete && size > 0 ? activeUsers / size : null,
        complete: isComplete,
      })
    }

    // Latest complete week for this cohort = last cell with complete === true.
    const latestComplete = [...cells].reverse().find((c) => c.complete)
    // avgActiveWeeks only counts weeks that have fully elapsed, matching the
    // retention cells that report a final percentage.
    const completeWeeks = cells.filter((c) => c.complete)
    let inactiveLatestWeek = 0
    let totalActiveWeeks = 0
    for (const { user } of members) {
      let active = 0
      for (const cell of completeWeeks) {
        if ((user.weeklyActivity[cell.week] ?? 0) > 0) active += 1
      }
      totalActiveWeeks += active
      if (latestComplete && (user.weeklyActivity[latestComplete.week] ?? 0) === 0) {
        inactiveLatestWeek += 1
      }
    }

    return {
      weekStart: new Date(start).toISOString(),
      label: formatWeekLabel(new Date(start)),
      size,
      inactiveLatestWeek,
      avgActiveWeeks: size > 0 ? totalActiveWeeks / size : 0,
      cells,
    }
  })

  // Users active in the most recent complete week across all cohorts.
  const currentWeekStart = weekStartUtc(now).getTime()
  let activeThisWeek = 0
  for (const user of users) {
    const signedUp = new Date(user.signedUpAt)
    if (Number.isNaN(signedUp.getTime())) continue
    const offset = Math.round((currentWeekStart - weekStartUtc(signedUp).getTime()) / WEEK_MS)
    if (offset >= 0 && offset < weeks && (user.weeklyActivity[offset] ?? 0) > 0) {
      activeThisWeek += 1
    }
  }

  return {
    generatedAt: now.toISOString(),
    dataSource: "demo",
    note: "Synthetic demo data — no user or activity store is wired up yet.",
    weeks,
    cohorts,
    totals: {
      users: users.length - excludedUsers,
      excludedUsers,
      activeThisWeek,
    },
  }
}

/**
 * Builds the demo cohort report served by GET /api/cohorts.
 * `now` is injectable for tests.
 */
export function getDemoCohortReport(now: Date = new Date()): CohortReport {
  return buildCohortReport(generateDemoCohortUsers(now), { now })
}

// ---------------------------------------------------------------------------
// Deterministic demo population
// ---------------------------------------------------------------------------

/** mulberry32 — small seeded PRNG so demo data is stable across requests. */
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
 * Generates a plausible synthetic user population for the cohort report.
 * Signups are spread over the last DEMO_SIGNUP_SPAN_WEEKS weeks; each user's
 * weekly activity follows a per-user retention curve plus noise, which
 * produces realistic-looking (but invented) retention grids.
 */
export function generateDemoCohortUsers(now: Date, count = 48): CohortUserInput[] {
  const rand = mulberry32(0xc0ffee)
  const users: CohortUserInput[] = []
  const nowWeekStart = weekStartUtc(now).getTime()

  for (let i = 0; i < count; i++) {
    // Signup somewhere in the last DEMO_SIGNUP_SPAN_WEEKS weeks, biased
    // toward more recent weeks so the newest cohorts are the largest.
    const weeksAgo = Math.floor(rand() * rand() * DEMO_SIGNUP_SPAN_WEEKS)
    const signupWeekStart = nowWeekStart - weeksAgo * WEEK_MS
    // Random day inside the signup week (never in the future).
    const maxOffsetDays = Math.min(6, Math.floor((now.getTime() - signupWeekStart) / 86_400_000))
    const dayOffset = Math.floor(rand() * (maxOffsetDays + 1))
    let signedUpAt = new Date(
      signupWeekStart + dayOffset * 86_400_000 + Math.floor(rand() * 86_400_000),
    )
    if (signedUpAt.getTime() > now.getTime()) signedUpAt = new Date(now.getTime())

    // Per-user retention: weekly survival probability decays from ~0.9.
    const initialRetention = 0.82 + rand() * 0.16
    const decay = 0.82 + rand() * 0.14
    const weeklyActivity: number[] = []
    let alive = true
    for (let w = 0; w < COHORT_WEEKS; w++) {
      const weekStart = signupWeekStart + w * WEEK_MS
      // Don't fabricate activity for weeks that haven't started yet. The
      // current (in-progress) week is included so "active this week" works;
      // buildCohortReport marks its cell incomplete.
      if (weekStart > now.getTime()) break
      if (alive && rand() < initialRetention * Math.pow(decay, w)) {
        // 1–6 events in an active week.
        weeklyActivity.push(1 + Math.floor(rand() * 6))
      } else {
        alive = false
        weeklyActivity.push(0)
      }
    }

    users.push({
      id: `demo-user-${String(i + 1).padStart(3, "0")}`,
      signedUpAt: signedUpAt.toISOString(),
      weeklyActivity,
    })
  }

  return users
}
