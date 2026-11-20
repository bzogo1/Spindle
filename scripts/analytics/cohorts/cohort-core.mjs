/**
 * Cohort analysis core — acquisition-cohort retention matrix.
 *
 * Dependency-free ES module shared by:
 *   - scripts/analytics/cohorts/report.mjs  (CLI report generator)
 *   - src/lib/cohort-analysis/cohort-analysis.ts (typed facade + tests)
 *
 * Pipeline:
 *   raw records (JSONL / JSON export / demo)  --recordsToUsers-->  users
 *   users (signup week + per-week activity)   --computeRetentionMatrix-->  report
 *   report                                   --formatTextReport / formatMarkdownReport--> output
 *
 * Semantics intentionally mirror src/lib/cohorts.ts (read-only): users are
 * grouped by the Monday-UTC week of `signedUpAt`; a user is "active" in week
 * offset N when they recorded > 0 activity events that week; cells whose week
 * has not fully elapsed report `retention: null` / `complete: false`.
 */

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000
export const DEFAULT_WEEKS = 8
export const DEFAULT_MAX_COHORTS = 12

// ---------------------------------------------------------------------------
// Week math (UTC, weeks start Monday — ISO-8601 week dating)
// ---------------------------------------------------------------------------

/** @param {Date|number|string} input */
function toDate(input) {
  const d = input instanceof Date ? input : new Date(input)
  return d
}

/** Monday 00:00:00 UTC of the week containing `date`. @returns {Date} */
export function weekStartUtc(date) {
  const d = toDate(date)
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const offset = (day.getUTCDay() + 6) % 7 // Mon=0 … Sun=6
  day.setUTCDate(day.getUTCDate() - offset)
  return day
}

/** @param {Date|number|string} date @returns {number} ms of the containing week's Monday */
function weekStartMs(date) {
  return weekStartUtc(date).getTime()
}

function formatWeekLabel(weekStart) {
  return weekStart.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
}

// ---------------------------------------------------------------------------
// Record normalization — accept JSONL / JSON export rows of several shapes
// ---------------------------------------------------------------------------

const lower = (v) => (typeof v === "string" ? v.toLowerCase() : "")

function firstDefined(obj, keys) {
  for (const key of keys) {
    const v = obj[key]
    if (v !== undefined && v !== null && v !== "") return v
  }
  return undefined
}

const USER_ID_KEYS = ["userId", "user_id", "uid", "uid_hex", "distinct_id"]
const ID_KEYS = [...USER_ID_KEYS, "id"]
const SIGNUP_AT_KEYS = [
  "signedUpAt",
  "signup_at",
  "signed_up_at",
  "createdAt",
  "created_at",
  "registeredAt",
  "registered_at",
]
const TIMESTAMP_KEYS = [
  "at",
  "timestamp",
  "occurredAt",
  "occurred_at",
  "createdAt",
  "created_at",
  "ts",
  "time",
  "date",
]
const KIND_KEYS = ["type", "kind", "event", "event_name", "eventName", "name", "action"]
const COUNT_KEYS = ["count", "events", "n", "value", "amount"]

/**
 * Classify a raw record as "signup" | "activity" | "user" | null.
 * "user" = pre-aggregated { id, signedUpAt, weeklyActivity }.
 */
export function classifyRecord(rec) {
  if (!rec || typeof rec !== "object" || Array.isArray(rec)) return null

  const weekly =
    rec.weeklyActivity ?? rec.weekly_activity ?? rec.activityWeeks ?? rec.activity_weeks
  if (weekly !== undefined && weekly !== null) return "user"

  const kind = lower(firstDefined(rec, KIND_KEYS))
  if (kind) {
    if (/sign.?up|register|user.?created|account.?created|joined/.test(kind)) return "signup"
    if (
      /activity|event|page|view|session|login|click|track|visit|usage|metric/.test(kind) ||
      kind.length > 0
    ) {
      // Any explicit event-ish kind that isn't a signup is treated as activity.
      return "activity"
    }
  }

  if (firstDefined(rec, ["signedUpAt", "signup_at", "signed_up_at"]) !== undefined) {
    return "signup"
  }

  const userRef = firstDefined(rec, USER_ID_KEYS)
  const signupTs = firstDefined(rec, SIGNUP_AT_KEYS)
  // A user reference carrying a creation-style timestamp (created_at,
  // registered_at, …) is a users-table export row → signup. Event exports
  // normally carry occurred_at/at plus an event name (handled above).
  if (userRef !== undefined && signupTs !== undefined) return "signup"

  if (userRef !== undefined && firstDefined(rec, TIMESTAMP_KEYS) !== undefined) {
    return "activity"
  }

  // Bare user row, e.g. { id, created_at, email } from a users-table export.
  if (firstDefined(rec, ID_KEYS) !== undefined && signupTs !== undefined) {
    return "signup"
  }

  return null
}

