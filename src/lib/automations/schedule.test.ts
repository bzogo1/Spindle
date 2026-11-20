import { describe, expect, it } from "vitest"

import {
  describeSchedule,
  intervalError,
  isScheduleValid,
  makeIntervalSchedule,
  nextScheduleRuns,
  type AutomationSchedule,
} from "./schedule"

describe("describeSchedule", () => {
  it("describes cron schedules with the shared humanizer", () => {
    expect(describeSchedule({ kind: "cron", expr: "0 9 * * *" })).toBe("At 09:00 AM, every day")
  })

  it("describes interval schedules", () => {
    expect(describeSchedule({ kind: "interval", every: 1, unit: "hours" })).toBe("Every 1 hour")
    expect(describeSchedule({ kind: "interval", every: 30, unit: "minutes" })).toBe(
      "Every 30 minutes",
    )
    expect(describeSchedule({ kind: "interval", every: 2, unit: "days" })).toBe("Every 2 days")
  })
})

describe("intervalError / isScheduleValid", () => {
  it("accepts whole numbers within the unit bounds", () => {
    expect(intervalError({ every: 5, unit: "minutes" })).toBeNull()
    expect(isScheduleValid({ kind: "interval", every: 5, unit: "minutes" })).toBe(true)
  })

  it("rejects zero, fractions, and oversized intervals", () => {
    expect(intervalError({ every: 0, unit: "hours" })).toMatch(/at least 1/)
    expect(intervalError({ every: 1.5, unit: "hours" })).toMatch(/at least 1/)
    expect(intervalError({ every: 2000, unit: "minutes" })).toMatch(/1440/)
    expect(intervalError({ every: 400, unit: "days" })).toMatch(/366/)
    expect(isScheduleValid({ kind: "interval", every: 2000, unit: "minutes" })).toBe(false)
  })

  it("validates cron schedules through humanizeCron", () => {
    expect(isScheduleValid({ kind: "cron", expr: "0 9 * * *" })).toBe(true)
    expect(isScheduleValid({ kind: "cron", expr: "not a cron" })).toBe(false)
  })
})

describe("makeIntervalSchedule", () => {
  it("returns a schedule for valid input and null otherwise", () => {
    expect(makeIntervalSchedule(15, "minutes")).toEqual({
      kind: "interval",
      every: 15,
      unit: "minutes",
    })
    expect(makeIntervalSchedule(0, "days")).toBeNull()
  })
})

describe("nextScheduleRuns", () => {
  const from = new Date("2026-11-20T12:00:00.000Z")

  it("delegates cron schedules to nextCronRuns", () => {
    const runs = nextScheduleRuns({ kind: "cron", expr: "0 9 * * *" }, 1, from)
    expect(runs).toHaveLength(1)
    expect(runs[0].getHours()).toBe(9)
    expect(runs[0].getTime()).toBeGreaterThan(from.getTime())
  })

  it("returns no runs for invalid schedules", () => {
    const bad: AutomationSchedule = { kind: "cron", expr: "bogus" }
    expect(nextScheduleRuns(bad, 3, from)).toEqual([])
  })

  it("computes interval runs from `from` when no anchor is given", () => {
    const runs = nextScheduleRuns({ kind: "interval", every: 30, unit: "minutes" }, 3, from)
    expect(runs).toHaveLength(3)
    expect(runs[0].getTime()).toBe(from.getTime() + 30 * 60_000)
    expect(runs[1].getTime()).toBe(from.getTime() + 60 * 60_000)
    expect(runs[2].getTime()).toBe(from.getTime() + 90 * 60_000)
  })

  it("anchors intervals to the last run so they do not drift", () => {
    // Last run 10 minutes ago; every-30-minutes schedule is due in 20 minutes.
    const anchor = new Date(from.getTime() - 10 * 60_000)
    const runs = nextScheduleRuns({ kind: "interval", every: 30, unit: "minutes" }, 2, from, anchor)
    expect(runs[0].getTime()).toBe(anchor.getTime() + 30 * 60_000)
    expect(runs[1].getTime()).toBe(anchor.getTime() + 60 * 60_000)
  })

  it("skips missed occurrences when the anchor is far in the past", () => {
    const anchor = new Date(from.getTime() - 75 * 60_000) // 2.5 intervals ago
    const runs = nextScheduleRuns({ kind: "interval", every: 30, unit: "minutes" }, 1, from, anchor)
    // anchor + 3*30min = from + 15min
    expect(runs[0].getTime()).toBe(anchor.getTime() + 90 * 60_000)
    expect(runs[0].getTime()).toBeGreaterThan(from.getTime())
  })

  it("supports hour and day units", () => {
    const hours = nextScheduleRuns({ kind: "interval", every: 6, unit: "hours" }, 1, from)
    expect(hours[0].getTime()).toBe(from.getTime() + 6 * 3_600_000)

    const days = nextScheduleRuns({ kind: "interval", every: 1, unit: "days" }, 1, from)
    expect(days[0].getTime()).toBe(from.getTime() + 86_400_000)
  })
})
