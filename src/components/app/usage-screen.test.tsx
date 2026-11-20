import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import type { UsageSummary } from "@/lib/api/types"

import { UsageScreen, usageExportCsv, usageExportJson, usageForecast } from "./usage-screen"

const usageFixture: UsageSummary = {
  periodStart: "2026-11-01T00:00:00.000Z",
  periodEnd: "2026-11-30T23:59:59.000Z",
  requests: 10,
  tokens: 2000,
  costUsd: 0.5,
  daily: [
    { date: "2026-11-01T00:00:00.000Z", requests: 4, tokens: 800, costUsd: 0.2 },
    { date: "2026-11-02T00:00:00.000Z", requests: 6, tokens: 1200, costUsd: 0.3 },
  ],
  projects: [
    {
      projectId: "prj_01",
      projectName: "Coastal Resilience",
      requests: 7,
      tokens: 1400,
      costUsd: 0.35,
    },
    {
      projectId: "prj_02",
      projectName: "Tide Model Archive",
      requests: 3,
      tokens: 600,
      costUsd: 0.15,
    },
  ],
}

describe("usageForecast", () => {
  // Mid-period: Nov 10 of a Nov 1–30 period → 10 elapsed of 30 days.
  const now = new Date("2026-11-10T12:00:00.000Z")

  it("projects period totals from the daily run-rate", () => {
    const forecast = usageForecast(usageFixture, now)

    // Fixture daily points (Nov 1: 4 req, Nov 2: 6 req) both fall inside the
    // elapsed window; 10 observed requests over 10 days pace out to 30.
    expect(forecast).toMatchObject({ periodDays: 30, elapsedDays: 10 })
    expect(forecast?.requestsPerDay).toBe(1)
    expect(forecast?.requests).toBe(30)
    expect(forecast?.tokens).toBe(6000)
    expect(forecast?.costUsd).toBe(1.5)
    // Per-project figures take each project's share of the period totals
    // applied to the daily projection — here the fixture totals equal the
    // observed daily sums, so the shares reproduce the ×3 run-rate.
    expect(forecast?.projects).toEqual([
      {
        projectId: "prj_01",
        projectName: "Coastal Resilience",
        requests: 21,
        tokens: 4200,
        costUsd: 1.05,
      },
      {
        projectId: "prj_02",
        projectName: "Tide Model Archive",
        requests: 9,
        tokens: 1800,
        costUsd: 0.45,
      },
    ])
  })

  it("projects per-project figures on the same observed-days basis as the daily forecast", () => {
    // Project and period totals cover the whole billing period, while the
    // daily series only sums days ≤ now. Scaling raw project totals by the
    // pace factor would overstate mid-period; instead each project contributes
    // its share of the period totals to the daily-based projection.
    const wholePeriodTotals: UsageSummary = {
      ...usageFixture,
      requests: 30,
      tokens: 6000,
      costUsd: 1.5,
      projects: [
        {
          projectId: "prj_a",
          projectName: "Alpha",
          requests: 20,
          tokens: 4000,
          costUsd: 1,
        },
        {
          projectId: "prj_b",
          projectName: "Beta",
          requests: 10,
          tokens: 2000,
          costUsd: 0.5,
        },
      ],
    }
    const forecast = usageForecast(wholePeriodTotals, now)

    // Daily basis still forecasts 30 requests / 6000 tokens / $1.50.
    expect(forecast).toMatchObject({ requests: 30, tokens: 6000, costUsd: 1.5 })
    // Shares: Alpha 20/30 requests, Beta 10/30 → 20 and 10 forecast requests.
    // The naive whole-total × paceFactor would have produced 60 and 30.
    expect(forecast?.projects).toEqual([
      {
        projectId: "prj_a",
        projectName: "Alpha",
        requests: 20,
        tokens: 4000,
        costUsd: 1,
      },
      {
        projectId: "prj_b",
        projectName: "Beta",
        requests: 10,
        tokens: 2000,
        costUsd: 0.5,
      },
    ])
    // Project forecasts sum to the period forecast (shares total 100%).
    expect(forecast?.projects.reduce((sum, project) => sum + project.requests, 0)).toBe(
      forecast?.requests,
    )
  })

  it("ignores daily points dated after now", () => {
    const withFuturePoint: UsageSummary = {
      ...usageFixture,
      daily: [
        ...usageFixture.daily,
        { date: "2026-11-25T00:00:00.000Z", requests: 100, tokens: 100, costUsd: 1 },
      ],
    }
    const forecast = usageForecast(withFuturePoint, now)

    // The Nov 25 point is future-dated and must not enter the observed sums.
    expect(forecast?.requests).toBe(30)
    expect(forecast?.costUsd).toBe(1.5)
  })

  it("returns null before the period starts", () => {
    expect(usageForecast(usageFixture, new Date("2026-10-15T00:00:00.000Z"))).toBeNull()
  })

  it("returns null when the summary has no daily series", () => {
    expect(usageForecast({ ...usageFixture, daily: [] }, now)).toBeNull()
  })

  it("collapses to the observed totals once the period has ended", () => {
    const forecast = usageForecast(usageFixture, new Date("2026-12-05T00:00:00.000Z"))

    expect(forecast).toMatchObject({ periodDays: 30, elapsedDays: 30 })
    // Pace factor is 1 — the forecast is just the observed daily totals.
    expect(forecast?.requests).toBe(10)
    expect(forecast?.costUsd).toBe(0.5)
  })
})

