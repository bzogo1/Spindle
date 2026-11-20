import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AnnouncementBanner, type AnnouncementItem } from "./announcement-banner"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function item(overrides: Partial<AnnouncementItem> = {}): AnnouncementItem {
  return {
    id: "ann_1",
    title: "New dashboard",
    body: "We shipped a new dashboard.",
    audience: "all",
    startsAt: "2026-02-01T00:00:00.000Z",
    publishedAt: "2026-02-01T00:00:00.000Z",
    createdAt: "2026-02-01T00:00:00.000Z",
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

describe("AnnouncementBanner", () => {
  it("renders nothing while loading or when the fetch fails", async () => {
    fetchMock.mockRejectedValue(new Error("network down"))
    const { container } = render(<AnnouncementBanner />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it("renders nothing when there are no active announcements", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, announcements: [] }))
    const { container } = render(<AnnouncementBanner />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/announcements",
      expect.objectContaining({ cache: "no-store" }),
    )
  })

  it("shows up to two announcements with title, body, and CTA", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        announcements: [
          item({ id: "ann_1", title: "First", ctaLabel: "Read more", ctaHref: "/docs" }),
          item({ id: "ann_2", title: "Second", body: "Second body" }),
          item({ id: "ann_3", title: "Third — hidden" }),
        ],
      }),
    )
    render(<AnnouncementBanner />)

    expect(await screen.findByText("First")).toBeInTheDocument()
    expect(screen.getByText("Second body")).toBeInTheDocument()
    expect(screen.queryByText("Third — hidden")).not.toBeInTheDocument()

    const cta = screen.getByRole("link", { name: "Read more" })
    expect(cta).toHaveAttribute("href", "/docs")
  })

  it("renders external CTAs as safe links", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        announcements: [
          item({
            id: "ann_1",
            ctaLabel: "Visit",
            ctaHref: "https://example.com/post",
          }),
        ],
      }),
    )
    render(<AnnouncementBanner />)

    const cta = await screen.findByRole("link", { name: "Visit" })
    expect(cta).toHaveAttribute("href", "https://example.com/post")
    expect(cta).toHaveAttribute("target", "_blank")
    expect(cta).toHaveAttribute("rel", "noopener noreferrer")
  })

  it("dismisses an announcement via POST and hides it", async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ ok: true, announcements: [item({ id: "ann_9", title: "Gone soon" })] }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true, dismissed: true }))

    render(<AnnouncementBanner />)
    expect(await screen.findByText("Gone soon")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Dismiss announcement: Gone soon" }))

    await waitFor(() => expect(screen.queryByText("Gone soon")).not.toBeInTheDocument())
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/announcements/dismiss",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ id: "ann_9" }),
      }),
    )
  })

  it("keeps the announcement hidden even when dismiss fails (best-effort)", async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ ok: true, announcements: [item({ id: "ann_7", title: "Flaky" })] }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: false, message: "nope" }, 500))

    render(<AnnouncementBanner />)
    expect(await screen.findByText("Flaky")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Dismiss announcement: Flaky" }))
    await waitFor(() => expect(screen.queryByText("Flaky")).not.toBeInTheDocument())
  })
})
