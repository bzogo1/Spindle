import { describe, expect, it } from "vitest"

import {
  analyzeRecords,
  classifyRecord,
  computeRetentionMatrix,
  DEFAULT_WEEKS,
  formatMarkdownReport,
  formatTextReport,
  generateDemoRecords,
  recordsToUsers,
  weekStartUtc,
  type NormalizedCohortUser,
} from "./cohort-analysis"

// Wednesday 2026-11-25; its week's Monday is 2026-11-23.
const NOW = new Date("2026-11-25T12:00:00.000Z")

function user(id: string, signedUpAtMs: number, weeklyActivity: number[]): NormalizedCohortUser {
  return { id, signedUpAtMs, weeklyActivity }
}

describe("weekStartUtc", () => {
  it("returns the Monday of the containing week", () => {
    expect(weekStartUtc(NOW).toISOString()).toBe("2026-11-23T00:00:00.000Z")
  })

  it("maps Sunday back to the previous Monday", () => {
    expect(weekStartUtc(new Date("2026-11-29T10:00:00.000Z")).toISOString()).toBe(
      "2026-11-23T00:00:00.000Z",
    )
  })

  it("accepts ISO strings", () => {
    expect(weekStartUtc("2026-11-10T09:00:00.000Z").toISOString()).toBe("2026-11-09T00:00:00.000Z")
  })
})

describe("classifyRecord", () => {
  it("recognizes signup, activity and pre-aggregated shapes", () => {
    expect(classifyRecord({ type: "signup", userId: "u1", at: "2026-11-01T00:00:00Z" })).toBe(
      "signup",
    )
    expect(
      classifyRecord({
        user_id: "u1",
        occurred_at: "2026-11-01T00:00:00Z",
        event_name: "page_view",
      }),
    ).toBe("activity")
    expect(
      classifyRecord({ id: "u1", signedUpAt: "2026-11-01T00:00:00Z", weeklyActivity: [3, 1] }),
    ).toBe("user")
    // Bare users-table row.
    expect(classifyRecord({ id: "u1", created_at: "2026-11-01T00:00:00Z", email: "a@b.c" })).toBe(
      "signup",
    )
    expect(classifyRecord({ foo: "bar" })).toBeNull()
    expect(classifyRecord(null)).toBeNull()
  })
})

describe("recordsToUsers", () => {
  it("buckets activity events into week offsets from the signup week", () => {
    const records = [
      { type: "signup", userId: "u1", at: "2026-11-10T09:00:00.000Z" }, // week of Nov 9
      { type: "activity", userId: "u1", at: "2026-11-12T10:00:00.000Z", count: 2 }, // W0
      { type: "activity", userId: "u1", at: "2026-11-19T10:00:00.000Z" }, // W1
      { type: "activity", userId: "u1", at: "2026-11-26T10:00:00.000Z", count: 3 }, // W2
    ]
    const { users, excludedUsers, stats } = recordsToUsers(records, { weeks: 4 })
    expect(excludedUsers).toBe(0)
    expect(users).toHaveLength(1)
    expect(users[0].id).toBe("u1")
    expect(users[0].weeklyActivity).toEqual([2, 1, 3, 0])
    expect(stats.activityRecords).toBe(3)
  })

  it("accepts pre-aggregated weeklyActivity arrays and objects", () => {
    const records = [
      { id: "u1", signedUpAt: "2026-11-10T09:00:00.000Z", weeklyActivity: [4, 2, 0] },
      { id: "u2", signedUpAt: "2026-11-10T09:00:00.000Z", weekly_activity: { "0": 1, "2": 5 } },
    ]
    const { users } = recordsToUsers(records, { weeks: 4 })
    expect(users.find((u) => u.id === "u1")?.weeklyActivity).toEqual([4, 2, 0, 0])
    expect(users.find((u) => u.id === "u2")?.weeklyActivity).toEqual([1, 0, 5, 0])
  })

  it("users with only a signup record get an all-zero activity array", () => {
    const { users } = recordsToUsers(
      [{ type: "signup", userId: "u1", at: "2026-11-10T09:00:00.000Z" }],
      { weeks: 3 },
    )
    expect(users[0].weeklyActivity).toEqual([0, 0, 0])
  })

  it("excludes orphan activity and reports unclassifiable/invalid records", () => {
    const records = [
      { type: "activity", userId: "ghost", at: "2026-11-12T00:00:00.000Z" },
      { type: "activity", userId: "ghost", at: "2026-11-13T00:00:00.000Z" },
      { type: "activity", userId: "other-ghost", at: "2026-11-12T00:00:00.000Z" },
      { type: "signup", userId: "u1", at: "not-a-date" },
      { nonsense: true },
    ]
    const { users, excludedUsers, stats } = recordsToUsers(records)
    expect(users).toHaveLength(0)
    expect(excludedUsers).toBe(2) // one per orphan user id
    expect(stats.orphanActivity).toBe(3)
    expect(stats.invalidTimestamps).toBe(1)
    expect(stats.unclassifiable).toBe(1)
  })

  it("clamps pre-signup-week activity to W0 and drops events beyond the window", () => {
    const records = [
      { type: "signup", userId: "u1", at: "2026-11-12T09:00:00.000Z" }, // week of Nov 9
      { type: "activity", userId: "u1", at: "2026-11-01T09:00:00.000Z" }, // before signup week → W0
      { type: "activity", userId: "u1", at: "2027-06-01T09:00:00.000Z" }, // far future → dropped
    ]
    const { users } = recordsToUsers(records, { weeks: 4 })
    expect(users[0].weeklyActivity).toEqual([1, 0, 0, 0])
  })

  it("merges event-derived and pre-aggregated counts for the same user", () => {
    const records = [
      { type: "signup", userId: "u1", at: "2026-11-10T09:00:00.000Z" },
      { type: "activity", userId: "u1", at: "2026-11-12T10:00:00.000Z", count: 2 }, // W0
      { id: "u1", signedUpAt: "2026-11-10T09:00:00.000Z", weeklyActivity: [9, 4] },
    ]
    const { users } = recordsToUsers(records, { weeks: 3 })
    // Pre-aggregated values win where > 0; event counts fill the rest.
    expect(users[0].weeklyActivity).toEqual([9, 4, 0])
  })
})

