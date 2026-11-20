import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { BillingScreen } from "./billing-screen"

const plans = [
  {
    id: "free" as const,
    name: "Free",
    priceLabel: "$0",
    seatLimit: 5,
    summary: "For trying Spindle with a small team.",
  },
  {
    id: "pro" as const,
    name: "Pro",
    priceLabel: "$12 per member / month",
    seatLimit: 25,
    summary: "For growing teams.",
  },
  {
    id: "business" as const,
    name: "Business",
    priceLabel: "$40 per member / month",
    seatLimit: 200,
    summary: "For larger organizations.",
  },
]

const billing = {
  plan: "free" as const,
  status: "active" as const,
  currentPeriodEnd: null,
  seatCount: 3,
}

const seats = { allowed: true, limit: 5, current: 3 }

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const fetchMock = vi.fn()

function payload(overrides: Record<string, unknown> = {}) {
  return { ok: true, role: "owner", billing, seats, plans, ...overrides }
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

describe("BillingScreen", () => {
  it("loads billing and renders the current plan, seat meter, and plan cards", async () => {
    fetchMock.mockResolvedValue(jsonResponse(payload()))

    render(<BillingScreen workspaceId="ws-1" />)

    expect(await screen.findByText("Free plan")).toBeInTheDocument()
    expect(screen.getByText("3 of 5 seats used")).toBeInTheDocument()
    expect(screen.getByText("Seat usage")).toBeInTheDocument()
    expect(screen.getByRole("progressbar", { name: "Seat usage" })).toBeInTheDocument()
    expect(screen.getByText("No billing period set")).toBeInTheDocument()
    expect(screen.getByText("Current plan")).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "Upgrade" })).toHaveLength(2)
    expect(screen.getByText(/not connected to a payment provider/i)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/billing",
      expect.objectContaining({ cache: "no-store" }),
    )
  })

  it("shows the period end when set and flags seat overflow", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        payload({
          billing: {
            ...billing,
            plan: "pro",
            status: "trialing",
            currentPeriodEnd: "2026-04-01T00:00:00.000Z",
          },
          seats: { allowed: false, limit: 25, current: 30 },
        }),
      ),
    )

    render(<BillingScreen workspaceId="ws-1" />)

    expect(await screen.findByText("Pro plan")).toBeInTheDocument()
    expect(screen.getByText("Trialing")).toBeInTheDocument()
    expect(screen.getByText(/Current period ends/)).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent(/more members than the pro plan/i)
    expect(screen.getByText("30 of 25 seats used")).toBeInTheDocument()
  })

  it("shows an insufficient-permissions state for members (403)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { ok: false, code: "forbidden", message: "Insufficient workspace permissions." },
        403,
      ),
    )

    render(<BillingScreen workspaceId="ws-1" />)

    expect(await screen.findByText(/Only workspace owners and admins/)).toBeInTheDocument()
    expect(screen.queryByText("Free plan")).not.toBeInTheDocument()
  })

  it("PATCHes the selected plan and updates the current-plan card", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/workspaces/ws-1/billing" && (!init || init.method === undefined)) {
        return Promise.resolve(jsonResponse(payload()))
      }
      if (url === "/api/workspaces/ws-1/billing" && init?.method === "PATCH") {
        return Promise.resolve(
          jsonResponse(
            payload({
              billing: { ...billing, plan: "pro" },
              seats: { allowed: true, limit: 25, current: 3 },
            }),
          ),
        )
      }
      return Promise.resolve(jsonResponse({ ok: false, message: "Unexpected" }, 500))
    })

    render(<BillingScreen workspaceId="ws-1" />)

    await screen.findByText("Free plan")
    // Plan cards render bare names ("Pro"); the current-plan heading is "Pro plan".
    const upgradeButtons = screen.getAllByRole("button", { name: "Upgrade" })
    await userEvent.click(upgradeButtons[0])

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/workspaces/ws-1/billing",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ plan: "pro" }),
        }),
      ),
    )
    expect(await screen.findByText("Pro plan")).toBeInTheDocument()
  })

  it("shows a confirm step on 409 seat_overflow and resends with confirmSeatOverflow", async () => {
    let patchCalls = 0
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/workspaces/ws-1/billing" && (!init || init.method === undefined)) {
        return Promise.resolve(
          jsonResponse(
            payload({
              billing: { ...billing, plan: "business" },
              seats: { allowed: true, limit: 200, current: 40 },
            }),
          ),
        )
      }
      if (url === "/api/workspaces/ws-1/billing" && init?.method === "PATCH") {
        patchCalls += 1
        if (patchCalls === 1) {
          return Promise.resolve(
            jsonResponse(
              {
                ok: false,
                code: "seat_overflow",
                message: "The free plan allows 5 seats but this workspace has 40 members.",
              },
              409,
            ),
          )
        }
        return Promise.resolve(
          jsonResponse(
            payload({
              billing: { ...billing, plan: "free" },
              seats: { allowed: false, limit: 5, current: 40 },
            }),
          ),
        )
      }
      return Promise.resolve(jsonResponse({ ok: false, message: "Unexpected" }, 500))
    })

    render(<BillingScreen workspaceId="ws-1" />)

    await screen.findByText("Business plan")
    // Plan cards render in catalog order: free, pro, business (current).
    const downgradeButtons = screen.getAllByRole("button", { name: "Downgrade" })
    await userEvent.click(downgradeButtons[0])

    expect(await screen.findByRole("alert")).toHaveTextContent(/Free plan allows 5 seats/)
    expect(patchCalls).toBe(1)

    await userEvent.click(screen.getByRole("button", { name: /Downgrade to Free anyway/ }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/workspaces/ws-1/billing",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ plan: "free", confirmSeatOverflow: true }),
        }),
      ),
    )
    expect(await screen.findByText("Free plan")).toBeInTheDocument()
  })

  it("dismisses the seat-overflow confirm without resending", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/workspaces/ws-1/billing" && (!init || init.method === undefined)) {
        return Promise.resolve(
          jsonResponse(
            payload({
              billing: { ...billing, plan: "business" },
              seats: { allowed: true, limit: 200, current: 40 },
            }),
          ),
        )
      }
      if (url === "/api/workspaces/ws-1/billing" && init?.method === "PATCH") {
        return Promise.resolve(
          jsonResponse({ ok: false, code: "seat_overflow", message: "Too many members." }, 409),
        )
      }
      return Promise.resolve(jsonResponse({ ok: false, message: "Unexpected" }, 500))
    })

    render(<BillingScreen workspaceId="ws-1" />)

    await screen.findByText("Business plan")
    await userEvent.click(screen.getAllByRole("button", { name: "Downgrade" })[0])
    await screen.findByRole("alert")

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument())
    expect(screen.getByText("Business plan")).toBeInTheDocument()
  })

  it("renders a downgrade button for plans below the current plan", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        payload({
          billing: { ...billing, plan: "business" },
          seats: { allowed: true, limit: 200, current: 40 },
        }),
      ),
    )

    render(<BillingScreen workspaceId="ws-1" />)

    expect(await screen.findByText("Business plan")).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "Downgrade" })).toHaveLength(2)
    expect(screen.queryByRole("button", { name: "Upgrade" })).not.toBeInTheDocument()
  })
})
