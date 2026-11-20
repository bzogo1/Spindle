import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  NewsletterScreen,
  type NewsletterCampaignRow,
  type NewsletterSubscriberRow,
} from "./newsletter-screen"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const SUBSCRIBERS: NewsletterSubscriberRow[] = [
  {
    id: "sub_1",
    email: "ada@example.com",
    source: "site-footer",
    consentedAt: "2026-01-01T00:00:00.000Z",
    status: "active",
  },
  {
    id: "sub_2",
    email: "bob@example.com",
    source: "blog",
    consentedAt: "2026-01-02T00:00:00.000Z",
    status: "unsubscribed",
    unsubscribedAt: "2026-01-03T00:00:00.000Z",
  },
]

const CAMPAIGNS: NewsletterCampaignRow[] = [
  {
    id: "cmp_1",
    subject: "Spring launch",
    bodyPreview: "Big news inside.",
    status: "draft",
    createdAt: "2026-01-04T00:00:00.000Z",
  },
]

function subscribersBody(
  subscribers: NewsletterSubscriberRow[] = SUBSCRIBERS,
  total = subscribers.length,
) {
  return {
    ok: true,
    stats: {
      subscribers: { total: 5, pending: 1, active: 3, unsubscribed: 1 },
      campaigns: { total: 1, draft: 1, scheduled: 0, sent: 0 },
    },
    subscribers,
    total,
    limit: 50,
    offset: 0,
  }
}

function campaignsBody(campaigns: NewsletterCampaignRow[] = CAMPAIGNS) {
  return { ok: true, campaigns, total: campaigns.length, limit: 50, offset: 0 }
}

let fetchMock: ReturnType<typeof vi.fn>

function mockFetch(subscribers = subscribersBody(), campaigns = campaignsBody()) {
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith("/api/admin/newsletter/campaigns")) {
      return Promise.resolve(jsonResponse(campaigns))
    }
    return Promise.resolve(jsonResponse(subscribers))
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

describe("NewsletterScreen", () => {
  it("renders stats cards, the subscriber table, and campaigns", async () => {
    render(<NewsletterScreen />)

    expect(await screen.findByText("ada@example.com")).toBeInTheDocument()
    expect(screen.getByText("bob@example.com")).toBeInTheDocument()
    // Stats cards: "Subscribers" appears as both a card title and the panel
    // heading; the counts come from the mocked stats payload.
    expect(screen.getAllByText("Subscribers").length).toBeGreaterThanOrEqual(2)
    expect(screen.getByRole("heading", { name: "Subscribers" })).toBeInTheDocument()
    expect(screen.getByText("Active")).toBeInTheDocument()
    expect(screen.getByText("Pending")).toBeInTheDocument()
    expect(screen.getByText("Unsubscribed")).toBeInTheDocument()
    for (const count of ["5", "3", "1"]) {
      expect(screen.getAllByText(count).length).toBeGreaterThan(0)
    }
    // Campaigns section.
    expect(screen.getByText("Spring launch")).toBeInTheDocument()
    expect(screen.getByText("draft")).toBeInTheDocument()
    expect(screen.getByText(/Sending is not enabled yet/)).toBeInTheDocument()
  })

  it("shows the empty state when there are no subscribers", async () => {
    mockFetch(subscribersBody([], 0), campaignsBody([]))
    render(<NewsletterScreen />)
    expect(await screen.findByText("No subscribers yet")).toBeInTheDocument()
    expect(screen.getByText("No campaigns yet")).toBeInTheDocument()
  })

  it("shows an error state with retry when subscribers fail to load", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith("/api/admin/newsletter/campaigns")) {
        return Promise.resolve(jsonResponse(campaignsBody()))
      }
      return Promise.resolve(jsonResponse({ ok: false, message: "Denied" }, 500))
    })
    render(<NewsletterScreen />)

    expect(await screen.findByText("Subscribers unavailable")).toBeInTheDocument()
    expect(screen.getByText("Denied")).toBeInTheDocument()

    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith("/api/admin/newsletter/campaigns")) {
        return Promise.resolve(jsonResponse(campaignsBody()))
      }
      return Promise.resolve(jsonResponse(subscribersBody()))
    })
    await userEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(await screen.findByText("ada@example.com")).toBeInTheDocument()
  })

  it("debounces search input into a request with q=", async () => {
    render(<NewsletterScreen />)
    await screen.findByText("ada@example.com")

    fetchMock.mockClear()
    mockFetch(subscribersBody([SUBSCRIBERS[0]]))
    await userEvent.type(screen.getByLabelText("Search subscribers"), "ada")

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("q=ada"), expect.anything())
    })
  })

  it("creates a draft campaign via POST and refreshes the list", async () => {
    render(<NewsletterScreen />)
    await screen.findByText("Spring launch")

    fetchMock.mockClear()
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith("/api/admin/newsletter/campaigns") && init?.method === "POST") {
        return Promise.resolve(
          jsonResponse({
            ok: true,
            campaign: { ...CAMPAIGNS[0], id: "cmp_2", subject: "Autumn update" },
          }),
        )
      }
      if (url.startsWith("/api/admin/newsletter/campaigns")) {
        return Promise.resolve(
          jsonResponse(campaignsBody([{ ...CAMPAIGNS[0], id: "cmp_2", subject: "Autumn update" }])),
        )
      }
      return Promise.resolve(jsonResponse(subscribersBody()))
    })

    await userEvent.type(screen.getByLabelText("Subject"), "Autumn update")
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/newsletter/campaigns",
        expect.objectContaining({ method: "POST" }),
      )
    })
    expect(await screen.findByText("Autumn update")).toBeInTheDocument()
    expect(screen.getByText(/Draft campaign saved/)).toBeInTheDocument()
  })
})