describe("computeRetentionMatrix", () => {
  it("returns an empty report for no users", () => {
    const report = computeRetentionMatrix([], { now: NOW })
    expect(report.cohorts).toEqual([])
    expect(report.curve.every((p) => p.retention === null)).toBe(true)
    expect(report.totals).toEqual({ users: 0, excludedUsers: 0, activeThisWeek: 0 })
  })

  it("groups users by signup week and computes % active per week offset", () => {
    // Cohort week of Nov 9: u1 active W0+W1, u2 active W0 only, u3 never.
    const users = [
      user("u1", Date.parse("2026-11-10T09:00:00Z"), [1, 1, 0, 0, 0, 0, 0, 0]),
      user("u2", Date.parse("2026-11-12T09:00:00Z"), [1, 0, 0, 0, 0, 0, 0, 0]),
      user("u3", Date.parse("2026-11-11T09:00:00Z"), [0, 0, 0, 0, 0, 0, 0, 0]),
    ]
    const report = computeRetentionMatrix(users, { now: NOW, weeks: 4 })
    expect(report.cohorts).toHaveLength(1)
    const cohort = report.cohorts[0]
    expect(cohort.weekStart).toBe("2026-11-09T00:00:00.000Z")
    expect(cohort.size).toBe(3)
    // W0 (Nov 9) and W1 (Nov 16) are complete by Nov 25; W2 (Nov 23) is not.
    expect(cohort.cells[0]).toMatchObject({ activeUsers: 2, retention: 2 / 3, complete: true })
    expect(cohort.cells[1]).toMatchObject({ activeUsers: 1, retention: 1 / 3, complete: true })
    expect(cohort.cells[2]).toMatchObject({ complete: false, retention: null })
    expect(cohort.inactiveLatestWeek).toBe(2) // u2, u3 inactive in W1
    expect(cohort.avgActiveWeeks).toBeCloseTo((2 + 1 + 0) / 3)
  })

  it("orders cohorts most-recent-first and caps at maxCohorts", () => {
    const users = [
      user("old", Date.parse("2026-09-01T09:00:00Z"), [1]),
      user("new", Date.parse("2026-11-24T09:00:00Z"), [1]),
      user("mid", Date.parse("2026-10-20T09:00:00Z"), [1]),
    ]
    const report = computeRetentionMatrix(users, { now: NOW, maxCohorts: 2 })
    expect(report.cohorts.map((c) => c.weekStart)).toEqual([
      "2026-11-23T00:00:00.000Z",
      "2026-10-19T00:00:00.000Z",
    ])
    expect(report.totals.users).toBe(3) // capped display doesn't hide users
  })

  it("pools the retention curve only over complete cohort-weeks", () => {
    const users = [
      // Older cohort: complete through W3.
      user("a", Date.parse("2026-10-05T09:00:00Z"), [1, 1, 0, 0]),
      user("b", Date.parse("2026-10-06T09:00:00Z"), [1, 0, 0, 0]),
      // Current-week cohort: only W0 exists and is incomplete.
      user("c", Date.parse("2026-11-24T09:00:00Z"), [1]),
    ]
    const report = computeRetentionMatrix(users, { now: NOW, weeks: 4 })
    const w0 = report.curve[0]
    // Both cohorts contribute W0: old cohort complete (2 users, 2 active),
    // current cohort's W0 is incomplete → excluded.
    expect(w0.cohorts).toBe(1)
    expect(w0.retention).toBe(1)
    const w3 = report.curve[3]
    expect(w3.retention).toBe(0) // neither old-cohort user active in W3
    // Old-cohort users are 7 weeks past signup (outside the 4-week window);
    // only c — signed up in the current week — counts as active this week.
    expect(report.totals.activeThisWeek).toBe(1)
  })

  it("counts activeThisWeek across all users in the current week", () => {
    const users = [
      user("a", Date.parse("2026-11-10T09:00:00Z"), [0, 0, 1, 0, 0, 0, 0, 0]), // W2 = current week
      user("b", Date.parse("2026-11-24T09:00:00Z"), [1]), // signed up this week, W0
      user("c", Date.parse("2026-11-10T09:00:00Z"), [1, 0, 0, 0, 0, 0, 0, 0]),
    ]
    const report = computeRetentionMatrix(users, { now: NOW, weeks: DEFAULT_WEEKS })
    // a active at offset 2 (Nov 23 week), b active at offset 0, c inactive.
    expect(report.totals.activeThisWeek).toBe(2)
  })
})

