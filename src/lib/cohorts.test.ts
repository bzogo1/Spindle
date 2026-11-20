import { describe, expect, it } from "vitest"

import {
  buildCohortReport,
  COHORT_WEEKS,
  generateDemoCohortUsers,
  getDemoCohortReport,
  weekStartUtc,
  type CohortUserInput,
} from "./cohorts"

const NOW = new Date("2026-11-25T12:00:00.000Z") // a Wednesday

function user(id: string, signedUpAt: string, weeklyActivity: number[]): CohortUserInput {
  return { id, signedUpAt, weeklyActivity }
}

describe("weekStartUtc", () => {
  it("returns the Monday of the containing week", () => {
    // 2026-11-25 is a Wednesday; Monday is 2026-11-23.
    expect(weekStartUtc(NOW).toISOString()).toBe("2026-11-23T00:00:00.000Z")
  })

  it("maps Sunday to the Monday six days earlier", () => {
    // 2026-11-29 is a Sunday → week started 2026-11-23.
    expect(weekStartUtc(new Date("2026-11-29T10:00:00.000Z")).toISOString()).toBe(
      "2026-11-23T00:00:00.000Z",
    )
  })

  it("maps Monday to itself", () => {
    expect(weekStartUtc(new Date("2026-11-23T00:00:00.000Z")).toISOString()).toBe(
      "2026-11-23T00:00:00.000Z",
    )
  })
})

