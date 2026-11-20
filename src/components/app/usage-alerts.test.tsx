import { act, render, renderHook, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it } from "vitest"

import type { UsageSummary } from "@/lib/api/types"

import {
  USAGE_ALERTS_STORAGE_KEY,
  UsageAlertsPanel,
  defaultUsageAlerts,
  evaluateUsageAlert,
  sanitizeUsageAlerts,
  useUsageAlerts,
} from "./usage-alerts"

const usageFixture: UsageSummary = {
  periodStart: "2026-11-01T00:00:00.000Z",
  periodEnd: "2026-11-30T23:59:59.000Z",
  requests: 100,
  tokens: 5000,
  costUsd: 1.5,
  daily: [],
}

function clearStoredAlerts() {
  window.localStorage.removeItem(USAGE_ALERTS_STORAGE_KEY)
}

beforeEach(clearStoredAlerts)

describe("sanitizeUsageAlerts", () => {
  it("returns the defaults for non-object payloads", () => {
    expect(sanitizeUsageAlerts(null)).toEqual(defaultUsageAlerts())
    expect(sanitizeUsageAlerts("nope")).toEqual(defaultUsageAlerts())
    expect(sanitizeUsageAlerts(42)).toEqual(defaultUsageAlerts())
  })

  it("keeps valid thresholds and drops invalid ones", () => {
    expect(
      sanitizeUsageAlerts({ requests: 500, tokens: 0, costUsd: -3, extra: "ignored" }),
    ).toEqual({ requests: 500, tokens: null, costUsd: null })
    expect(sanitizeUsageAlerts({ requests: "500", tokens: Number.NaN })).toEqual(
      defaultUsageAlerts(),
    )
  })
})

describe("evaluateUsageAlert", () => {
  it("is off without a threshold", () => {
    expect(evaluateUsageAlert(9999, null)).toEqual({ status: "off", percent: 0 })
  })

  it("flags ok, warning, and exceeded around the 80%/100% marks", () => {
    expect(evaluateUsageAlert(50, 100).status).toBe("ok")
    expect(evaluateUsageAlert(80, 100).status).toBe("warning")
    expect(evaluateUsageAlert(100, 100).status).toBe("exceeded")
    expect(evaluateUsageAlert(150, 100)).toEqual({ status: "exceeded", percent: 150 })
  })
})

describe("useUsageAlerts", () => {
  it("starts at the defaults and persists threshold changes", () => {
    const { result } = renderHook(() => useUsageAlerts())

    expect(result.current.thresholds).toEqual(defaultUsageAlerts())

    act(() => {
      result.current.setThreshold("requests", 500)
    })

    expect(result.current.thresholds.requests).toBe(500)
    const stored = JSON.parse(window.localStorage.getItem(USAGE_ALERTS_STORAGE_KEY) ?? "{}")
    expect(stored.requests).toBe(500)

    act(() => {
      result.current.setThreshold("requests", 0)
    })
    expect(result.current.thresholds.requests).toBeNull()
  })

  it("restores a stored config on mount and resets to defaults", () => {
    window.localStorage.setItem(
      USAGE_ALERTS_STORAGE_KEY,
      JSON.stringify({ requests: 500, tokens: 10000 }),
    )

    const { result } = renderHook(() => useUsageAlerts())

    expect(result.current.thresholds).toEqual({ requests: 500, tokens: 10000, costUsd: null })

    act(() => {
      result.current.reset()
    })
    expect(result.current.thresholds).toEqual(defaultUsageAlerts())
  })

  it("falls back to defaults for corrupt stored JSON", () => {
    window.localStorage.setItem(USAGE_ALERTS_STORAGE_KEY, "{not json")
    const { result } = renderHook(() => useUsageAlerts())
    expect(result.current.thresholds).toEqual(defaultUsageAlerts())
  })

  it("syncs threshold changes from other tabs via the storage event", () => {
    const { result } = renderHook(() => useUsageAlerts())

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: USAGE_ALERTS_STORAGE_KEY,
          newValue: JSON.stringify({ costUsd: 25 }),
        }),
      )
    })

    expect(result.current.thresholds.costUsd).toBe(25)

    // A removal in another tab resets to defaults.
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: USAGE_ALERTS_STORAGE_KEY, newValue: null }),
      )
    })
    expect(result.current.thresholds).toEqual(defaultUsageAlerts())

    // Corrupt payloads from other tabs are ignored.
    act(() => {
      result.current.setThreshold("tokens", 1000)
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: USAGE_ALERTS_STORAGE_KEY,
          newValue: "{broken",
        }),
      )
    })
    expect(result.current.thresholds.tokens).toBe(1000)
  })
})