describe("analyzeRecords + formatting", () => {
  it("produces a report with input diagnostics", () => {
    const records = [
      { type: "signup", userId: "u1", at: "2026-11-10T09:00:00.000Z" },
      { type: "activity", userId: "u1", at: "2026-11-12T10:00:00.000Z" },
      { id: "u2", created_at: "2026-11-10T09:00:00.000Z" },
      { type: "activity", userId: "ghost", at: "2026-11-12T10:00:00.000Z" },
    ]
    const report = analyzeRecords(records, { now: NOW, weeks: 4 })
    expect(report.totals.users).toBe(2)
    expect(report.totals.excludedUsers).toBe(1)
    expect(report.input?.signups).toBe(2)
    expect(report.input?.activityRecords).toBe(2)
    expect(report.input?.orphanActivity).toBe(1)
    const md = formatMarkdownReport(report)
    expect(md).toContain("# Cohort retention report")
    expect(md).toContain("| W0 |")
    const text = formatTextReport(report)
    expect(text).toContain("Cohort retention report")
    expect(text).toContain("*")
  })

  it("handles demo records end-to-end and is deterministic", () => {
    const a = analyzeRecords(generateDemoRecords({ now: NOW }), { now: NOW })
    const b = analyzeRecords(generateDemoRecords({ now: NOW }), { now: NOW })
    expect(a.totals.users).toBe(b.totals.users)
    expect(a.cohorts.map((c) => c.size)).toEqual(b.cohorts.map((c) => c.size))
    expect(a.totals.users).toBeGreaterThan(0)
    expect(a.cohorts.length).toBeGreaterThan(0)
    // Every cohort's W0 retention is 100% for signups that week? Not
    // necessarily — demo emits activity per active week; W0 may be 0 for
    // users whose curve died instantly. Just assert sane bounds.
    for (const cohort of a.cohorts) {
      for (const cell of cohort.cells) {
        if (cell.retention !== null) {
          expect(cell.retention).toBeGreaterThanOrEqual(0)
          expect(cell.retention).toBeLessThanOrEqual(1)
        }
      }
    }
  })
})
