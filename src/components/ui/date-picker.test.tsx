import * as React from "react"
import { fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { DatePicker } from "./date-picker"

function startOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date: Date, days: number): Date {
  const d = startOfDay(date)
  d.setDate(d.getDate() + days)
  return d
}

function dayButton(day: Date): HTMLElement {
  // Day buttons are labelled with the full weekday date, e.g. "Tuesday, June 10, 2025".
  return screen.getByRole("button", {
    name: new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(day),
  })
}

function openPicker(user: ReturnType<typeof userEvent.setup>) {
  return user.click(screen.getByRole("button", { name: /pick a date/i }))
}

describe("DatePicker", () => {
  it("renders a trigger with the placeholder", () => {
    render(<DatePicker />)
    expect(screen.getByRole("button", { name: /pick a date/i })).toBeInTheDocument()
  })

  it("opens a calendar grid and selects a single date", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<DatePicker onChange={onChange} />)

    await openPicker(user)
    const grid = await screen.findByRole("grid")
    expect(grid).toBeInTheDocument()
    expect(grid).toHaveAttribute("aria-label", "Choose date")

    const target = addDays(new Date(), 5)
    await user.click(dayButton(target))

    expect(onChange).toHaveBeenCalledTimes(1)
    const value = onChange.mock.calls[0][0] as Date
    expect(value).toBeInstanceOf(Date)
    expect(startOfDay(value).getTime()).toBe(startOfDay(target).getTime())
  })

  it("shows the selected value on the trigger", async () => {
    const user = userEvent.setup()
    const selected = addDays(new Date(), -3)
    render(<DatePicker value={selected} />)
    expect(screen.getByRole("button")).toHaveTextContent(
      new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(selected),
    )
    // The trigger shows the formatted date, not the placeholder.
    await user.click(screen.getByRole("button"))
    const btn = dayButton(selected)
    expect(btn).toHaveAttribute("aria-pressed", "true")
  })

  it("selects a range with two clicks", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<DatePicker mode="range" onChange={onChange} />)

    await user.click(screen.getByRole("button", { name: /pick a date range/i }))
    await screen.findByRole("grid")

    const from = addDays(new Date(), -10)
    const to = addDays(new Date(), -4)
    await user.click(dayButton(from))
    // First click emits a partial range and keeps the popover open.
    expect(onChange).toHaveBeenLastCalledWith({ from: startOfDay(from), to: undefined })
    await user.click(dayButton(to))

    expect(onChange).toHaveBeenLastCalledWith({
      from: startOfDay(from),
      to: startOfDay(to),
    })
  })

  it("applies default range presets", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<DatePicker mode="range" onChange={onChange} />)

    await user.click(screen.getByRole("button", { name: /pick a date range/i }))
    await screen.findByRole("grid")

    await user.click(screen.getByRole("button", { name: "Last 7 days" }))

    const today = startOfDay(new Date())
    const call = onChange.mock.calls.at(-1)?.[0] as { from: Date; to: Date }
    expect(startOfDay(call.from).getTime()).toBe(addDays(today, -6).getTime())
    expect(startOfDay(call.to).getTime()).toBe(today.getTime())
  })

  it("supports custom presets", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const custom = new Date(2025, 0, 15)
    render(
      <DatePicker
        mode="range"
        presets={[{ label: "Custom window", range: { from: custom, to: custom } }]}
        onChange={onChange}
      />,
    )
    await user.click(screen.getByRole("button", { name: /pick a date range/i }))
    await screen.findByRole("grid")
    await user.click(screen.getByRole("button", { name: "Custom window" }))
    expect(onChange).toHaveBeenCalledWith({ from: custom, to: custom })
  })

  it("navigates with the keyboard and selects with Enter", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<DatePicker onChange={onChange} />)
    await openPicker(user)

    const grid = await screen.findByRole("grid")
    fireEvent.keyDown(grid, { key: "ArrowRight" })
    fireEvent.keyDown(grid, { key: "Enter" })

    const today = startOfDay(new Date())
    const value = onChange.mock.calls[0][0] as Date
    expect(startOfDay(value).getTime()).toBe(addDays(today, 1).getTime())
  })

  it("moves between months with PageUp/PageDown", async () => {
    const user = userEvent.setup()
    render(<DatePicker />)
    await openPicker(user)
    const grid = await screen.findByRole("grid")

    const monthSelect = screen.getByLabelText("Month") as HTMLSelectElement
    const yearSelect = screen.getByLabelText("Year") as HTMLSelectElement
    const initialMonth = Number(monthSelect.value)
    const initialYear = Number(yearSelect.value)

    fireEvent.keyDown(grid, { key: "PageDown" })
    const next = new Date(initialYear, initialMonth + 1, 1)
    expect(Number(monthSelect.value)).toBe(next.getMonth())
    expect(Number(yearSelect.value)).toBe(next.getFullYear())

    fireEvent.keyDown(grid, { key: "PageUp", shiftKey: true })
    expect(Number(yearSelect.value)).toBe(initialYear - 1)
  })

  it("closes on Escape", async () => {
    const user = userEvent.setup()
    render(<DatePicker />)
    await openPicker(user)
    await screen.findByRole("grid")

    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.queryByRole("grid")).not.toBeInTheDocument()
  })

  it("respects minDate/maxDate and disabledDates", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const today = startOfDay(new Date())
    const blocked = addDays(today, 3)
    render(<DatePicker maxDate={addDays(today, 2)} disabledDates={[blocked]} onChange={onChange} />)
    await openPicker(user)
    await screen.findByRole("grid")

    const beyondMax = dayButton(addDays(today, 5))
    expect(beyondMax).toBeDisabled()

    await user.click(dayButton(blocked))
    expect(onChange).not.toHaveBeenCalled()

    await user.click(dayButton(addDays(today, 1)))
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it("marks today with aria-current and the grid with active descendant", async () => {
    const user = userEvent.setup()
    render(<DatePicker />)
    await openPicker(user)
    const grid = await screen.findByRole("grid")
    const today = startOfDay(new Date())
    const todayBtn = dayButton(today)
    expect(todayBtn).toHaveAttribute("aria-current", "date")
    expect(grid).toHaveAttribute("aria-activedescendant", todayBtn.id || expect.any(String))
  })

  it("range mode shows preset sidebar and highlights in-range days", async () => {
    const user = userEvent.setup()
    const { container } = render(<DatePicker mode="range" />)
    void container
    await user.click(screen.getByRole("button", { name: /pick a date range/i }))
    const presets = await screen.findByText("This month")
    expect(within(document.body).getByText("Yesterday")).toBeInTheDocument()
    expect(presets).toBeInTheDocument()
  })

  it("moves to week start/end with Home/End", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<DatePicker onChange={onChange} />)
    await openPicker(user)
    const grid = await screen.findByRole("grid")

    // Home -> Sunday of the current week (firstDayOfWeek defaults to 0).
    fireEvent.keyDown(grid, { key: "Home" })
    const today = startOfDay(new Date())
    const expectedSunday = addDays(today, -today.getDay())
    expect(grid).toHaveAttribute(
      "aria-activedescendant",
      `dp-day-${expectedSunday.getFullYear()}-${String(expectedSunday.getMonth() + 1).padStart(2, "0")}-${String(expectedSunday.getDate()).padStart(2, "0")}`,
    )

    fireEvent.keyDown(grid, { key: "End" })
    const expectedSaturday = addDays(expectedSunday, 6)
    expect(grid).toHaveAttribute(
      "aria-activedescendant",
      `dp-day-${expectedSaturday.getFullYear()}-${String(expectedSaturday.getMonth() + 1).padStart(2, "0")}-${String(expectedSaturday.getDate()).padStart(2, "0")}`,
    )

    // Enter selects the Saturday.
    fireEvent.keyDown(grid, { key: "Enter" })
    const value = onChange.mock.calls[0][0] as Date
    expect(startOfDay(value).getTime()).toBe(expectedSaturday.getTime())
  })

  it("flips ArrowLeft/ArrowRight in RTL mode", async () => {
    const user = userEvent.setup()
    render(<DatePicker dir="rtl" />)
    await openPicker(user)
    const grid = await screen.findByRole("grid")

    const today = startOfDay(new Date())
    const tomorrow = addDays(today, 1)
    const idFor = (d: Date) =>
      `dp-day-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

    // In RTL, ArrowLeft moves forward in time (visually left = later).
    fireEvent.keyDown(grid, { key: "ArrowLeft" })
    expect(grid).toHaveAttribute("aria-activedescendant", idFor(tomorrow))
    fireEvent.keyDown(grid, { key: "ArrowRight" })
    expect(grid).toHaveAttribute("aria-activedescendant", idFor(today))
  })

  it("honors firstDayOfWeek for the weekday header", async () => {
    const user = userEvent.setup()
    render(<DatePicker firstDayOfWeek={1} locale="en-US" />)
    await openPicker(user)
    await screen.findByRole("grid")
    const headers = screen.getAllByRole("columnheader")
    expect(headers[0]).toHaveTextContent("Mon")
    expect(headers[6]).toHaveTextContent("Sun")
  })

  it("localizes month names via the locale prop", async () => {
    const user = userEvent.setup()
    render(<DatePicker locale="de" labels={{ month: "Monat", year: "Jahr" }} />)
    await openPicker(user)
    await screen.findByRole("grid")
    expect(screen.getByLabelText("Monat")).toBeInTheDocument()
    const monthSelect = screen.getByLabelText("Monat") as HTMLSelectElement
    const labels = Array.from(monthSelect.options).map((o) => o.text)
    // German month names include "Januar", "Februar", etc.
    expect(labels).toContain("Januar")
  })

  it("localizes preset labels via the labels prop", async () => {
    const user = userEvent.setup()
    render(
      <DatePicker
        mode="range"
        labels={{ today: "Aujourd'hui", yesterday: "Hier", last7Days: "7 derniers jours" }}
      />,
    )
    await user.click(screen.getByRole("button", { name: /pick a date range/i }))
    await screen.findByRole("grid")
    expect(screen.getByRole("button", { name: "Aujourd'hui" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Hier" })).toBeInTheDocument()
  })

  it("shows a hover preview while picking a range", async () => {
    const user = userEvent.setup()
    render(<DatePicker mode="range" />)
    await user.click(screen.getByRole("button", { name: /pick a date range/i }))
    await screen.findByRole("grid")

    const from = addDays(new Date(), -10)
    const to = addDays(new Date(), -4)
    await user.click(dayButton(from))
    fireEvent.mouseEnter(dayButton(to))

    const previewed = document.querySelectorAll("[data-preview]")
    expect(previewed.length).toBeGreaterThan(0)
    // The `from` endpoint keeps its committed range-start styling.
    expect(dayButton(from)).not.toHaveAttribute("data-preview")
  })

  it("supports editing the range via start/end inputs", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<DatePicker mode="range" onChange={onChange} />)
    await user.click(screen.getByRole("button", { name: /pick a date range/i }))
    await screen.findByRole("grid")

    const from = screen.getByLabelText("Start date")
    const to = screen.getByLabelText("End date")
    fireEvent.change(from, { target: { value: "2025-06-10" } })
    fireEvent.blur(from)
    fireEvent.change(to, { target: { value: "2025-06-20" } })
    fireEvent.blur(to)

    const last = onChange.mock.calls.at(-1)?.[0] as { from: Date; to: Date }
    expect(last.from).toEqual(startOfDay(new Date(2025, 5, 10)))
    expect(last.to).toEqual(startOfDay(new Date(2025, 5, 20)))
  })

  it("rejects ranges that violate maxRangeDays", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<DatePicker mode="range" maxRangeDays={3} onChange={onChange} />)
    await user.click(screen.getByRole("button", { name: /pick a date range/i }))
    await screen.findByRole("grid")

    const from = addDays(new Date(), -10)
    const to = addDays(new Date(), -1) // span 9 > 3
    await user.click(dayButton(from))
    await user.click(dayButton(to))

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid date range")
    // The completed range was not emitted; the picker stays open.
    const last = onChange.mock.calls.at(-1)?.[0] as { from: Date; to?: Date }
    expect(last.to).toBeUndefined()
    expect(screen.getByRole("grid")).toBeInTheDocument()
  })

  it("disables days inside disabledRanges", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const today = startOfDay(new Date())
    render(
      <DatePicker
        disabledRanges={[{ from: addDays(today, 1), to: addDays(today, 3) }]}
        onChange={onChange}
      />,
    )
    await openPicker(user)
    await screen.findByRole("grid")

    expect(dayButton(addDays(today, 2))).toBeDisabled()
    await user.click(dayButton(addDays(today, 2)))
    expect(onChange).not.toHaveBeenCalled()
  })

  it("jumps to a matching day with type-ahead", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<DatePicker onChange={onChange} />)
    await openPicker(user)
    const grid = await screen.findByRole("grid")

    // Type "2" then Enter: selects the 2nd of the visible month cycle.
    fireEvent.keyDown(grid, { key: "2" })
    fireEvent.keyDown(grid, { key: "Enter" })
    const value = onChange.mock.calls[0][0] as Date
    expect(value.getDate()).toBe(2)
  })
})
