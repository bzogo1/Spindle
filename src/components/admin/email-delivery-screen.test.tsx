import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  EmailDeliveryScreen,
  type EmailDeliveryRow,
  type EmailDeliveryStatsPayload,
} from "./email-delivery-screen"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const DELIVERIES: EmailDeliveryRow[] = [
  {
    emailId: "del_1",
    to: "ada@example.com",
    templateKey: "welcome",
    status: "delivered",
    createdAt: "2026-01-01T00:00:00.000Z",
    events: [
      { type: "queued", at: "2026-01-01T00:00:00.000Z" },
      { type: "sent", at: "2026-01-01T00:00:01.000Z" },
      { type: "delivered", at: "2026-01-01T00:00:05.000Z" },
    ],
  },
  {
    emailId: "del_2",
    to: "bob@example.com",
    status: "bounced",
    createdAt: "2026-01-01T01:00:00.000Z",
    events: [
      { type: "queued", at: "2026-01-01T01:00:00.000Z" },
      { type: "sent", at: "2026-01-01T01:00:01.000Z" },
      { type: "bounced", at: "2026-01-01T01:00:02.000Z", meta: { reason: "550" } },
    ],
  },
]

const STATS: EmailDeliveryStatsPayload = {
  total: 2,
  byStatus: {
    queued: 0,
    sent: 0,
    delivered: 1,
    opened: 0,
    clicked: 0,
    bounced: 1,
    complained: 0,
  },
  rates: {
    deliveryRate: 0.5,
    bounceRate: 0.5,
    openRate: null,
    complaintRate: 0,
  },
}

function listBody(deliveries: EmailDeliveryRow[] = DELIVERIES) {
  return { ok: true, deliveries, total: deliveries.length, stats: STATS, limit: 50, offset: 0 }
}

let fetchMock: ReturnType<typeof vi.fn>

function mockFetch(handler?: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (handler) return Promise.resolve(handler(url, init))
    return Promise.resolve(jsonResponse(listBody()))
  })
}

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
  mockFetch()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("EmailDeliveryScreen", () => {
  it("renders stats cards and the delivery table", async () => {
    render(<EmailDeliveryScreen />)

    expect(await screen.findByText("ada@example.com")).toBeInTheDocument()
    expect(screen.getByText("bob@example.com")).toBeInTheDocument()
    expect(screen.getByText("welcome")).toBeInTheDocument()
    expect(screen.getAllByText("delivered").length).toBeGreaterThan(0)
    expect(screen.getAllByText("bounced").length).toBeGreaterThan(0)
    expect(screen.getByText("Tracked emails")).toBeInTheDocument()
    expect(screen.getByText("Delivery rate")).toBeInTheDocument()
    expect(screen.getByText("Bounce rate")).toBeInTheDocument()
    expect(screen.getByText("Open rate")).toBeInTheDocument()
    // deliveryRate and bounceRate are both 0.5 → two "50%" cards.
    expect(screen.getAllByText("50%")).toHaveLength(2)
    // "—" renders for the null open rate and for del_2's missing template.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2)
  })

  it("shows the empty state when nothing is tracked", async () => {
    mockFetch(() => jsonResponse(listBody([])))
    render(<EmailDeliveryScreen />)
    expect(await screen.findByText("No tracked deliveries")).toBeInTheDocument()
  })

  it("shows an error state with retry when loading fails", async () => {
    mockFetch(() => jsonResponse({ ok: false, message: "boom" }, 500))
    render(<EmailDeliveryScreen />)
    expect(await screen.findByText("Deliveries unavailable")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
  })

  it("filters by status via the select", async () => {
    const user = userEvent.setup()
    render(<EmailDeliveryScreen />)
    await screen.findByText("ada@example.com")

    await user.click(screen.getByLabelText("Delivery status"))
    await user.click(await screen.findByRole("option", { name: "Bounced" }))

    await waitFor(() => {
      const listCall = fetchMock.mock.calls.find(([input]) =>
        String(input).includes("status=bounced"),
      )
      expect(listCall).toBeTruthy()
    })
  })

  it("expands a row to show the fetched event timeline", async () => {
    const user = userEvent.setup()
    mockFetch((url) => {
      if (url === "/api/admin/email-delivery/del_1") {
        return jsonResponse({ ok: true, delivery: DELIVERIES[0] })
      }
      return jsonResponse(listBody())
    })
    render(<EmailDeliveryScreen />)
    await screen.findByText("ada@example.com")

    // Two rows → two expand buttons; the first belongs to del_1 (ada@…).
    const expandButtons = screen.getAllByRole("button", { name: "Show event timeline" })
    await user.click(expandButtons[0])

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) => String(input) === "/api/admin/email-delivery/del_1"),
      ).toBe(true)
    })
    const timeline = await screen.findByTestId("timeline-del_1")
    expect(timeline).toHaveTextContent("3 events")
    expect(timeline).toHaveTextContent("delivered")
    // Collapse again.
    await user.click(screen.getByRole("button", { name: "Hide event timeline" }))
    expect(screen.queryByTestId("timeline-del_1")).not.toBeInTheDocument()
  })
})
