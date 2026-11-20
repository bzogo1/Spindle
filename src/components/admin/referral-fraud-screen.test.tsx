import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ReferralFraudScreen, type FlaggedReferralRow } from "./referral-fraud-screen"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const FLAGS: FlaggedReferralRow[] = [
  {
    id: "rff_1",
    referralId: "ref-1",
    referrerId: "u1",
    referrerEmail: "ada@x.com",
    referredId: null,
    referredEmail: "ada@x.com",
    score: 65,
    reasons: [
      { rule: "self_referral_email", detail: "Identical emails.", points: 50 },
      { rule: "same_email_domain", detail: "Shared domain.", points: 15 },
    ],
    status: "pending",
    scannedAt: "2026-02-01T12:00:00.000Z",
    reviewedBy: null,
    reviewedAt: null,
  },
  {
    id: "rff_2",
    referralId: "ref-2",
    referrerId: "u2",
    referrerEmail: "f@x.com",
    referredId: "u9",
    referredEmail: "g@y.com",
    score: 80,
    reasons: [{ rule: "disposable_email", detail: "Disposable domain.", points: 35 }],
    status: "confirmed_fraud",
    scannedAt: "2026-02-01T11:00:00.000Z",
    reviewedBy: "admin@example.com",
    reviewedAt: "2026-02-01T13:00:00.000Z",
  },
]

function flagsBody(flags: FlaggedReferralRow[], status?: string) {
  const filtered = status ? flags.filter((f) => f.status === status) : flags
  return { ok: true, flags: filtered, total: filtered.length }
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function mockList(flags: FlaggedReferralRow[] = FLAGS) {
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes("/api/admin/referral-fraud?")) {
      const status = new URL(url, "http://localhost").searchParams.get("status") ?? undefined
      return Promise.resolve(jsonResponse(flagsBody(flags, status)))
    }
    return Promise.resolve(jsonResponse(flagsBody(flags)))
  })
}

describe("ReferralFraudScreen", () => {
  it("loads the pending queue by default and renders rows", async () => {
    mockList()
    render(<ReferralFraudScreen />)

    expect(screen.getByText("Loading fraud queue")).toBeInTheDocument()
    expect(await screen.findByText("ada@x.com → ada@x.com")).toBeInTheDocument()
    expect(screen.getByText("self_referral_email")).toBeInTheDocument()
    expect(screen.getByText("65")).toBeInTheDocument()
    // "Pending" appears as both the filter button and the status badge.
    expect(screen.getAllByText("Pending").length).toBeGreaterThanOrEqual(2)
    // Default filter is pending — confirmed_fraud row is not shown.
    expect(screen.queryByText("f@x.com → g@y.com")).not.toBeInTheDocument()
  })

  it("shows the empty state when nothing is pending", async () => {
    mockList([])
    render(<ReferralFraudScreen />)
    expect(await screen.findByText("No pending flags")).toBeInTheDocument()
  })

  it("shows an error state with retry on failure", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, message: "Nope" }, 500))
    render(<ReferralFraudScreen />)

    expect(await screen.findByText("Fraud queue unavailable")).toBeInTheDocument()
    expect(screen.getByText("Nope")).toBeInTheDocument()
    expect(screen.queryByText("No pending flags")).not.toBeInTheDocument()

    mockList()
    await userEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(await screen.findByText("ada@x.com → ada@x.com")).toBeInTheDocument()
  })

  it("switches the status filter and reloads", async () => {
    mockList()
    render(<ReferralFraudScreen />)
    await screen.findByText("ada@x.com → ada@x.com")

    fetchMock.mockClear()
    await userEvent.click(screen.getByRole("button", { name: "Confirmed fraud" }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("status=confirmed_fraud"),
        expect.anything(),
      )
    })
    expect(await screen.findByText("f@x.com → g@y.com")).toBeInTheDocument()
    // "Confirmed fraud" appears as both the filter button and the status badge.
    expect(screen.getAllByText("Confirmed fraud").length).toBeGreaterThanOrEqual(2)
  })

  it("runs a scan via POST and reloads the queue", async () => {
    mockList()
    render(<ReferralFraudScreen />)
    await screen.findByText("ada@x.com → ada@x.com")

    fetchMock.mockClear()
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === "POST") {
        return Promise.resolve(jsonResponse({ ok: true, flags: FLAGS, flagged: 2 }))
      }
      const status = new URL(url, "http://localhost").searchParams.get("status") ?? undefined
      return Promise.resolve(jsonResponse(flagsBody(FLAGS, status)))
    })

    await userEvent.click(screen.getByRole("button", { name: "Run scan" }))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/referral-fraud",
        expect.objectContaining({ method: "POST" }),
      )
    })
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/admin/referral-fraud?"),
        expect.objectContaining({ cache: "no-store" }),
      )
    })
  })

  it("reviews a pending flag via PATCH and reloads", async () => {
    mockList()
    render(<ReferralFraudScreen />)
    await screen.findByText("ada@x.com → ada@x.com")

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === "PATCH") {
        return Promise.resolve(
          jsonResponse({
            ok: true,
            flag: { ...FLAGS[0], status: "cleared", reviewedBy: "admin@example.com" },
          }),
        )
      }
      const status = new URL(url, "http://localhost").searchParams.get("status") ?? undefined
      return Promise.resolve(jsonResponse(flagsBody(FLAGS, status)))
    })

    await userEvent.click(screen.getByRole("button", { name: "Clear" }))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/referral-fraud/rff_1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ status: "cleared" }),
        }),
      )
    })
    // Queue reloads after the review.
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(([input]) => String(input).includes("status=pending")).length,
      ).toBeGreaterThanOrEqual(2)
    })
  })
})