describe("usageExportCsv", () => {
  it("includes the period totals and the daily series", () => {
    const csv = usageExportCsv(usageFixture)

    expect(csv).toContain('"metric","value"')
    expect(csv).toContain('"periodStart","2026-11-01T00:00:00.000Z"')
    expect(csv).toContain('"periodEnd","2026-11-30T23:59:59.000Z"')
    expect(csv).toContain('"requests","10"')
    expect(csv).toContain('"tokens","2000"')
    expect(csv).toContain('"costUsd","0.5"')
    expect(csv).toContain('"date","requests","tokens","costUsd"')
    expect(csv).toContain('"2026-11-01T00:00:00.000Z","4","800","0.2"')
    expect(csv).toContain('"2026-11-02T00:00:00.000Z","6","1200","0.3"')
    // Per-project block appended after the daily series.
    expect(csv).toContain('"projectId","projectName","requests","tokens","costUsd"')
    expect(csv).toContain('"prj_01","Coastal Resilience","7","1400","0.35"')
    expect(csv).toContain('"prj_02","Tide Model Archive","3","600","0.15"')
  })
})

describe("usageExportJson", () => {
  it("serializes the period totals and daily points", () => {
    expect(JSON.parse(usageExportJson(usageFixture))).toEqual({
      periodStart: "2026-11-01T00:00:00.000Z",
      periodEnd: "2026-11-30T23:59:59.000Z",
      totals: { requests: 10, tokens: 2000, costUsd: 0.5 },
      daily: usageFixture.daily,
      projects: usageFixture.projects,
    })
  })
})

