import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { TimezoneIndicator } from "./timezone-indicator"

afterEach(() => {
  vi.useRealTimers()
})

describe("TimezoneIndicator", () => {
  it("renders the zone, time, and UTC offset", () => {
    const { container } = render(<TimezoneIndicator zone="Europe/Kyiv" locale="en-GB" />)

    const time = container.querySelector("time.app-timezone-indicator")
    expect(time).not.toBeNull()
    expect(time).toHaveAttribute("dateTime")

    expect(screen.getByText("Europe/Kyiv")).toBeInTheDocument()
    // Kyiv is always UTC+2 or UTC+3 depending on DST.
    expect(time).toHaveTextContent(/UTC[+-]\d(:\d{2})?/)
    expect(time).toHaveTextContent(/\d{2}:\d{2}/)
    expect(time).toHaveAccessibleName(/Local time .* in Europe\/Kyiv/)
  })

  it("falls back gracefully for an invalid zone", () => {
    const { container } = render(<TimezoneIndicator zone="Not/AZone" />)
    const time = container.querySelector("time.app-timezone-indicator")
    expect(time).not.toBeNull()
    expect(time?.textContent).not.toContain("Not/AZone")
  })

  it("uses the detected zone when no override is given", () => {
    const { container } = render(<TimezoneIndicator />)
    const time = container.querySelector("time.app-timezone-indicator")
    expect(time).not.toBeNull()
    expect(time?.textContent).toMatch(/UTC[+-]?\d*(:\d{2})?/)
  })

  it("refreshes on the configured interval", () => {
    vi.useFakeTimers()
    const setIntervalSpy = vi.spyOn(window, "setInterval")

    render(<TimezoneIndicator zone="UTC" updateIntervalMs={5000} />)

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5000)
  })
})
