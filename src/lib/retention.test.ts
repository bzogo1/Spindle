import { describe, expect, it } from "vitest"

import {
  DAY_MS,
  buildRetentionReport,
  buildUserActivity,
  computeActivityWindows,
  computeChurn,
  computeNDayRetention,
  computeSurvivalCurve,
  dayIndexOf,
  generateDemoActivityEvents,
  isoDateOfDayIndex,
  usersActiveInWindow,
  type ActivityEventInput,
  type UserActivity,
} from "./retention"

const NOW = new Date("2025-06-15T12:00:00Z") // a Sunday, midday UTC
const DAY0 = dayIndexOf(NOW.getTime())

/** Build a UserActivity directly for unit tests. */
function user(
  userId: string,
  anchorDayOffset: number, // days before today (negative = future)
  activeDayOffsetsFromAnchor: number[],
): UserActivity {
  const anchor = DAY0 - anchorDayOffset
  const activeDayIndexes = activeDayOffsetsFromAnchor.map((o) => anchor + o)
  const ts = (d: number) => d * DAY_MS + 3_600_000
  return {
    userId,
    firstSeenAt: ts(anchor),
    lastSeenAt: ts(Math.max(...activeDayIndexes)),
    eventCount: activeDayIndexes.length,
    activeDayIndexes: [...activeDayIndexes].sort((a, b) => a - b),
  }
}

describe("buildUserActivity", () => {
  it("groups events per user and derives first/last/days", () => {
    const events: ActivityEventInput[] = [
      { userId: "a", timestamp: DAY0 * DAY_MS + 1000 },
      { userId: "a", timestamp: DAY0 * DAY_MS + 2000 },
      { userId: "a", timestamp: (DAY0 - 2) * DAY_MS + 500 },
      { userId: "b", timestamp: (DAY0 - 1) * DAY_MS + 500 },
    ]
    const { users, excludedEvents } = buildUserActivity(events)
    expect(excludedEvents).toBe(0)
    expect(users).toHaveLength(2)
    const a = users.find((u) => u.userId === "a")!
    expect(a.eventCount).toBe(3)
    expect(a.firstSeenAt).toBe((DAY0 - 2) * DAY_MS + 500)
    expect(a.activeDayIndexes).toEqual([DAY0 - 2, DAY0])
  })

  it("skips invalid events and counts them", () => {
    const { users, excludedEvents } = buildUserActivity([
      { userId: "", timestamp: 1 },
      { userId: "a", timestamp: Number.NaN },
      { userId: "a", timestamp: 1 },
    ])
    expect(users).toHaveLength(1)
    expect(excludedEvents).toBe(2)
  })
})

describe("usersActiveInWindow / computeActivityWindows", () => {
  it("counts distinct users in trailing 1/7/30-day windows", () => {
    const users = [
      user("today", 0, [0]),
      user("yesterday", 1, [0]),
      user("last-week", 6, [0]),
      user("two-weeks", 10, [0]),
      user("old", 40, [0]),
    ]
    expect(usersActiveInWindow(users, NOW, 1).size).toBe(1)
    expect(usersActiveInWindow(users, NOW, 7).size).toBe(3)
    const w = computeActivityWindows(users, NOW)
    expect(w.dau).toBe(1)
    expect(w.wau).toBe(3)
    expect(w.mau).toBe(4)
    expect(w.dauWauRatio).toBeCloseTo(1 / 3)
  })

  it("returns null ratio when WAU is empty", () => {
    const w = computeActivityWindows([], NOW)
    expect(w.dauWauRatio).toBeNull()
    expect(w.dau).toBe(0)
  })
})

describe("computeChurn", () => {
  it("counts users active in the prior window who went silent", () => {
    // windowDays=7, now=DAY0. Cohort window = days [DAY0-13, DAY0-7],
    // churn window = days [DAY0-6, DAY0].
    const users = [
      user("churned", 10, [0]), // active only in cohort window
      user("retained", 10, [0, 8]), // also active in churn window
      user("new", 2, [0]), // not in cohort window (first seen in churn window)
    ]
    const c = computeChurn(users, NOW, 7)
    expect(c.cohortSize).toBe(2)
    expect(c.churned).toBe(1)
    expect(c.retained).toBe(1)
    expect(c.churnRate).toBe(0.5)
  })

  it("returns null churnRate for an empty cohort", () => {
    const c = computeChurn([user("new", 1, [0])], NOW, 7)
    expect(c.cohortSize).toBe(0)
    expect(c.churnRate).toBeNull()
  })
})

