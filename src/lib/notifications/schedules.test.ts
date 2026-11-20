import { afterEach, describe, expect, it } from "vitest"

import {
  NOTIFICATION_SCHEDULES_STORAGE_KEY,
  advanceNotificationSchedule,
  buildNotificationSchedule,
  loadNotificationSchedules,
  nextRecurringFireAt,
  sanitizeNotificationSchedule,
  sanitizeNotificationSchedules,
  saveNotificationSchedules,
  wallClockTimeOf,
  type NotificationSchedule,
} from "./schedules"

function validSchedule(overrides: Partial<NotificationSchedule> = {}): NotificationSchedule {
  return {
    id: "sch_test_1",
    title: "Check the build",
    body: "",
    type: "info",
    frequency: "once",
    fireAt: "2025-01-20T09:00:00.000Z",
    enabled: true,
    createdAt: "2025-01-15T00:00:00.000Z",
    ...overrides,
  }
}

describe("sanitizeNotificationSchedule", () => {
  it("accepts a valid schedule and normalizes timestamps", () => {
    const result = sanitizeNotificationSchedule(validSchedule())
    expect(result?.id).toBe("sch_test_1")
    expect(result?.fireAt).toBe("2025-01-20T09:00:00.000Z")
  })

  it("rejects malformed payloads", () => {
    expect(sanitizeNotificationSchedule(null)).toBeNull()
    expect(sanitizeNotificationSchedule({})).toBeNull()
    expect(sanitizeNotificationSchedule(validSchedule({ id: "bad id!" }))).toBeNull()
    expect(sanitizeNotificationSchedule(validSchedule({ title: "" }))).toBeNull()
    expect(sanitizeNotificationSchedule(validSchedule({ frequency: "hourly" as never }))).toBeNull()
    expect(sanitizeNotificationSchedule(validSchedule({ fireAt: "not a date" }))).toBeNull()
    expect(sanitizeNotificationSchedule(validSchedule({ createdAt: "junk" }))).toBeNull()
  })

  it("drops recurring schedules without a wall-clock time", () => {
    expect(
      sanitizeNotificationSchedule(
        validSchedule({ frequency: "daily", fireAt: "2025-01-20T09:00:00.000Z" }),
      ),
    ).toBeNull()
    expect(
      sanitizeNotificationSchedule(
        validSchedule({ frequency: "daily", time: "09:30", fireAt: "2025-01-20T09:30:00.000Z" }),
      ),
    ).not.toBeNull()
  })

  it("drops unsafe href schemes instead of storing them", () => {
    const safe = sanitizeNotificationSchedule(validSchedule({ href: "/app/agent/run_1" }))
    expect(safe?.href).toBe("/app/agent/run_1")

    for (const href of ["javascript:alert(1)", "data:text/html,x", "//evil.example.com"]) {
      const result = sanitizeNotificationSchedule(validSchedule({ href }))
      expect(result).not.toBeNull()
      expect(result?.href).toBeUndefined()
    }
  })

  it("sanitizes lists: dedupes ids and caps the count", () => {
    const list = sanitizeNotificationSchedules([
      validSchedule(),
      validSchedule(),
      { junk: true },
      validSchedule({ id: "sch_test_2", title: "Second" }),
    ])
    expect(list.map((schedule) => schedule.id)).toEqual(["sch_test_1", "sch_test_2"])
    expect(sanitizeNotificationSchedules("nope")).toEqual([])
  })
})

describe("loadNotificationSchedules / saveNotificationSchedules", () => {
  afterEach(() => {
    window.localStorage.removeItem(NOTIFICATION_SCHEDULES_STORAGE_KEY)
  })

  it("round-trips schedules through localStorage", () => {
    const schedules = [validSchedule({ frequency: "daily", time: "08:15" })]
    saveNotificationSchedules(schedules)
    expect(loadNotificationSchedules()).toHaveLength(1)
    expect(loadNotificationSchedules()[0].time).toBe("08:15")
  })

  it("returns an empty list for missing or corrupt storage", () => {
    expect(loadNotificationSchedules()).toEqual([])
    window.localStorage.setItem(NOTIFICATION_SCHEDULES_STORAGE_KEY, "{broken")
    expect(loadNotificationSchedules()).toEqual([])
    window.localStorage.setItem(NOTIFICATION_SCHEDULES_STORAGE_KEY, JSON.stringify({ nope: 1 }))
    expect(loadNotificationSchedules()).toEqual([])
  })
})

describe("nextRecurringFireAt", () => {
  it("returns null for one-shot schedules", () => {
    expect(nextRecurringFireAt({ frequency: "once" }, Date.now())).toBeNull()
  })

  it("finds the next daily occurrence strictly after `from`", () => {
    // 2025-01-15 is a Wednesday; 09:00 local.
    const from = new Date(2025, 0, 15, 8, 0).getTime()
    const next = nextRecurringFireAt({ frequency: "daily", time: "09:00" }, from)
    expect(next).toBe(new Date(2025, 0, 15, 9, 0).getTime())

    // After today's occurrence → tomorrow.
    const later = new Date(2025, 0, 15, 10, 0).getTime()
    const nextDay = nextRecurringFireAt({ frequency: "daily", time: "09:00" }, later)
    expect(nextDay).toBe(new Date(2025, 0, 16, 9, 0).getTime())
  })

  it("finds the next weekly occurrence on the configured weekday", () => {
    const from = new Date(2025, 0, 15, 12, 0).getTime() // Wednesday
    const next = nextRecurringFireAt(
      { frequency: "weekly", time: "09:00", weekday: 5 }, // Friday
      from,
    )
    expect(next).toBe(new Date(2025, 0, 17, 9, 0).getTime())
  })

  it("returns null without a valid time", () => {
    expect(nextRecurringFireAt({ frequency: "daily" }, Date.now())).toBeNull()
    expect(nextRecurringFireAt({ frequency: "daily", time: "25:99" }, Date.now())).toBeNull()
  })
})