describe("UsageScreen", () => {
  it("renders the plan card, usage meters, and billing history", async () => {
    render(<UsageScreen />)

    expect(screen.getByRole("heading", { name: "Usage & plan" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Current plan" })).toBeInTheDocument()
    expect(screen.getAllByText("Team").length).toBeGreaterThan(0)
    expect(screen.getByText("$12")).toBeInTheDocument()
    expect(screen.getByText("Near limit")).toBeInTheDocument()
    expect(screen.getByText("Limit reached")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "What's included" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Billing history" })).toBeInTheDocument()
    expect(screen.getAllByText("Team plan — 3 seats").length).toBeGreaterThan(0)
    // Storage, seats, and agent-run caps are labeled placeholders.
    expect(screen.getByText("Storage (placeholder)")).toBeInTheDocument()
    expect(screen.getByText("Seats (placeholder)")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Usage alerts" })).toBeInTheDocument()
  })

  it("shows live usage totals from useUsageSummary", async () => {
    render(<UsageScreen />)

    // Mock adapter fixture: requests 1284, tokens 412030, costUsd 3.87.
    // "1,284"/"412,030" also appear in the month-over-month table.
    expect((await screen.findAllByText("1,284")).length).toBeGreaterThan(0)
    expect(screen.getAllByText("412,030").length).toBeGreaterThan(0)
    // "$3.87" appears as the period cost total and again as usage charges.
    expect(screen.getAllByText("$3.87").length).toBeGreaterThan(0)
    // "Requests" labels the totals row and the comparison table row.
    expect(screen.getAllByText("Requests").length).toBeGreaterThan(0)
    // "Period" labels the totals row and the billing-history column.
    expect(screen.getAllByText("Period").length).toBeGreaterThan(0)
    // Daily analytics charts render from usage.daily once the query resolves.
    expect(await screen.findByRole("heading", { name: "Requests per day" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Tokens per day" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Cost per day" })).toBeInTheDocument()
  })

  it("links usage to billing: period, estimated invoice, and current-period invoice", async () => {
    render(<UsageScreen />)
    // Wait for the usage query so the billing rows derive from live data.
    // "1,284" appears in both the totals and the comparison table.
    await screen.findAllByText("1,284")

    // Plan card shows the live billing period and metered usage charges.
    expect(screen.getByText("Billing period")).toBeInTheDocument()
    // The range shows in the plan card and in the matching invoice's Period column.
    expect(screen.getAllByText("Nov 1, 2026 – Nov 30, 2026").length).toBeGreaterThan(0)
    expect(screen.getByText("Usage charges")).toBeInTheDocument()
    // "$3.87" is both the period cost total and the usage-charges figure.
    expect(screen.getAllByText("$3.87").length).toBeGreaterThan(0)
    // Estimated next invoice: 3 seats × $12 + $3.87 metered usage.
    expect(screen.getByText("Est. incl. usage")).toBeInTheDocument()
    expect(screen.getByText("$39.87")).toBeInTheDocument()
    // The invoice covering the current usage period is flagged — the badge
    // text also labels the comparison table's "This period" column.
    expect(screen.getAllByText("This period").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Upcoming").length).toBeGreaterThan(0)
  })

  it("shows the month-over-month comparison with deltas", async () => {
    render(<UsageScreen />)
    // Wait for the usage query so the comparison section renders.
    await screen.findAllByText("1,284")

    // The delta table and the comparison chart are sibling panels in one grid.
    const grid = screen
      .getByRole("heading", { name: "Month over month" })
      .closest("section")?.parentElement
    expect(grid).not.toBeNull()
    const comparison = within(grid as HTMLElement)
    expect(
      comparison.getByRole("heading", { name: "Requests vs previous period" }),
    ).toBeInTheDocument()
    expect(comparison.getByText("Previous period")).toBeInTheDocument()
    // Mock comparison: requests 1102 → 1284 (+16.5%), cost 3.31 → 3.87 (+16.9%).
    expect(comparison.getByText("1,102")).toBeInTheDocument()
    expect(comparison.getByText("+16.5%")).toBeInTheDocument()
    expect(comparison.getByText("+16.9%")).toBeInTheDocument()
  })

  it("shows the usage forecast panel mid-period", async () => {
    // Pin "now" inside the mock billing period (Nov 2026) so the run-rate
    // forecast has elapsed days to project from.
    vi.setSystemTime(new Date("2026-11-20T12:00:00.000Z"))
    try {
      render(<UsageScreen />)
      await screen.findAllByText("1,284")

      const heading = screen.getByRole("heading", { name: "Usage forecast" })
      const panel = heading.closest("section") as HTMLElement
      const forecast = within(panel)
      // 20 elapsed of 30 days; pace, period-end totals, and invoice estimate.
      expect(forecast.getByText(/Linear run-rate over 20 of 30 days/)).toBeInTheDocument()
      expect(forecast.getByText("Daily pace")).toBeInTheDocument()
      expect(forecast.getByText("Forecast by period end")).toBeInTheDocument()
      expect(forecast.getByText("Est. invoice at this pace")).toBeInTheDocument()
      // Team has no metered cap, so no limit rows render.
      expect(forecast.queryByText("Forecast vs request limit")).not.toBeInTheDocument()

      // The per-project table carries the same run-rate forecast columns.
      const projectPanel = screen
        .getByRole("heading", { name: "Usage by project" })
        .closest("section") as HTMLElement
      const projects = within(projectPanel)
      expect(projects.getByText("Forecast requests")).toBeInTheDocument()
      expect(projects.getByText("Forecast cost")).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it("breaks usage down by project with links to each project", async () => {
    render(<UsageScreen />)
    await screen.findAllByText("1,284")

    const heading = screen.getByRole("heading", { name: "Usage by project" })
    const panel = heading.closest("section") as HTMLElement
    const table = within(panel)

    // Mock split: Coastal Resilience 642 requests (50.0%), Field Notes 385
    // (30.0%), Tide Model Archive 257 (20.0%) — sorted by requests desc.
    const links = table.getAllByRole("link")
    expect(links.map((link) => link.textContent)).toEqual([
      "Coastal Resilience",
      "Field Notes",
      "Tide Model Archive",
    ])
    expect(links[0]).toHaveAttribute("href", "/projects/prj_01")
    expect(table.getByText("642")).toBeInTheDocument()
    expect(table.getByText("50.0%")).toBeInTheDocument()
    expect(table.getByText("20.0%")).toBeInTheDocument()
    expect(table.getByText("30.0%")).toBeInTheDocument()
  })

  it("exports the loaded usage summary as CSV", async () => {
    const createObjectURL = vi.fn((_blob: Blob) => "blob:mock")
    const revokeObjectURL = vi.fn()
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)

    render(<UsageScreen />)
    // Wait for the usage query so the export buttons are enabled.
    await screen.findAllByText("1,284")
    await userEvent.click(screen.getByRole("button", { name: "Export usage CSV" }))

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const [blob] = createObjectURL.mock.calls[0]
    const csv = await blob.text()
    // Mock adapter fixture totals and first daily point.
    expect(csv).toContain('"requests","1284"')
    expect(csv).toContain('"tokens","412030"')
    expect(csv).toContain('"costUsd","3.87"')
    expect(csv).toContain('"2026-11-01T00:00:00.000Z"')
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock")

    click.mockRestore()
    vi.unstubAllGlobals()
  })

  it("exports the mock invoices as CSV", async () => {
    const createObjectURL = vi.fn(() => "blob:mock")
    const revokeObjectURL = vi.fn()
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)

    render(<UsageScreen />)
    await userEvent.click(screen.getByRole("button", { name: "Export CSV" }))

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock")

    click.mockRestore()
    vi.unstubAllGlobals()
  })
})
