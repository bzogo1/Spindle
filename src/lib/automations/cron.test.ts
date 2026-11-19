import { describe, expect, it } from "vitest"

import { humanizeCron } from "./cron"

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