describe("buildNotificationSchedule", () => {
  const now = new Date(2025, 0, 15, 12, 0, 0)

  it("builds a one-shot schedule from an ISO fireAt", () => {
    const schedule = buildNotificationSchedule(
      {
        title: "Ping me",
        body: "Body",
        frequency: "once",
        fireAt: "2025-01-20T09:00:00.000Z",
        category: "agent",
        href: "/app/agent/run_1",
      },
      now,
    )
    expect(schedule).not.toBeNull()
    expect(schedule?.frequency).toBe("once")
    expect(schedule?.fireAt).toBe("2025-01-20T09:00:00.000Z")
    expect(schedule?.category).toBe("agent")
    expect(schedule?.id).toMatch(/^sch_/)
  })

  it("rejects a one-shot without a parseable fireAt", () => {
    expect(buildNotificationSchedule({ title: "x", frequency: "once" }, now)).toBeNull()
    expect(
      buildNotificationSchedule({ title: "x", frequency: "once", fireAt: "junk" }, now),
    ).toBeNull()
  })

  it("rejects an empty title", () => {
    expect(
      buildNotificationSchedule(
        { title: "   ", frequency: "once", fireAt: "2025-01-20T09:00:00Z" },
        now,
      ),
    ).toBeNull()
  })

  it("builds a daily schedule anchored to the next occurrence", () => {
    const schedule = buildNotificationSchedule(
      { title: "Standup", frequency: "daily", time: "09:00" },
      now,
    )
    expect(schedule?.frequency).toBe("daily")
    expect(schedule?.time).toBe("09:00")
    // Now is 12:00 → next 09:00 is tomorrow.
    expect(schedule?.fireAt).toBe(new Date(2025, 0, 16, 9, 0).toISOString())
  })

  it("builds a weekly schedule preserving the anchor weekday", () => {
    // Anchor on a Friday (Jan 17 2025); weekly fires Fridays at 09:00 local.
    // Build the ISO from local time so the weekday is timezone-independent.
    const fridayAnchor = new Date(2025, 0, 17, 9, 0).toISOString()
    const schedule = buildNotificationSchedule(
      {
        title: "Weekly review",
        frequency: "weekly",
        fireAt: fridayAnchor,
        time: "09:00",
      },
      now,
    )
    expect(schedule?.weekday).toBe(5)
    expect(schedule?.fireAt).toBe(fridayAnchor)
  })

  it("honors an explicit weekday for weekly schedules", () => {
    const schedule = buildNotificationSchedule(
      {
        title: "Monday standup",
        frequency: "weekly",
        time: "09:00",
        weekday: 1, // Monday
      },
      now, // Wednesday Jan 15 2025 → next Monday is Jan 20
    )
    expect(schedule?.weekday).toBe(1)
    expect(schedule?.fireAt).toBe(new Date(2025, 0, 20, 9, 0).toISOString())
  })

  it("ignores an out-of-range weekday and drops unsafe hrefs", () => {
    const schedule = buildNotificationSchedule(
      {
        title: "Ping",
        frequency: "weekly",
        time: "09:00",
        weekday: 9,
        href: "javascript:alert(1)",
      },
      now,
    )
    // Invalid weekday falls back to the anchor's day (Wednesday = 3).
    expect(schedule?.weekday).toBe(3)
    expect(schedule?.href).toBeUndefined()
  })
})

describe("advanceNotificationSchedule", () => {
  it("removes one-shot schedules after firing", () => {
    const schedules = [validSchedule()]
    expect(advanceNotificationSchedule(schedules, "sch_test_1", Date.now())).toEqual([])
  })

  it("advances recurring schedules to the next occurrence", () => {
    const schedule = validSchedule({
      frequency: "daily",
      time: "09:00",
      fireAt: "2025-01-16T09:00:00.000Z",
    })
    const firedAt = new Date(2025, 0, 16, 9, 0).getTime()
    const next = advanceNotificationSchedule([schedule], "sch_test_1", firedAt)
    expect(next).toHaveLength(1)
    expect(next[0].fireAt).toBe(new Date(2025, 0, 17, 9, 0).toISOString())
    expect(next[0].lastFiredAt).toBe(new Date(firedAt).toISOString())
  })

  it("leaves unknown ids untouched", () => {
    const schedules = [validSchedule()]
    expect(advanceNotificationSchedule(schedules, "sch_missing", Date.now())).toEqual(schedules)
  })
})

describe("wallClockTimeOf", () => {
  it("formats local HH:MM", () => {
    expect(wallClockTimeOf(new Date(2025, 0, 15, 9, 5))).toBe("09:05")
    expect(wallClockTimeOf(new Date(2025, 0, 15, 23, 59))).toBe("23:59")
  })
})