describe("computeNDayRetention", () => {
  it("computes per-anchor-day retention with null for future days", () => {
    const users = [user("u1", 10, [0, 1, 7]), user("u2", 10, [0, 1]), user("u3", 3, [0, 1])]
    const cohorts = computeNDayRetention(users, {
      now: NOW,
      dayOffsets: [1, 7],
      maxCohorts: 10,
    })
    const c10 = cohorts.find((c) => c.anchorDay === isoDateOfDayIndex(DAY0 - 10))!
    expect(c10.cohortSize).toBe(2)
    const day1 = c10.cells.find((c) => c.dayOffset === 1)!
    expect(day1.activeUsers).toBe(2)
    expect(day1.retention).toBe(1)
    const day7 = c10.cells.find((c) => c.dayOffset === 7)!
    expect(day7.activeUsers).toBe(1)
    expect(day7.retention).toBe(0.5)

    // Cohort anchored 3 days ago: day-7 target hasn't elapsed.
    const c3 = cohorts.find((c) => c.anchorDay === isoDateOfDayIndex(DAY0 - 3))!
    const c3d7 = c3.cells.find((c) => c.dayOffset === 7)!
    expect(c3d7.retention).toBeNull()
  })
})

describe("computeSurvivalCurve", () => {
  it("only counts users old enough to be observed at each day", () => {
    // u1 anchored 20 days ago, last active at anchor+15 → survives to day 15.
    // u2 anchored 5 days ago → not eligible past day 5.
    const users = [user("u1", 20, [0, 15]), user("u2", 5, [0, 5])]
    const curve = computeSurvivalCurve(users, { now: NOW, maxDays: 20 })

    const d0 = curve.find((p) => p.day === 0)!
    expect(d0.eligible).toBe(2)
    expect(d0.survival).toBe(1)

    const d5 = curve.find((p) => p.day === 5)!
    expect(d5.eligible).toBe(2)
    expect(d5.retained).toBe(2) // u1 lastSeen >= anchor+5, u2 = anchor+5
    expect(d5.survival).toBe(1)

    const d6 = curve.find((p) => p.day === 6)!
    expect(d6.eligible).toBe(1) // u2's anchor+6 is in the future
    expect(d6.retained).toBe(1)
    expect(d6.survival).toBe(1)

    const d15 = curve.find((p) => p.day === 15)!
    expect(d15.retained).toBe(1)
    expect(d15.survival).toBe(1)

    const d16 = curve.find((p) => p.day === 16)!
    expect(d16.retained).toBe(0)
    expect(d16.survival).toBe(0)
  })

  it("returns null survival when nobody is eligible", () => {
    const users = [user("u", 0, [0])]
    const curve = computeSurvivalCurve(users, { now: NOW, maxDays: 3 })
    expect(curve[1].survival).toBeNull()
    expect(curve[1].eligible).toBe(0)
  })
})

describe("buildRetentionReport", () => {
  it("aggregates all metrics from raw events", () => {
    const events: ActivityEventInput[] = [
      { userId: "a", timestamp: (DAY0 - 10) * DAY_MS + 100 },
      { userId: "a", timestamp: (DAY0 - 9) * DAY_MS + 100 },
      { userId: "a", timestamp: DAY0 * DAY_MS + 100 }, // today
      { userId: "b", timestamp: (DAY0 - 10) * DAY_MS + 100 },
      { userId: "b", timestamp: (DAY0 - 10) * DAY_MS + 200 },
    ]
    const report = buildRetentionReport(events, {
      now: NOW,
      dataSource: "events",
      dayOffsets: [1],
      survivalMaxDays: 5,
    })
    expect(report.users).toBe(2)
    expect(report.events).toBe(5)
    expect(report.windows.dau).toBe(1)
    // Both users active at DAY0-10 (cohort window); only "a" is active in the
    // trailing 7-day churn window, so b churns.
    expect(report.churn.cohortSize).toBe(2)
    expect(report.churn.churned).toBe(1)
    expect(report.churn.churnRate).toBe(0.5)
    expect(report.nDayRetention.length).toBeGreaterThan(0)
    expect(report.survival).toHaveLength(6)
    expect(report.excludedEvents).toBe(0)
  })
})

describe("generateDemoActivityEvents", () => {
  it("is deterministic and produces plausible volume", () => {
    const a = generateDemoActivityEvents(NOW)
    const b = generateDemoActivityEvents(NOW)
    expect(a).toEqual(b)
    expect(a.length).toBeGreaterThan(500)
    const users = new Set(a.map((e) => e.userId))
    expect(users.size).toBeGreaterThan(50)
    // No events in the future.
    for (const e of a) expect(e.timestamp).toBeLessThanOrEqual(NOW.getTime())
  })
})
