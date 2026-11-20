import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { changelogReleases } from "@/lib/changelog"

import { WhatsNewScreen } from "./whats-new-screen"

const newest = changelogReleases[0]

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function notifyResponse(unseenIds: string[] = [newest.slug]) {
  return jsonResponse({
    ok: true,
    unseen: changelogReleases
      .filter((r) => unseenIds.includes(r.slug))
      .map((r) => ({
        id: r.slug,
        title: r.title,
        date: r.date,
        version: r.version,
        summary: r.summary,
        url: `/changelog/${r.slug}`,
      })),
    unseenCount: unseenIds.length,
    lastSeen: null,
  })
}

function mockFetch(...responses: Response[]) {
  const fetchMock = vi.fn()
  fetchMock.mockResolvedValue(notifyResponse())
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response)
  }
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe("WhatsNewScreen", () => {
  it("shows a loading state then the release list with unseen markers", async () => {
    mockFetch(notifyResponse())
    render(<WhatsNewScreen />)

    expect(screen.getByText(/Loading what's new/)).toBeInTheDocument()

    const list = await screen.findByRole("list")
    const item = within(list).getAllByRole("listitem")[0]
    expect(within(item).getByText(newest.title)).toBeInTheDocument()
    expect(within(item).getByText("New")).toBeInTheDocument()
    expect(screen.getByLabelText("New")).toBeInTheDocument()
    expect(within(item).getByRole("link", { name: "Read the release notes" })).toHaveAttribute(
      "href",
      `/changelog/${newest.slug}`,
    )
    expect(screen.getByRole("link", { name: /Full changelog/ })).toHaveAttribute(
      "href",
      "/changelog",
    )
  })

  it("marks everything seen via POST and clears the badges", async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch(notifyResponse(), jsonResponse({ ok: true, lastSeen: newest.date }))
    render(<WhatsNewScreen />)

    const button = await screen.findByRole("button", { name: /Mark all seen/ })
    await user.click(button)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/changelog/seen",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ all: true }),
        }),
      )
    })
    await waitFor(() => {
      expect(screen.queryByText("New")).not.toBeInTheDocument()
    })
    expect(screen.getByText(/all caught up/)).toBeInTheDocument()
  })

  it("marks a single entry seen via POST { entryId }", async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch(notifyResponse(), jsonResponse({ ok: true, lastSeen: newest.date }))
    render(<WhatsNewScreen />)

    const button = await screen.findByRole("button", { name: "Mark seen" })
    await user.click(button)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/changelog/seen",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ entryId: newest.slug }),
        }),
      )
    })
    await waitFor(() => {
      expect(screen.queryByText("New")).not.toBeInTheDocument()
    })
  })

  it("keeps newer entries unseen when an older entry is marked seen", async () => {
    const user = userEvent.setup()
    const base = changelogReleases[0]
    // Releases are newest-first: [newer, base, older]. Unseen are the newest
    // and oldest entries, so marking the oldest must leave the newest unseen.
    const newer = {
      ...base,
      slug: "2-0",
      version: "2.0",
      date: "2026-12-01",
      title: "Release two",
    }
    const older = {
      ...base,
      slug: "0-9",
      version: "0.9",
      date: "2026-01-01",
      title: "Release point nine",
    }
    changelogReleases.unshift(newer)
    changelogReleases.push(older)
    try {
      const fetchMock = mockFetch(
        notifyResponse([newer.slug, older.slug]),
        jsonResponse({ ok: true, lastSeen: older.date }),
      )
      render(<WhatsNewScreen />)

      const list = await screen.findByRole("list")
      const items = within(list).getAllByRole("listitem")
      const olderItem = items[items.length - 1]
      await user.click(within(olderItem).getByRole("button", { name: "Mark seen" }))

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/changelog/seen",
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({ entryId: older.slug }),
          }),
        )
      })
      // Only the newest entry remains unseen — the marked entry and anything
      // older are seen, but newer entries keep their "New" badge.
      await waitFor(() => {
        expect(screen.getByText(/1 unseen\./)).toBeInTheDocument()
      })
      expect(screen.getAllByText("New")).toHaveLength(1)
      expect(within(items[0]).getByText("Release two")).toBeInTheDocument()
      expect(within(items[0]).getByText("New")).toBeInTheDocument()
      expect(within(olderItem).queryByText("New")).not.toBeInTheDocument()
    } finally {
      changelogReleases.splice(changelogReleases.indexOf(newer), 1)
      changelogReleases.splice(changelogReleases.indexOf(older), 1)
    }
  })

  it("shows an error state with retry when the fetch fails", async () => {
    const user = userEvent.setup()
    mockFetch(
      jsonResponse({ ok: false, message: "Sign in to view changelog updates." }, 401),
      notifyResponse([]),
    )
    render(<WhatsNewScreen />)

    expect(await screen.findByText("What's new unavailable")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Retry" }))
    await waitFor(() => {
      expect(screen.queryByText("What's new unavailable")).not.toBeInTheDocument()
    })
    expect(screen.getByText(/all caught up/)).toBeInTheDocument()
  })
})
