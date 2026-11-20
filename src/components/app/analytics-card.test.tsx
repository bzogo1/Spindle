import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError, request } from "@/lib/api/client"
import type { AnalyticsSummary } from "@/lib/analytics"

import { AnalyticsCard } from "./analytics-card"

vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>()
  return { ...actual, request: vi.fn() }
})

const requestMock = vi.mocked(request)

function summaryFixture(overrides: Partial<AnalyticsSummary> = {}): AnalyticsSummary {
  return {
    days: 30,
    generatedAt: Date.now(),
    totals: { events: 12, pageViews: 7, featureUses: 4, apiCalls: 1 },
    daily: [
      { date: "2026-06-14", events: 5, pageViews: 3, featureUses: 2, apiCalls: 0 },
      { date: "2026-06-15", events: 7, pageViews: 4, featureUses: 2, apiCalls: 1 },
    ],
    topEvents: [
      { name: "page_view", type: "page_view", count: 7 },
      { name: "search", type: "feature_use", count: 4 },
    ],
    topPaths: [{ path: "/app", count: 9 }],
    ...overrides,
  }
}

function mockSummary(summary = summaryFixture()) {
  requestMock.mockResolvedValue({ ok: true, summary })
}

beforeEach(() => {
  requestMock.mockReset()
})

describe("AnalyticsCard", () => {
  it("renders totals, the daily chart, and top events", async () => {
    mockSummary()
    render(<AnalyticsCard />)

    expect(screen.getByRole("heading", { name: "Product analytics" })).toBeInTheDocument()

    // Stat cards.
    expect(await screen.findByText("12")).toBeInTheDocument()
    expect(screen.getByText("Page views")).toBeInTheDocument()
    expect(screen.getByText("Feature uses")).toBeInTheDocument()
    expect(screen.getByText("API calls")).toBeInTheDocument()

    // Top events list.
    expect(screen.getByText("Top events · last 30 days")).toBeInTheDocument()
    expect(screen.getByText("search")).toBeInTheDocument()
    expect(screen.getByText("page_view")).toBeInTheDocument()
  })

  it("requests the 7-day window when the range toggle changes", async () => {
    const user = userEvent.setup()
    mockSummary(summaryFixture({ days: 7 }))
    render(<AnalyticsCard />)

    await screen.findByText("12")
    expect(requestMock).toHaveBeenLastCalledWith(
      "",
      "/api/analytics/summary?days=30",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )

    await user.click(screen.getByRole("button", { name: "7d" }))

    expect(requestMock).toHaveBeenLastCalledWith(
      "",
      "/api/analytics/summary?days=7",
      expect.anything(),
    )
  })

  it("shows the empty state when there are no events", async () => {
    mockSummary(
      summaryFixture({
        totals: { events: 0, pageViews: 0, featureUses: 0, apiCalls: 0 },
        topEvents: [],
        topPaths: [],
      }),
    )
    render(<AnalyticsCard />)

    expect(await screen.findByText("No analytics events yet")).toBeInTheDocument()
  })

  it("shows the error state and retries", async () => {
    const user = userEvent.setup()
    requestMock.mockRejectedValue(
      new ApiError({ status: 500, code: "server_error", message: "boom" }),
    )
    render(<AnalyticsCard />)

    expect(await screen.findByText("Analytics did not load")).toBeInTheDocument()

    mockSummary()
    await user.click(screen.getByRole("button", { name: /try again/i }))
    expect(await screen.findByText("12")).toBeInTheDocument()
  })
})
