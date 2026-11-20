import { describe, expect, it } from "vitest"

import { humanizeCron, nextCronRuns } from "./cron"

describe("humanizeCron", () => {
  it("describes a daily time", () => {
    expect(humanizeCron("0 17 * * *")).toEqual({
      valid: true,
      text: "At 05:00 PM, every day",
      parts: ["0", "17", "*", "*", "*"],
    })
  })

  it("describes minute steps", () => {
    expect(humanizeCron("*/15 * * * *")).toEqual({
      valid: true,
      text: "Every 15 minutes, every day",
      parts: ["*/15", "*", "*", "*", "*"],
    })
  })

  it("describes sub-hour and multi-hour schedules", () => {
    expect(humanizeCron("* * * * *").text).toBe("Every minute, every day")
    expect(humanizeCron("* */2 * * *").text).toBe("Every 2 hours, every day")
    expect(humanizeCron("* 9 * * *").text).toBe("Every minute during the 09:00 AM hour, every day")
    expect(humanizeCron("* 9,17 * * *").text).toBe(
      "Every minute during the 09:00 AM and 05:00 PM hours, every day",
    )
    expect(humanizeCron("5 * * * *").text).toBe("At minute 5 of every hour, every day")
    expect(humanizeCron("5,35 * * * *").text).toBe("At minutes 5 and 35 of every hour, every day")
    expect(humanizeCron("*/20 9 * * *").text).toBe(
      "Every 20 minutes during the 09:00 AM hour, every day",
    )
  })

  it("describes weekday ranges and lists", () => {
    expect(humanizeCron("0 9 * * 1-5").text).toBe("At 09:00 AM, Monday through Friday")
    expect(humanizeCron("0 0 * * 1,3").text).toBe("At 12:00 AM, every Monday and Wednesday")
  })

  it("keeps unrecognised weekday and month fields readable", () => {
    expect(humanizeCron("0 8 * * */2").text).toBe("At 08:00 AM, on weekday */2")
    expect(humanizeCron("0 8 * 1,6 *").text).toBe("At 08:00 AM, every day in January")
  })

  it("describes day-of-month and month", () => {
    expect(humanizeCron("30 6 1 12 *").text).toBe("At 06:30 AM, on day 1 of the month in December")
  })

  it("explains why an expression is invalid", () => {
    expect(humanizeCron("0 0 * *")).toEqual({
      valid: false,
      text: "Use 5 fields: minute hour day month weekday",
    })
    expect(humanizeCron("0 24 * * *")).toEqual({
      valid: false,
      text: "One or more fields are outside their valid range",
    })
  })
})

describe("nextCronRuns", () => {
  it("returns the next daily occurrence after the start time", () => {
    const from = new Date(2026, 0, 5, 10, 0, 0) // Mon Jan 5 2026, 10:00
    const runs = nextCronRuns("0 9 * * *", 2, from)
    expect(runs).toHaveLength(2)
    expect(runs[0]).toEqual(new Date(2026, 0, 6, 9, 0, 0))
    expect(runs[1]).toEqual(new Date(2026, 0, 7, 9, 0, 0))
  })

  it("includes today when the run is still ahead", () => {
    const from = new Date(2026, 0, 5, 8, 0, 0)
    const runs = nextCronRuns("0 9 * * *", 1, from)
    expect(runs[0]).toEqual(new Date(2026, 0, 5, 9, 0, 0))
  })

  it("honours weekday lists and intervals", () => {
    const from = new Date(2026, 0, 5, 12, 0, 0) // Monday
    const weekly = nextCronRuns("30 9 * * 3", 1, from)
    expect(weekly[0].getDay()).toBe(3) // Wednesday
    expect(weekly[0].getHours()).toBe(9)
    expect(weekly[0].getMinutes()).toBe(30)

    const interval = nextCronRuns("*/15 * * * *", 3, from)
    expect(interval).toHaveLength(3)
    expect(interval[0].getMinutes()).toBe(15)
    expect(interval[1].getMinutes()).toBe(30)
  })

  it("returns an empty list for invalid expressions", () => {
    expect(nextCronRuns("not a cron", 3)).toEqual([])
    expect(nextCronRuns("0 25 * * *", 3)).toEqual([])
  })
})

describe("nextCronRuns dom+dow OR semantics", () => {
  it("ORs day-of-month and day-of-week when both are restricted", () => {
    // "0 9 1 * 1" = 09:00 on the 1st of the month OR every Monday (POSIX).
    const from = new Date(2026, 0, 6, 10, 0, 0) // Tue Jan 6 2026, 10:00
    const runs = nextCronRuns("0 9 1 * 1", 4, from)
    expect(runs).toHaveLength(4)
    // Mondays win first.
    expect(runs[0]).toEqual(new Date(2026, 0, 12, 9, 0, 0))
    expect(runs[1]).toEqual(new Date(2026, 0, 19, 9, 0, 0))
    expect(runs[2]).toEqual(new Date(2026, 0, 26, 9, 0, 0))
    // Then the 1st of February (a Sunday — dom match despite not Monday).
    expect(runs[3]).toEqual(new Date(2026, 1, 1, 9, 0, 0))
    expect(runs[3].getDay()).toBe(0)
  })

  it("still ANDs when only one day field is restricted", () => {
    const from = new Date(2026, 0, 6, 10, 0, 0)
    // dow only: next Monday.
    const dowOnly = nextCronRuns("0 9 * * 1", 1, from)
    expect(dowOnly[0]).toEqual(new Date(2026, 0, 12, 9, 0, 0))
    // dom only: next 1st of month (Feb 1).
    const domOnly = nextCronRuns("0 9 1 * *", 1, from)
    expect(domOnly[0]).toEqual(new Date(2026, 1, 1, 9, 0, 0))
  })
})

describe("humanizeCron dom+dow", () => {
  it("describes both restricted day fields as alternatives", () => {
    expect(humanizeCron("0 9 1 * 1").text).toBe(
      "At 09:00 AM, on day 1 of the month or every Monday",
    )
  })
})
