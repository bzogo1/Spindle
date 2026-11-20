import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AnnouncementsScreen, type AnnouncementRow } from "./announcements-screen"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function row(overrides: Partial<AnnouncementRow> = {}): AnnouncementRow {
  return {
    id: "ann_1",
    title: "Maintenance window",
    body: "We will be down on Sunday.",
    audience: "all",
    startsAt: "2020-01-01T00:00:00.000Z",
    publishedAt: "2020-01-01T00:00:00.000Z",
    createdAt: "2020-01-01T00:00:00.000Z",
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

function mockList(rows: AnnouncementRow[] = [row()]) {
  fetchMock.mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      return Promise.resolve(
        jsonResponse({ ok: true, announcement: { ...row(), id: "ann_new", title: "Posted" } }),
      )
    }
    return Promise.resolve(jsonResponse({ ok: true, announcements: rows }))
  })
}

describe("AnnouncementsScreen", () => {
  it("shows a loading state then the announcement list", async () => {
    mockList([
      row({ id: "ann_1", title: "Live one" }),
      row({
        id: "ann_2",
        title: "Future one",
        startsAt: "2099-01-01T00:00:00.000Z",
        audience: "admins",
      }),
    ])
    render(<AnnouncementsScreen />)

    expect(await screen.findByText("Live one")).toBeInTheDocument()
    expect(screen.getByText("Future one")).toBeInTheDocument()
    expect(screen.getByText("scheduled")).toBeInTheDocument()
    expect(screen.getByText("Admins")).toBeInTheDocument()
  })

  it("shows an empty state when there are no announcements", async () => {
    mockList([])
    render(<AnnouncementsScreen />)
    expect(await screen.findByText("No announcements yet")).toBeInTheDocument()
  })

  it("shows an error with retry when the list fails", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, message: "denied" }, 403))
    render(<AnnouncementsScreen />)
    expect(await screen.findByText("Announcements unavailable")).toBeInTheDocument()
  })

  it("publishes a new announcement via POST and reloads", async () => {
    const user = userEvent.setup()
    mockList([])
    render(<AnnouncementsScreen />)
    await screen.findByText("No announcements yet")

    await user.type(screen.getByLabelText("Title"), "Big news")
    await user.type(screen.getByLabelText("Body"), "Something shipped.")
    // datetime-local inputs reject per-keystroke typing in jsdom; set the
    // value directly.
    fireEvent.change(screen.getByLabelText("Starts at"), {
      target: { value: "2030-01-01T10:00" },
    })

    await user.click(screen.getByRole("button", { name: /Publish announcement/ }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/announcements",
        expect.objectContaining({ method: "POST" }),
      ),
    )

    const postCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "POST",
    )
    const sent = JSON.parse(String((postCall?.[1] as RequestInit).body))
    expect(sent).toMatchObject({
      title: "Big news",
      body: "Something shipped.",
      audience: "all",
    })
    expect(sent.startsAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    expect(sent.endsAt).toBeUndefined()

    // After publish the list is refetched and the notice is shown.
    expect(await screen.findByText("Announcement published.")).toBeInTheDocument()
  })

  it("keeps the submit button disabled until required fields are set", async () => {
    mockList([])
    render(<AnnouncementsScreen />)
    await screen.findByText("No announcements yet")

    const submit = screen.getByRole("button", { name: /Publish announcement/ })
    expect(submit).toBeDisabled()

    await userEvent.type(screen.getByLabelText("Title"), "Only title")
    expect(submit).toBeDisabled()
  })
})
