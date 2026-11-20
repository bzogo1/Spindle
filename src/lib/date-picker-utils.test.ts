import { describe, expect, it } from "vitest"

import {
  addDays,
  addMonths,
  buildDefaultPresets,
  endOfWeek,
  findTypeAheadIndex,
  getCalendarDays,
  getCalendarWeeks,
  getWeekdayLabels,
  isDayInRange,
  isRangeWithinConstraints,
  matchesTypeAhead,
  navigateCalendar,
  normalizeRange,
  parseDateInput,
  rangeSpanDays,
  resolvePreset,
  resolveRangeClick,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "./date-picker-utils"

function d(y: number, m: number, day: number): Date {
  return new Date(y, m, day)
}

describe("date-picker-utils", () => {
  describe("basic date math", () => {
    it("startOfDay strips the time", () => {
      const x = new Date(2025, 5, 10, 15, 30, 45)
      expect(startOfDay(x)).toEqual(d(2025, 5, 10))
    })

    it("addDays crosses month boundaries", () => {
      expect(addDays(d(2025, 0, 31), 1)).toEqual(d(2025, 1, 1))
      expect(addDays(d(2025, 2, 1), -1)).toEqual(d(2025, 1, 28))
    })

    it("addMonths clamps to the last day of the target month", () => {
      expect(addMonths(d(2025, 0, 31), 1)).toEqual(d(2025, 1, 28))
      expect(addMonths(d(2024, 0, 31), 1)).toEqual(d(2024, 1, 29))
    })

    it("startOfMonth/endOfMonth", () => {
      expect(startOfMonth(d(2025, 5, 17))).toEqual(d(2025, 5, 1))
    })
  })

  describe("weeks", () => {
    it("startOfWeek defaults to Sunday", () => {
      // 2025-06-11 is a Wednesday.
      expect(startOfWeek(d(2025, 5, 11))).toEqual(d(2025, 5, 8))
      expect(endOfWeek(d(2025, 5, 11))).toEqual(d(2025, 5, 14))
    })

    it("startOfWeek respects firstDayOfWeek", () => {
      // Monday-first: Wed Jun 11 -> Mon Jun 9, week ends Sun Jun 15.
      expect(startOfWeek(d(2025, 5, 11), 1)).toEqual(d(2025, 5, 9))
      expect(endOfWeek(d(2025, 5, 11), 1)).toEqual(d(2025, 5, 15))
      // Saturday-first: -> Sat Jun 7.
      expect(startOfWeek(d(2025, 5, 11), 6)).toEqual(d(2025, 5, 7))
    })

    it("getCalendarDays returns 42 days starting on firstDayOfWeek", () => {
      const days = getCalendarDays(d(2025, 5, 15), 1)
      expect(days).toHaveLength(42)
      // June 2025 starts on a Sunday; Monday-first grid starts Mon May 26.
      expect(days[0]).toEqual(d(2025, 4, 26))
      expect(days[0].getDay()).toBe(1)
    })

    it("getCalendarWeeks groups into 6 rows of 7", () => {
      const weeks = getCalendarWeeks(d(2025, 5, 15))
      expect(weeks).toHaveLength(6)
      expect(weeks.every((w) => w.length === 7)).toBe(true)
    })

    it("getWeekdayLabels starts at firstDayOfWeek", () => {
      const labels = getWeekdayLabels("en-US", 1)
      expect(labels[0]).toBe("Mon")
      expect(labels).toHaveLength(7)
    })
  })

  describe("range logic", () => {
    it("resolveRangeClick starts a new range when empty or complete", () => {
      expect(resolveRangeClick({}, d(2025, 5, 10))).toEqual({
        from: d(2025, 5, 10),
        to: undefined,
      })
      expect(resolveRangeClick({ from: d(2025, 5, 1), to: d(2025, 5, 5) }, d(2025, 5, 10))).toEqual(
        { from: d(2025, 5, 10), to: undefined },
      )
    })

    it("resolveRangeClick completes and swaps reversed picks", () => {
      const range = { from: d(2025, 5, 10) }
      expect(resolveRangeClick(range, d(2025, 5, 15))).toEqual({
        from: d(2025, 5, 10),
        to: d(2025, 5, 15),
      })
      // Clicking before `from` produces a normalized range.
      expect(resolveRangeClick(range, d(2025, 5, 3))).toEqual({
        from: d(2025, 5, 3),
        to: d(2025, 5, 10),
      })
    })

    it("normalizeRange swaps reversed endpoints and strips time", () => {
      const a = new Date(2025, 5, 10, 18, 0)
      const b = new Date(2025, 5, 3, 9, 0)
      expect(normalizeRange({ from: a, to: b })).toEqual({
        from: d(2025, 5, 3),
        to: d(2025, 5, 10),
      })
    })

    it("isDayInRange is inclusive and handles partial ranges", () => {
      const range = { from: d(2025, 5, 10), to: d(2025, 5, 15) }
      expect(isDayInRange(d(2025, 5, 10), range)).toBe(true)
      expect(isDayInRange(d(2025, 5, 15), range)).toBe(true)
      expect(isDayInRange(d(2025, 5, 12), range)).toBe(true)
      expect(isDayInRange(d(2025, 5, 16), range)).toBe(false)
      expect(isDayInRange(d(2025, 5, 10), { from: d(2025, 5, 10) })).toBe(true)
      expect(isDayInRange(d(2025, 5, 11), { from: d(2025, 5, 10) })).toBe(false)
    })

    it("rangeSpanDays measures the inclusive endpoints", () => {
      expect(rangeSpanDays({ from: d(2025, 5, 10), to: d(2025, 5, 15) })).toBe(5)
      expect(rangeSpanDays({ from: d(2025, 5, 10) })).toBeUndefined()
    })

    it("isRangeWithinConstraints enforces min/max span", () => {
      const range = { from: d(2025, 5, 10), to: d(2025, 5, 15) } // span 5
      expect(isRangeWithinConstraints(range, {})).toBe(true)
      expect(isRangeWithinConstraints(range, { minRangeDays: 5 })).toBe(true)
      expect(isRangeWithinConstraints(range, { minRangeDays: 6 })).toBe(false)
      expect(isRangeWithinConstraints(range, { maxRangeDays: 5 })).toBe(true)
      expect(isRangeWithinConstraints(range, { maxRangeDays: 4 })).toBe(false)
      // Incomplete ranges are always "valid" (still being picked).
      expect(isRangeWithinConstraints({ from: d(2025, 5, 10) }, { maxRangeDays: 0 })).toBe(true)
    })
  })

  describe("presets", () => {
    it("buildDefaultPresets produces five labeled presets", () => {
      const presets = buildDefaultPresets()
      expect(presets.map((p) => p.label)).toEqual([
        "Today",
        "Yesterday",
        "Last 7 days",
        "Last 30 days",
        "This month",
      ])
    })

    it("buildDefaultPresets uses custom i18n labels", () => {
      const presets = buildDefaultPresets({
        today: "Aujourd'hui",
        yesterday: "Hier",
        last7Days: "7 derniers jours",
        last30Days: "30 derniers jours",
        thisMonth: "Ce mois-ci",
      })
      expect(presets.map((p) => p.label)).toEqual([
        "Aujourd'hui",
        "Hier",
        "7 derniers jours",
        "30 derniers jours",
        "Ce mois-ci",
      ])
    })

    it("resolvePreset invokes function presets", () => {
      const range = { from: d(2025, 0, 1), to: d(2025, 0, 31) }
      expect(resolvePreset({ label: "x", range: () => range })).toEqual(range)
      expect(resolvePreset({ label: "x", range })).toEqual(range)
    })
  })

  describe("keyboard navigation", () => {
    const state = { activeDate: d(2025, 5, 11), viewMonth: d(2025, 5, 1) } // Wed Jun 11 2025

    it("ArrowRight/ArrowLeft move by one day", () => {
      expect(navigateCalendar(state, "ArrowRight")).toMatchObject({
        activeDate: d(2025, 5, 12),
      })
      expect(navigateCalendar(state, "ArrowLeft")).toMatchObject({
        activeDate: d(2025, 5, 10),
      })
    })

    it("flips ArrowLeft/ArrowRight in RTL", () => {
      const rtl = { rtl: true }
      expect(navigateCalendar(state, "ArrowLeft", rtl)).toMatchObject({
        activeDate: d(2025, 5, 12),
      })
      expect(navigateCalendar(state, "ArrowRight", rtl)).toMatchObject({
        activeDate: d(2025, 5, 10),
      })
      // Vertical arrows are unaffected.
      expect(navigateCalendar(state, "ArrowDown", rtl)).toMatchObject({
        activeDate: d(2025, 5, 18),
      })
    })

    it("ArrowUp/ArrowDown move by a week", () => {
      expect(navigateCalendar(state, "ArrowUp")).toMatchObject({
        activeDate: d(2025, 5, 4),
      })
      expect(navigateCalendar(state, "ArrowDown")).toMatchObject({
        activeDate: d(2025, 5, 18),
      })
    })

    it("PageUp/PageDown move by month; Shift moves by year", () => {
      expect(navigateCalendar(state, "PageDown")).toMatchObject({
        activeDate: d(2025, 6, 11),
        viewMonth: d(2025, 6, 1),
      })
      expect(navigateCalendar(state, "PageUp", { shiftKey: true })).toMatchObject({
        activeDate: d(2024, 5, 11),
      })
    })

    it("Home/End move to week boundaries honoring firstDayOfWeek", () => {
      // Sunday-first: Wed Jun 11 -> Sun Jun 8 / Sat Jun 14.
      expect(navigateCalendar(state, "Home")).toMatchObject({ activeDate: d(2025, 5, 8) })
      expect(navigateCalendar(state, "End")).toMatchObject({ activeDate: d(2025, 5, 14) })
      // Monday-first: -> Mon Jun 9 / Sun Jun 15.
      expect(navigateCalendar(state, "Home", { firstDayOfWeek: 1 })).toMatchObject({
        activeDate: d(2025, 5, 9),
      })
      expect(navigateCalendar(state, "End", { firstDayOfWeek: 1 })).toMatchObject({
        activeDate: d(2025, 5, 15),
      })
    })

    it("skips disabled days when moving", () => {
      const blocked = new Set([dayKeyLocal(d(2025, 5, 12))])
      const isDisabled = (x: Date) => blocked.has(dayKeyLocal(x))
      const next = navigateCalendar(state, "ArrowRight", { isDisabled })
      expect(next?.activeDate).toEqual(d(2025, 5, 13))
    })

    it("returns null for unhandled keys", () => {
      expect(navigateCalendar(state, "a")).toBeNull()
      expect(navigateCalendar(state, "Tab")).toBeNull()
    })
  })

  describe("type-ahead", () => {
    it("matchesTypeAhead matches day numbers and label prefixes", () => {
      const day = d(2025, 5, 15)
      const candidates = ["Sun, Jun 15, 2025", "June"]
      expect(matchesTypeAhead("15", day, candidates)).toBe(true)
      expect(matchesTypeAhead("jun", day, candidates)).toBe(true)
      expect(matchesTypeAhead("sun", day, candidates)).toBe(true)
      expect(matchesTypeAhead("ju", day, candidates)).toBe(true)
      expect(matchesTypeAhead("16", day, candidates)).toBe(false)
      expect(matchesTypeAhead("", day, candidates)).toBe(false)
      // Single-string form still works.
      expect(matchesTypeAhead("sun", day, "Sun, Jun 15, 2025")).toBe(true)
    })

    it("findTypeAheadIndex scans cyclically after the start index", () => {
      const days = [d(2025, 5, 10), d(2025, 5, 11), d(2025, 5, 12)]
      const candidates = days.map((x) => [`Jun ${x.getDate()}, 2025`, "June"])
      // Searching "12" from index 0 wraps forward to index 2.
      expect(findTypeAheadIndex("12", days, candidates, 0)).toBe(2)
      expect(findTypeAheadIndex("10", days, candidates, 0)).toBe(0) // wraps around
      expect(findTypeAheadIndex("99", days, candidates, 0)).toBe(-1)
    })
  })

  describe("parseDateInput", () => {
    it("parses ISO dates", () => {
      expect(parseDateInput("2025-06-15")).toEqual(d(2025, 5, 15))
      expect(parseDateInput("2025-6-5")).toEqual(d(2025, 5, 5))
    })

    it("parses Date.parse-compatible strings", () => {
      expect(parseDateInput("Jun 15, 2025")).toEqual(d(2025, 5, 15))
    })

    it("returns undefined for garbage and empty input", () => {
      expect(parseDateInput("")).toBeUndefined()
      expect(parseDateInput("   ")).toBeUndefined()
      expect(parseDateInput("not a date")).toBeUndefined()
    })
  })
})

function dayKeyLocal(date: Date): string {
  const s = startOfDay(date)
  return `${s.getFullYear()}-${s.getMonth()}-${s.getDate()}`
}