/** weeklyActivity may be an array or an object keyed by week offset. */
function normalizeWeeklyActivity(raw, weeks) {
  const out = new Array(weeks).fill(0)
  if (Array.isArray(raw)) {
    for (let i = 0; i < Math.min(raw.length, weeks); i++) {
      const n = Number(raw[i])
      if (Number.isFinite(n) && n > 0) out[i] = n
    }
    return out
  }
  if (raw && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw)) {
      const m = /^(?:w|week)?(\d+)$/i.exec(key.trim())
      if (!m) continue
      const idx = Number(m[1])
      const n = Number(value)
      if (idx >= 0 && idx < weeks && Number.isFinite(n) && n > 0) out[idx] = n
    }
  }
  return out
}

/**
 * Turn raw records into normalized users: { id, signedUpAtMs, weeklyActivity }.
 *
 * Two passes: signups and pre-aggregated users are collected first, then
 * activity events are bucketed into week offsets relative to each user's
 * signup week. Records that cannot be placed into a cohort (activity without
 * a matching signup, unparseable timestamps, unclassifiable rows) are skipped
 * and counted.
 *
 * @param {Array<object>} records
 * @param {{ weeks?: number }} [options]
 * @returns {{ users: Array<{id:string, signedUpAtMs:number, weeklyActivity:number[]}>,
 *             excludedUsers: number, stats: object }}
 */
export function recordsToUsers(records, options = {}) {
  const weeks = options.weeks ?? DEFAULT_WEEKS
  const signups = new Map() // id -> ms (first wins)
  const preAgg = new Map() // id -> weeklyActivity[]
  /** @type {Array<{userId:string, atMs:number, count:number}>} */
  const events = []
  const stats = {
    records: records.length,
    signups: 0,
    preAggregated: 0,
    activityRecords: 0,
    unclassifiable: 0,
    orphanActivity: 0,
    invalidTimestamps: 0,
  }

  for (const rec of records) {
    const kind = classifyRecord(rec)
    if (!kind) {
      stats.unclassifiable += 1
      continue
    }
    const userId = firstDefined(rec, ID_KEYS)
    if (userId === undefined || userId === null || userId === "") {
      stats.unclassifiable += 1
      continue
    }
    const id = String(userId)

    if (kind === "signup") {
      const raw = firstDefined(rec, SIGNUP_AT_KEYS) ?? firstDefined(rec, TIMESTAMP_KEYS)
      const ms = raw !== undefined ? new Date(raw).getTime() : NaN
      if (Number.isNaN(ms)) {
        stats.invalidTimestamps += 1
        continue
      }
      if (!signups.has(id)) {
        signups.set(id, ms)
        stats.signups += 1
      }
      continue
    }

    if (kind === "user") {
      const rawSignup = firstDefined(rec, SIGNUP_AT_KEYS) ?? firstDefined(rec, TIMESTAMP_KEYS)
      const signupMs = rawSignup !== undefined ? new Date(rawSignup).getTime() : NaN
      if (Number.isNaN(signupMs)) {
        stats.invalidTimestamps += 1
        continue
      }
      if (!signups.has(id)) {
        signups.set(id, signupMs)
        stats.signups += 1
      }
      const weekly = firstDefined(rec, [
        "weeklyActivity",
        "weekly_activity",
        "activityWeeks",
        "activity_weeks",
      ])
      preAgg.set(id, normalizeWeeklyActivity(weekly, weeks))
      stats.preAggregated += 1
      continue
    }

    // activity
    const rawAt = firstDefined(rec, TIMESTAMP_KEYS)
    const atMs = rawAt !== undefined ? new Date(rawAt).getTime() : NaN
    if (Number.isNaN(atMs)) {
      stats.invalidTimestamps += 1
      continue
    }
    const count = Number(firstDefined(rec, COUNT_KEYS) ?? 1)
    events.push({ userId: id, atMs, count: Number.isFinite(count) && count > 0 ? count : 1 })
    stats.activityRecords += 1
  }

  // Bucket events into per-user weeklyActivity arrays.
  const activityByUser = new Map() // id -> number[]
  let orphanActivity = 0
  for (const ev of events) {
    const signupMs = signups.get(ev.userId)
    if (signupMs === undefined) {
      orphanActivity += 1
      continue
    }
    const signupWeek = weekStartMs(signupMs)
    const eventWeek = weekStartMs(ev.atMs)
    // Math.round guards against DST-free week math being exact anyway.
    let offset = Math.round((eventWeek - signupWeek) / WEEK_MS)
    if (offset < 0) offset = 0 // pre-signup-week clock skew counts as W0
    if (offset >= weeks) continue // outside the analysis window
    let arr = activityByUser.get(ev.userId)
    if (!arr) {
      arr = new Array(weeks).fill(0)
      activityByUser.set(ev.userId, arr)
    }
    arr[offset] += ev.count
  }
  stats.orphanActivity = orphanActivity

  const users = []
  let excludedUsers = 0
  for (const [id, signupMs] of signups) {
    let weeklyActivity = activityByUser.get(id)
    const agg = preAgg.get(id)
    if (agg) {
      // Pre-aggregated counts win for the offsets they cover; event-derived
      // counts fill any remaining offsets.
      weeklyActivity = weeklyActivity
        ? weeklyActivity.map((n, i) => (agg[i] > 0 ? agg[i] : n))
        : agg.slice()
    }
    if (!weeklyActivity) weeklyActivity = new Array(weeks).fill(0)
    users.push({ id, signedUpAtMs: signupMs, weeklyActivity })
  }
  // Activity for ids with no signup record at all counts as excluded users.
  const orphanIds = new Set()
  for (const ev of events) if (!signups.has(ev.userId)) orphanIds.add(ev.userId)
  excludedUsers = orphanIds.size

  return { users, excludedUsers, stats }
}

