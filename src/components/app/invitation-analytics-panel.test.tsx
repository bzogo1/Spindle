import { render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { InvitationAnalytics } from "@/lib/invitation-analytics"

import { formatDurationMs, InvitationAnalyticsPanel } from "./invitation-analytics-panel"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const SAMPLE: InvitationAnalytics = {
  generatedAt: "2026-11-20T12:00:00.000Z",
  total: 10,
  byStatus: { pending: 3, accepted: 5, revoked: 1, expired: 1 },
  acceptanceRate: 0.5,
  timeToAccept: { averageMs: 3 * 60 * 60 * 1000, medianMs: 2 * 60 * 60 * 1000, sampleSize: 5 },
  sent: { last7Days: 4, last30Days: 8 },
  roles: { owner: 1, admin: 2, member: 7 },
  topDomains: [
    { domain: "acme.com", count: 6 },
    { domain: "beta.io", count: 4 },
  ],
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("formatDurationMs", () => {
  it("formats sub-minute, minute, hour, and day ranges", () => {
    expect(formatDurationMs(null)).toBe("—")
    expect(formatDurationMs(30_000)).toBe("<1m")
    expect(formatDurationMs(45 * 60_000)).toBe("45m")
    expect(formatDurationMs(2 * 60 * 60_000)).toBe("2h")
    expect(formatDurationMs((2 * 60 + 15) * 60_000)).toBe("2h 15m")
    expect(formatDurationMs(3 * 24 * 60 * 60_000 + 4 * 60 * 60_000)).toBe("3d 4h")
  })
})

describe("InvitationAnalyticsPanel", () => {
  it("renders stat cards and breakdowns from the analytics endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: true, analytics: SAMPLE })))

    render(<InvitationAnalyticsPanel />)

    expect(await screen.findByRole("heading", { name: "Invitation analytics" })).toBeInTheDocument()
    expect(screen.getByText("Total invites")).toBeInTheDocument()
    expect(screen.getByText("10")).toBeInTheDocument()
    expect(screen.getByText("Acceptance rate")).toBeInTheDocument()
    expect(screen.getByText("50%")).toBeInTheDocument()
    expect(screen.getByText("Median time to accept")).toBeInTheDocument()
    expect(screen.getByText("2h")).toBeInTheDocument()
    expect(screen.getByText("acme.com")).toBeInTheDocument()
    expect(screen.getByText("beta.io")).toBeInTheDocument()
    expect(screen.getByText("By role · all time")).toBeInTheDocument()
    expect(screen.getByText("Top invited domains")).toBeInTheDocument()
  })

  it("degrades to an unavailable note when the API errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ ok: false, code: "unauthenticated" }, 401)),
    )

    render(<InvitationAnalyticsPanel />)

    expect(
      await screen.findByText("Invitation analytics are unavailable right now."),
    ).toBeInTheDocument()
  })

  it("requests the analytics endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, analytics: SAMPLE }))
    vi.stubGlobal("fetch", fetchMock)

    render(<InvitationAnalyticsPanel />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/invitations/analytics")
  })
})