describe("buildCohortReport", () => {
  it("returns an empty report for no users", () => {
    const report = buildCohortReport([], { now: NOW })
    expect(report.cohorts).toEqual([])
    expect(report.totals).toEqual({ users: 0, excludedUsers: 0, activeThisWeek: 0 })
    expect(report.dataSource).toBe("demo")
  })

  it("groups users by signup week, most recent cohort first", () => {
    const users = [
      user("a", "2026-11-24T09:00:00.000Z", [3]), // current week
      user("b", "2026-11-10T09:00:00.000Z", [1, 1]), // week of Nov 9
      user("c", "2026-11-12T09:00:00.000Z", [2]), // same week as b
      user("d", "2026-11-03T09:00:00.000Z", [1]), // week of Nov 2
    ]
    const report = buildCohortReport(users, { now: NOW })

    expect(report.cohorts.map((c) => c.weekStart)).toEqual([
      "2026-11-23T00:00:00.000Z",
      "2026-11-09T00:00:00.000Z",
      "2026-11-02T00:00:00.000Z",
    ])
    expect(report.cohorts[0].size).toBe(1)
    expect(report.cohorts[1].size).toBe(2)
    expect(report.cohorts[1].label).toBe("Nov 9")
  })

  it("computes retention per week and marks incomplete weeks", () => {
    // Cohort week of Nov 9: by Nov 25, weeks W0 (Nov 9) and W1 (Nov 16) are
    // complete; W2 (Nov 23, current week) is in progress.
    const users = [
      user("a", "2026-11-10T09:00:00.000Z", [4, 2, 1]),
      user("b", "2026-11-11T09:00:00.000Z", [4, 0, 0]),
      user("c", "2026-11-12T09:00:00.000Z", [0, 3, 2]),
    ]
    const report = buildCohortReport(users, { now: NOW })
    const cohort = report.cohorts[0]

    expect(cohort.cells[0]).toMatchObject({
      week: 0,
      activeUsers: 2,
      retention: 2 / 3,
      complete: true,
    })
    expect(cohort.cells[1]).toMatchObject({
      week: 1,
      activeUsers: 2,
      retention: 2 / 3,
      complete: true,
    })
    expect(cohort.cells[2]).toMatchObject({
      week: 2,
      activeUsers: 2,
      retention: null,
      complete: false,
    })
  })

  it("counts inactive users in the latest complete week", () => {
    const users = [
      user("a", "2026-11-10T09:00:00.000Z", [4, 2]),
      user("b", "2026-11-11T09:00:00.000Z", [4, 0]),
    ]
    const report = buildCohortReport(users, { now: NOW })
    const cohort = report.cohorts[0]
    // Latest complete week is W1 (Nov 16); user b had no activity there.
    expect(cohort.inactiveLatestWeek).toBe(1)
  })

  it("counts users active in the current week for totals.activeThisWeek", () => {
    const users = [
      user("a", "2026-11-24T09:00:00.000Z", [2]), // signed up this week
      user("b", "2026-11-10T09:00:00.000Z", [1, 1, 1]), // active in current week (W2)
      user("c", "2026-11-10T09:00:00.000Z", [1, 1, 0]), // not active this week
    ]
    const report = buildCohortReport(users, { now: NOW })
    expect(report.totals.users).toBe(3)
    expect(report.totals.excludedUsers).toBe(0)
    expect(report.totals.activeThisWeek).toBe(2)
  })

  it("skips users with unparseable signup dates and reports them honestly", () => {
    const users = [user("bad", "not-a-date", [1]), user("ok", "2026-11-24T00:00:00.000Z", [1])]
    const report = buildCohortReport(users, { now: NOW })
    // totals.users counts only cohort-eligible users; the skipped user is
    // surfaced separately in totals.excludedUsers.
    expect(report.totals.users).toBe(1)
    expect(report.totals.excludedUsers).toBe(1)
    expect(report.cohorts).toHaveLength(1)
    expect(report.cohorts[0].size).toBe(1)
  })

  it("counts avgActiveWeeks only over weeks that have fully elapsed", () => {
    // Cohort week of Nov 9: W0 and W1 are complete, W2 (current week) is not.
    // Both users are active in the in-progress W2, but that must not count.
    const users = [
      user("a", "2026-11-10T09:00:00.000Z", [4, 2, 5]),
      user("b", "2026-11-11T09:00:00.000Z", [4, 0, 5]),
    ]
    const report = buildCohortReport(users, { now: NOW })
    const cohort = report.cohorts[0]
    // Complete-week active counts: a=2 (W0,W1), b=1 (W0 only) → mean 1.5.
    // Including the in-progress W2 would wrongly give 2.0.
    expect(cohort.cells[2].complete).toBe(false)
    expect(cohort.avgActiveWeeks).toBe(1.5)
  })

  it("caps the number of cohorts", () => {
    const users: CohortUserInput[] = []
    for (let w = 0; w < 20; w++) {
      const signedUpAt = new Date(NOW.getTime() - w * 7 * 86_400_000).toISOString()
      users.push(user(`u${w}`, signedUpAt, [1]))
    }
    const report = buildCohortReport(users, { now: NOW, maxCohorts: 5 })
    expect(report.cohorts).toHaveLength(5)
  })

  it("respects a custom week count", () => {
    const users = [user("a", "2026-11-10T09:00:00.000Z", [1, 1, 1, 1])]
    const report = buildCohortReport(users, { now: NOW, weeks: 4 })
    expect(report.weeks).toBe(4)
    expect(report.cohorts[0].cells).toHaveLength(4)
  })
})

describe("demo data", () => {
  it("generates a deterministic population", () => {
    const a = generateDemoCohortUsers(NOW)
    const b = generateDemoCohortUsers(NOW)
    expect(a).toEqual(b)
    expect(a.length).toBeGreaterThan(0)
    for (const u of a) {
      expect(u.weeklyActivity.length).toBeLessThanOrEqual(COHORT_WEEKS)
      expect(Number.isNaN(new Date(u.signedUpAt).getTime())).toBe(false)
    }
  })

  it("produces a populated report", () => {
    const report = getDemoCohortReport(NOW)
    expect(report.cohorts.length).toBeGreaterThan(0)
    expect(report.totals.users).toBeGreaterThan(0)
    expect(report.dataSource).toBe("demo")
    expect(report.note).toMatch(/demo/i)
  })
})