// ---------------------------------------------------------------------------
// Retention matrix
// ---------------------------------------------------------------------------

/**
 * Group users into signup-week cohorts and compute per-week retention.
 *
 * @param {Array<{id:string, signedUpAtMs:number, weeklyActivity:number[]}>} users
 * @param {{ now?: Date|number|string, weeks?: number, maxCohorts?: number }} [options]
 */
export function computeRetentionMatrix(users, options = {}) {
  const now = toDate(options.now ?? new Date())
  const weeks = options.weeks ?? DEFAULT_WEEKS
  const maxCohorts = options.maxCohorts ?? DEFAULT_MAX_COHORTS

  /** @type {Map<number, Array<{id:string, signedUpAtMs:number, weeklyActivity:number[]}>>} */
  const buckets = new Map()
  let excludedUsers = 0

  for (const user of users) {
    const ms = user.signedUpAtMs ?? new Date(user.signedUpAt ?? NaN).getTime()
    if (!Number.isFinite(ms)) {
      excludedUsers += 1
      continue
    }
    const start = weekStartMs(ms)
    const list = buckets.get(start) ?? []
    list.push(user)
    buckets.set(start, list)
  }

  const cohortStarts = [...buckets.keys()].sort((a, b) => b - a).slice(0, maxCohorts)
  const nowMs = now.getTime()

  const cohorts = cohortStarts.map((start) => {
    const members = buckets.get(start) ?? []
    const size = members.length
    /** @type {Array<{week:number, weekStart:string, activeUsers:number, retention:number|null, complete:boolean}>} */
    const cells = []

    for (let w = 0; w < weeks; w++) {
      const weekStart = new Date(start + w * WEEK_MS)
      const complete = weekStart.getTime() + WEEK_MS <= nowMs
      let activeUsers = 0
      for (const member of members) {
        if ((member.weeklyActivity[w] ?? 0) > 0) activeUsers += 1
      }
      cells.push({
        week: w,
        weekStart: weekStart.toISOString(),
        activeUsers,
        retention: complete && size > 0 ? activeUsers / size : null,
        complete,
      })
    }

    const latestComplete = [...cells].reverse().find((c) => c.complete)
    const completeCells = cells.filter((c) => c.complete)
    let inactiveLatestWeek = 0
    let totalActiveWeeks = 0
    for (const member of members) {
      let active = 0
      for (const cell of completeCells) {
        if ((member.weeklyActivity[cell.week] ?? 0) > 0) active += 1
      }
      totalActiveWeeks += active
      if (latestComplete && (member.weeklyActivity[latestComplete.week] ?? 0) === 0) {
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

  // Pooled retention curve: for each week offset, active users / cohort size
  // summed across every cohort whose cell for that offset is complete.
  const curve = []
  for (let w = 0; w < weeks; w++) {
    let active = 0
    let size = 0
    let cohortsComplete = 0
    for (const cohort of cohorts) {
      const cell = cohort.cells[w]
      if (!cell || !cell.complete) continue
      active += cell.activeUsers
      size += cohort.size
      cohortsComplete += 1
    }
    curve.push({
      week: w,
      cohorts: cohortsComplete,
      activeUsers: active,
      cohortSize: size,
      retention: size > 0 ? active / size : null,
    })
  }

  // Users active in the most recent (possibly in-progress) week.
  const currentWeekStart = weekStartMs(now)
  let activeThisWeek = 0
  for (const user of users) {
    const ms = user.signedUpAtMs ?? new Date(user.signedUpAt ?? NaN).getTime()
    if (!Number.isFinite(ms)) continue
    const offset = Math.round((currentWeekStart - weekStartMs(ms)) / WEEK_MS)
    if (offset >= 0 && offset < weeks && (user.weeklyActivity[offset] ?? 0) > 0) {
      activeThisWeek += 1
    }
  }

  return {
    generatedAt: now.toISOString(),
    dataSource: "external",
    weeks,
    cohorts,
    curve,
    totals: {
      users: users.length - excludedUsers,
      excludedUsers,
      activeThisWeek,
    },
  }
}

/** Convenience: records → users → matrix in one call. */
export function analyzeRecords(records, options = {}) {
  const { users, excludedUsers, stats } = recordsToUsers(records, options)
  const report = computeRetentionMatrix(users, options)
  // Orphan activity (no signup record) is excluded from the matrix entirely;
  // surface it in totals so the report accounts for every input user.
  report.totals.excludedUsers += excludedUsers
  report.input = { ...stats, excludedUsers: report.totals.excludedUsers }
  return report
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function pct(retention) {
  return retention === null || retention === undefined ? "—" : `${Math.round(retention * 100)}%`
}

/** @param {ReturnType<typeof computeRetentionMatrix>} report */
export function formatTextReport(report) {
  const lines = []
  lines.push(`Cohort retention report — generated ${report.generatedAt}`)
  lines.push(
    `Source: ${report.dataSource} · ${report.weeks} week window · ${report.totals.users} users`,
  )
  lines.push("")
  const header = ["Cohort", "Size", ...Array.from({ length: report.weeks }, (_, i) => `W${i}`)]
  lines.push(header.join("\t"))
  for (const cohort of report.cohorts) {
    const row = [cohort.label, String(cohort.size)]
    for (const cell of cohort.cells) {
      row.push(cell.complete ? pct(cell.retention) : `${pct(cell.retention)}*`)
    }
    lines.push(row.join("\t"))
  }
  lines.push("")
  lines.push("Retention curve (pooled across complete cohort-weeks):")
  for (const point of report.curve) {
    if (point.cohorts === 0) continue
    lines.push(
      `  W${point.week}: ${pct(point.retention)} (${point.activeUsers}/${point.cohortSize} across ${point.cohorts} cohorts)`,
    )
  }
  lines.push("")
  lines.push(
    `Active this week: ${report.totals.activeThisWeek} · Excluded users: ${report.totals.excludedUsers}`,
  )
  lines.push("* = week still in progress (retention is provisional)")
  return lines.join("\n")
}

/** @param {ReturnType<typeof computeRetentionMatrix>} report */
export function formatMarkdownReport(report) {
  const lines = []
  lines.push("# Cohort retention report")
  lines.push("")
  lines.push(`- Generated: ${report.generatedAt}`)
  lines.push(`- Source: ${report.dataSource}`)
  lines.push(
    `- Window: ${report.weeks} weeks · Users: ${report.totals.users} · Active this week: ${report.totals.activeThisWeek}`,
  )
  lines.push("")
  const header = [
    "Cohort",
    "Size",
    "Avg active wks",
    ...Array.from({ length: report.weeks }, (_, i) => `W${i}`),
  ]
  lines.push(`| ${header.join(" | ")} |`)
  lines.push(`| ${header.map(() => "---").join(" | ")} |`)
  for (const cohort of report.cohorts) {
    const cells = cohort.cells.map((c) => (c.complete ? pct(c.retention) : `${pct(c.retention)}*`))
    lines.push(
      `| ${[cohort.label, cohort.size, cohort.avgActiveWeeks.toFixed(1), ...cells].join(" | ")} |`,
    )
  }
  lines.push("")
  lines.push("## Retention curve")
  lines.push("")
  lines.push("| Week | Retention | Active / size | Cohorts |")
  lines.push("| --- | --- | --- | --- |")
  for (const point of report.curve) {
    if (point.cohorts === 0) continue
    lines.push(
      `| W${point.week} | ${pct(point.retention)} | ${point.activeUsers}/${point.cohortSize} | ${point.cohorts} |`,
    )
  }
  lines.push("")
  lines.push("_`*` marks a week that is still in progress — retention is provisional._")
  if (report.input) {
    lines.push("")
    lines.push("## Input")
    lines.push("")
    lines.push(`- Records read: ${report.input.records ?? "n/a"}`)
    lines.push(`- Signup records: ${report.input.signups ?? "n/a"}`)
    lines.push(`- Pre-aggregated users: ${report.input.preAggregated ?? "n/a"}`)
    lines.push(`- Activity records: ${report.input.activityRecords ?? "n/a"}`)
    lines.push(
      `- Unclassifiable / invalid: ${(report.input.unclassifiable ?? 0) + (report.input.invalidTimestamps ?? 0)}`,
    )
    lines.push(`- Orphan activity (no signup): ${report.input.orphanActivity ?? 0}`)
  }
  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Demo data — deterministic synthetic signup + activity records
// ---------------------------------------------------------------------------

/** mulberry32 — small seeded PRNG so demo output is stable. */
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Generate synthetic JSONL-style records: one signup + one activity record
 * per active week per user. Deterministic for a given seed/now.
 *
 * @param {{ now?: Date|number|string, userCount?: number, weeks?: number,
 *           signupSpanWeeks?: number, seed?: number }} [options]
 * @returns {Array<Record<string, unknown>>}
 */
export function generateDemoRecords(options = {}) {
  const now = toDate(options.now ?? new Date())
  const userCount = options.userCount ?? 48
  const weeks = options.weeks ?? DEFAULT_WEEKS
  const spanWeeks = options.signupSpanWeeks ?? 14
  const rand = mulberry32(options.seed ?? 0xc0ffee)
  const nowWeekStart = weekStartMs(now)
  const records = []

  for (let i = 0; i < userCount; i++) {
    const id = `demo-user-${String(i + 1).padStart(3, "0")}`
    const weeksAgo = Math.floor(rand() * rand() * spanWeeks)
    const signupWeekStart = nowWeekStart - weeksAgo * WEEK_MS
    const maxOffsetDays = Math.min(6, Math.floor((now.getTime() - signupWeekStart) / 86_400_000))
    const dayOffset = Math.floor(rand() * (Math.max(0, maxOffsetDays) + 1))
    let signedUpAt = new Date(
      signupWeekStart + dayOffset * 86_400_000 + Math.floor(rand() * 86_400_000),
    )
    if (signedUpAt.getTime() > now.getTime()) signedUpAt = new Date(now.getTime())

    records.push({ type: "signup", userId: id, at: signedUpAt.toISOString() })

    const initialRetention = 0.82 + rand() * 0.16
    const decay = 0.82 + rand() * 0.14
    let alive = true
    for (let w = 0; w < weeks; w++) {
      const weekStart = signupWeekStart + w * WEEK_MS
      if (weekStart > now.getTime()) break
      if (alive && rand() < initialRetention * Math.pow(decay, w)) {
        const count = 1 + Math.floor(rand() * 6)
        records.push({
          type: "activity",
          userId: id,
          at: new Date(weekStart + Math.floor(rand() * WEEK_MS)).toISOString(),
          count,
        })
      } else {
        alive = false
      }
    }
  }
  return records
}
