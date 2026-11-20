import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { InboxMessage } from "@/lib/in-app-messages"

import { MessagesScreen } from "./messages-screen"

const inboxFixture: InboxMessage[] = [
  {
    id: "msg-1",
    userId: null,
    subject: "Scheduled maintenance",
    body: "The app will be unavailable tonight at 22:00 UTC.",
    kind: "warning",
    createdAt: "2026-11-20T10:00:00.000Z",
    read: false,
  },
  {
    id: "msg-2",
    userId: "user-a",
    subject: "Welcome aboard",
    body: "Thanks for joining Spindle!",
    kind: "success",
    createdAt: "2026-11-19T09:00:00.000Z",
    read: true,
    readAt: "2026-11-19T12:00:00.000Z",
  },
]

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function inboxResponse(overrides: Record<string, unknown> = {}) {
  return jsonResponse({
    ok: true,
    messages: inboxFixture,
    unreadCount: 1,
    ...overrides,
  })
}

function mockFetch(...responses: Response[]) {
  const fetchMock = vi.fn()
  fetchMock.mockResolvedValue(inboxResponse())
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response)
  }
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe("MessagesScreen", () => {
  it("shows a loading state then renders the inbox", async () => {
    mockFetch(inboxResponse())
    render(<MessagesScreen />)

    expect(screen.getByText(/Loading messages/)).toBeInTheDocument()
    const list = await screen.findByRole("list")
    const items = within(list).getAllByRole("listitem")
    expect(items).toHaveLength(2)
    expect(within(items[0]).getByText("Scheduled maintenance")).toBeInTheDocument()
    expect(within(items[1]).getByText("Welcome aboard")).toBeInTheDocument()
    // Broadcast carries the announcement badge; the direct one does not.
    expect(within(items[0]).getByText("Announcement")).toBeInTheDocument()
    expect(within(items[1]).queryByText("Announcement")).not.toBeInTheDocument()
    // Exactly one unread indicator.
    expect(screen.getAllByLabelText("Unread")).toHaveLength(1)
  })

  it("expands a message and marks it read via POST", async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch(inboxResponse(), jsonResponse({ ok: true, unreadCount: 0 }))
    render(<MessagesScreen />)

    const toggle = await screen.findByRole("button", { name: /Scheduled maintenance/ })
    await user.click(toggle)

    expect(toggle).toHaveAttribute("aria-expanded", "true")
    expect(
      screen.getByText("The app will be unavailable tonight at 22:00 UTC."),
    ).toBeInTheDocument()

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/messages",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ messageId: "msg-1" }),
        }),
      )
    })
    // The unread dot disappears once the receipt lands.
    await waitFor(() => {
      expect(screen.queryByLabelText("Unread")).not.toBeInTheDocument()
    })
  })

  it("does not re-post when expanding an already-read message", async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch(inboxResponse())
    render(<MessagesScreen />)

    const toggle = await screen.findByRole("button", { name: /Welcome aboard/ })
    await user.click(toggle)

    expect(toggle).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByText("Thanks for joining Spindle!")).toBeInTheDocument()
    // Only the initial GET happened.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("marks all messages read via POST { all: true }", async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch(
      inboxResponse({ unreadCount: 2, messages: inboxFixture.map((m) => ({ ...m, read: false })) }),
      jsonResponse({ ok: true, marked: 2, unreadCount: 0 }),
    )
    render(<MessagesScreen />)

    const button = await screen.findByRole("button", { name: /Mark all read/ })
    await user.click(button)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/messages",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ all: true }),
        }),
      )
    })
    await waitFor(() => {
      expect(screen.queryByLabelText("Unread")).not.toBeInTheDocument()
    })
  })

  it("disables Mark all read when nothing is unread", async () => {
    mockFetch(
      inboxResponse({
        unreadCount: 0,
        messages: inboxFixture.map((m) => ({ ...m, read: true })),
      }),
    )
    render(<MessagesScreen />)

    const button = await screen.findByRole("button", { name: /Mark all read/ })
    expect(button).toBeDisabled()
  })

  it("shows the empty state when the inbox has no messages", async () => {
    mockFetch(inboxResponse({ messages: [], unreadCount: 0 }))
    render(<MessagesScreen />)

    expect(await screen.findByText("No messages")).toBeInTheDocument()
  })

  it("shows an error state with retry on failure", async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch(
      jsonResponse({ ok: false, message: "Sign in to view your messages." }, 401),
      inboxResponse(),
    )
    render(<MessagesScreen />)

    expect(await screen.findByText("Messages unavailable")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Retry" }))

    await waitFor(() => {
      expect(screen.getByText("Scheduled maintenance")).toBeInTheDocument()
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