describe("UsageAlertsPanel", () => {
  it("renders a threshold input per metric, all off by default", () => {
    render(<UsageAlertsPanel usage={usageFixture} />)

    expect(screen.getByRole("heading", { name: "Usage alerts" })).toBeInTheDocument()
    expect(screen.getByLabelText("Alert threshold (requests)")).toBeInTheDocument()
    expect(screen.getByLabelText("Alert threshold (tokens)")).toBeInTheDocument()
    expect(screen.getByLabelText("Alert threshold (USD)")).toBeInTheDocument()
    expect(screen.getAllByText("Off")).toHaveLength(3)
    expect(screen.getByRole("button", { name: "Reset" })).toBeDisabled()
  })

  it("flags exceeded metrics with a badge and an inline error banner", async () => {
    window.localStorage.setItem(
      USAGE_ALERTS_STORAGE_KEY,
      JSON.stringify({ requests: 50, tokens: null, costUsd: 2 }),
    )

    render(<UsageAlertsPanel usage={usageFixture} />)

    // Requests: 100 / 50 = 200% -> exceeded. Cost: 1.5 / 2 = 75% -> ok.
    expect(await screen.findByText("Exceeded")).toBeInTheDocument()
    expect(screen.getByText("Usage threshold exceeded")).toBeInTheDocument()
    expect(screen.getByText("Within limit")).toBeInTheDocument()
  })

  it("persists a threshold typed into the input", async () => {
    const user = userEvent.setup()
    render(<UsageAlertsPanel usage={usageFixture} />)

    const input = screen.getByLabelText("Alert threshold (requests)")
    await user.type(input, "500")

    const stored = JSON.parse(window.localStorage.getItem(USAGE_ALERTS_STORAGE_KEY) ?? "{}")
    expect(stored.requests).toBe(500)
    expect(await screen.findByText("Within limit")).toBeInTheDocument()
  })

  it("accepts a decimal threshold typed with a leading zero", async () => {
    const user = userEvent.setup()
    render(<UsageAlertsPanel usage={usageFixture} />)

    const input = screen.getByLabelText("Alert threshold (USD)")
    await user.type(input, "0.50")

    // Intermediate keystrokes ("0", "0.") must not wipe the in-progress entry.
    expect(input).toHaveValue("0.50")
    const stored = JSON.parse(window.localStorage.getItem(USAGE_ALERTS_STORAGE_KEY) ?? "{}")
    expect(stored.costUsd).toBe(0.5)
  })

  it("clears thresholds via the reset button", async () => {
    const user = userEvent.setup()
    window.localStorage.setItem(USAGE_ALERTS_STORAGE_KEY, JSON.stringify({ requests: 500 }))
    render(<UsageAlertsPanel usage={usageFixture} />)

    const reset = screen.getByRole("button", { name: "Reset" })
    expect(await screen.findByText("Within limit")).toBeInTheDocument()
    await user.click(reset)

    expect(screen.getAllByText("Off")).toHaveLength(3)
    expect(JSON.parse(window.localStorage.getItem(USAGE_ALERTS_STORAGE_KEY) ?? "{}")).toEqual({
      requests: null,
      tokens: null,
      costUsd: null,
    })
  })
})
