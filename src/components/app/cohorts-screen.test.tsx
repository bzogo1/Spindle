import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { CohortReport } from "@/lib/cohorts"
import { getDemoCohortReport } from "@/lib/cohorts"

import { CohortsScreen } from "./cohorts-screen"

const NOW = new Date("2026-11-25T12:00:00.000Z")

function buildReport(): CohortReport {
  return getDemoCohortReport(NOW)
}

describe("CohortsScreen", () => {
  it("renders the cohort matrix from a provided report", () => {
    render(<CohortsScreen report={buildReport()} />)

    expect(screen.getByText("Demo data")).toBeInTheDocument()
    expect(screen.getByText("Signup week")).toBeInTheDocument()
    expect(screen.getByText("Users")).toBeInTheDocument()
    // Week column headers W0..W7.
    expect(screen.getByText("W0")).toBeInTheDocument()
    expect(screen.getByText("W7")).toBeInTheDocument()
    // At least one cohort row label renders.
    expect(screen.getAllByText(/Nov|Oct|Dec/).length).toBeGreaterThan(0)
    // Demo-data honesty note is visible.
    expect(screen.getByText(/Synthetic demo data/)).toBeInTheDocument()
  })

  it("marks column headers with scope=col and labels the table", () => {
    const { container } = render(<CohortsScreen report={buildReport()} />)
    const headers = screen.getAllByRole("columnheader")
    expect(headers.length).toBeGreaterThan(0)
    for (const header of headers) {
      expect(header).toHaveAttribute("scope", "col")
    }
    expect(
      container.querySelector('table[aria-label="Signup-week cohort retention heatmap"]'),
    ).not.toBeNull()
  })

  it("uses a roving tabindex so the grid is a single tab stop", () => {
    const report = buildReport()
    const { container } = render(<CohortsScreen report={report} />)
    const cells = container.querySelectorAll<HTMLElement>("td[data-cohort-cell]")
    expect(cells.length).toBe(report.cohorts.length * report.weeks)
    const tabbable = [...cells].filter((c) => c.tabIndex === 0)
    expect(tabbable).toHaveLength(1)
    // Every other cell stays programmatically focusable (tabindex=-1).
    expect([...cells].every((c) => c.tabIndex === 0 || c.tabIndex === -1)).toBe(true)
  })

  it("moves focus between cells with arrow keys", () => {
    const report = buildReport()
    const { container } = render(<CohortsScreen report={report} />)
    const first = container.querySelector<HTMLElement>('td[data-cohort-cell="0-0"]')
    expect(first).not.toBeNull()
    first!.focus()
    expect(first).toHaveFocus()
    fireEvent.keyDown(first!, { key: "ArrowRight" })
    const second = container.querySelector<HTMLElement>('td[data-cohort-cell="0-1"]')
    expect(second).toHaveFocus()
    fireEvent.keyDown(second!, { key: "ArrowDown" })
    const below = container.querySelector<HTMLElement>('td[data-cohort-cell="1-1"]')
    expect(below).toHaveFocus()
  })

  it("tells keyboard users how to reach cell details", () => {
    render(<CohortsScreen report={buildReport()} />)
    expect(screen.getByText(/hover or focus a cell/i)).toBeInTheDocument()
    expect(screen.getByText(/arrow keys/i)).toBeInTheDocument()
  })

  it("shows the empty state when the report has no cohorts", () => {
    const empty: CohortReport = {
      ...buildReport(),
      cohorts: [],
      totals: { users: 0, excludedUsers: 0, activeThisWeek: 0 },
    }
    render(<CohortsScreen report={empty} />)
    expect(screen.getByText("No cohort data yet")).toBeInTheDocument()
  })

  it("fetches /api/cohorts when no report is provided", async () => {
    const report = buildReport()
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, report }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    render(<CohortsScreen />)

    await waitFor(() => {
      expect(screen.getByText("Demo data")).toBeInTheDocument()
    })
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/cohorts",
      expect.objectContaining({ headers: { accept: "application/json" } }),
    )
    expect(screen.getByText("Signup week")).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it("shows an error state when the fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })))
    render(<CohortsScreen />)
    await waitFor(() => {
      expect(screen.getByText("Cohorts did not load")).toBeInTheDocument()
    })
    vi.unstubAllGlobals()
  })
})
