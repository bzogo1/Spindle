import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AffiliatesScreen, type AffiliateRow } from "./affiliates-screen"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function row(overrides: Partial<AffiliateRow> = {}): AffiliateRow {
  return {
    id: "aff_1",
    userId: "user-1",
    email: "aff@example.com",
    status: "pending",
    code: "AFF-ABCD-EFGH",
    commissionRatePct: 20,
    createdAt: "2026-01-01T00:00:00.000Z",
    stats: { clicks: 5, conversions: 2, revenueCents: 10000, commissionCents: 2000 },
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

function mockList(rows: AffiliateRow[]) {
  fetchMock.mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      const body = JSON.parse(String(init.body)) as { id: string; action: string }
      const target = rows.find((r) => r.id === body.id)
      const status =
        body.action === "approve" ? "active" : body.action === "reject" ? "rejected" : "suspended"
      return Promise.resolve(
        jsonResponse({
          ok: true,
          affiliate: target ? { ...target, status } : undefined,
        }),
      )
    }
    return Promise.resolve(jsonResponse({ ok: true, affiliates: rows }))
  })
}

describe("AffiliatesScreen", () => {
  it("loads the pending queue by default and renders rows", async () => {
    mockList([row()])
    render(<AffiliatesScreen />)

    expect(await screen.findByText("aff@example.com")).toBeInTheDocument()
    expect(screen.getByText("AFF-ABCD-EFGH")).toBeInTheDocument()
    expect(screen.getByText("pending")).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/affiliates?status=pending",
      expect.objectContaining({ cache: "no-store" }),
    )
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument()
  })

  it("shows an empty state when the queue is empty", async () => {
    mockList([])
    render(<AffiliatesScreen />)

    expect(await screen.findByText("No affiliates here")).toBeInTheDocument()
  })

  it("approves an account via PATCH and reloads", async () => {
    const pending = row()
    mockList([pending])
    render(<AffiliatesScreen />)

    await userEvent.click(await screen.findByRole("button", { name: "Approve" }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/affiliates",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ id: pending.id, action: "approve" }),
        }),
      )
    })
    // Reload after the action issues another GET.
    await waitFor(() => {
      const gets = fetchMock.mock.calls.filter(
        ([input, init]) => String(input).includes("status=pending") && !init?.method,
      )
      expect(gets.length).toBeGreaterThanOrEqual(2)
    })
  })

  it("shows suspend (not approve/reject) for active accounts", async () => {
    mockList([row({ status: "active" })])
    render(<AffiliatesScreen />)

    expect(await screen.findByRole("button", { name: "Suspend" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument()
  })
})
