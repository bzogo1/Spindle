import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AffiliateScreen, type AffiliateAccountView } from "./affiliate-screen"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function account(overrides: Partial<AffiliateAccountView> = {}): AffiliateAccountView {
  return {
    id: "aff_1",
    userId: "user-1",
    email: "aff@example.com",
    status: "pending",
    code: "AFF-ABCD-EFGH",
    commissionRatePct: 20,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("AffiliateScreen", () => {
  it("shows the apply form when the caller has no affiliate account", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, affiliate: null }))
    render(<AffiliateScreen />)

    expect(await screen.findByText("Apply to the affiliate program")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Apply now" })).toBeInTheDocument()
  })

  it("submits an application and shows the pending dashboard", async () => {
    fetchMock.mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Promise.resolve(
          jsonResponse({
            ok: true,
            affiliate: account({ status: "pending" }),
          }),
        )
      }
      return Promise.resolve(jsonResponse({ ok: true, affiliate: null }))
    })

    render(<AffiliateScreen />)
    await userEvent.click(await screen.findByRole("button", { name: "Apply now" }))

    await waitFor(() => {
      expect(screen.getByText("AFF-ABCD-EFGH")).toBeInTheDocument()
    })
    expect(screen.getByText("pending")).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/affiliate/apply",
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("shows the dashboard with stats for an active affiliate", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        affiliate: account({ status: "active" }),
        stats: { clicks: 12, conversions: 3, revenueCents: 45000, commissionCents: 9000 },
        sharePath: "/api/affiliate/click/AFF-ABCD-EFGH",
      }),
    )
    render(<AffiliateScreen />)

    expect(await screen.findByText("AFF-ABCD-EFGH")).toBeInTheDocument()
    expect(screen.getByText("active")).toBeInTheDocument()
    expect(screen.getByText("12")).toBeInTheDocument()
    expect(screen.getByText("3")).toBeInTheDocument()
    expect(screen.getByText("$450.00")).toBeInTheDocument()
    expect(screen.getByText("$90.00")).toBeInTheDocument()
  })

  it("shows an error state when the status request fails", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, message: "Nope." }, 500))
    render(<AffiliateScreen />)

    expect(await screen.findByText("Affiliate program unavailable")).toBeInTheDocument()
  })
})
