import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError, request } from "@/lib/api/client"
import type {
  ContactAnalyticsSummary,
  ContactDailyPoint,
  QueueBreakdownEntry,
} from "@/lib/contact-analytics"

import { ContactAnalyticsPanel } from "./contact-analytics-panel"

vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>()
  return { ...actual, request: vi.fn() }
})

const requestMock = vi.mocked(request)

function fixture(
  overrides: {
    summary?: Partial<ContactAnalyticsSummary>
    queueBreakdown?: QueueBreakdownEntry[]
    daily?: ContactDailyPoint[]
    days?: number
  } = {},
) {
  const summary: ContactAnalyticsSummary = {
    total: 10,
    byStatus: [
      { key: "new", count: 4 },
      { key: "in_progress", count: 2 },
      { key: "resolved", count: 3 },
      { key: "spam", count: 1 },
    ],
    byQueue: [],
    byTopic: [],
    ...overrides.summary,
  }
  return {
    ok: true,
    summary,
    queueBreakdown: overrides.queueBreakdown ?? [
      { key: "support", count: 5, percent: 50 },
      { key: "billing", count: 3, percent: 30 },
      { key: "general", count: 2, percent: 20 },
    ],
    daily: overrides.daily ?? [
      { date: "2026-06-29", count: 4 },
      { date: "2026-06-30", count: 6 },
    ],
    days: overrides.days ?? 30,
    generatedAt: "2026-06-30T12:00:00.000Z",
  }
}

function mockAnalytics(data = fixture()) {
  requestMock.mockResolvedValue(data)
}

beforeEach(() => {
  requestMock.mockReset()
})

describe("ContactAnalyticsPanel", () => {
  it("renders stat cards, the daily chart, and the queue breakdown", async () => {
    mockAnalytics()
    render(<ContactAnalyticsPanel />)

    expect(screen.getByRole("heading", { name: "Contact analytics" })).toBeInTheDocument()

    // Stat cards.
    expect(await screen.findByText("10")).toBeInTheDocument()
    expect(screen.getByText("Total submissions")).toBeInTheDocument()
    expect(screen.getByText("In progress")).toBeInTheDocument()
    expect(screen.getByText("Spam share")).toBeInTheDocument()
    expect(screen.getByText("10%")).toBeInTheDocument()

    // Queue breakdown rows with labels and percents.
    expect(screen.getByText("Queue breakdown")).toBeInTheDocument()
    expect(screen.getByText("Support")).toBeInTheDocument()
    expect(screen.getByText("Billing")).toBeInTheDocument()
    expect(screen.getByText("5 · 50%")).toBeInTheDocument()
    expect(screen.getByText("3 · 30%")).toBeInTheDocument()
  })

  it("requests the 7-day window when the range toggle changes", async () => {
    const user = userEvent.setup()
    mockAnalytics(fixture({ days: 7 }))
    render(<ContactAnalyticsPanel />)

    await screen.findByText("10")
    expect(requestMock).toHaveBeenLastCalledWith(
      "",
      "/api/admin/contact/analytics?days=30",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )

    await user.click(screen.getByRole("button", { name: "7d" }))

    expect(requestMock).toHaveBeenLastCalledWith(
      "",
      "/api/admin/contact/analytics?days=7",
      expect.anything(),
    )
  })

  it("shows the empty state when there are no submissions", async () => {
    mockAnalytics(
      fixture({
        summary: {
          total: 0,
          byStatus: [],
          byQueue: [],
          byTopic: [],
        },
        queueBreakdown: [],
        daily: [],
      }),
    )
    render(<ContactAnalyticsPanel />)

    expect(await screen.findByText("No contact submissions yet")).toBeInTheDocument()
  })

  it("shows the error state and retries", async () => {
    const user = userEvent.setup()
    requestMock.mockRejectedValue(
      new ApiError({ status: 500, code: "server_error", message: "boom" }),
    )
    render(<ContactAnalyticsPanel />)

    expect(await screen.findByText("Contact analytics did not load")).toBeInTheDocument()

    mockAnalytics()
    await user.click(screen.getByRole("button", { name: /try again/i }))
    expect(await screen.findByText("10")).toBeInTheDocument()
  })
})
