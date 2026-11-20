import { render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { MessagesBell } from "./messages-bell"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe("MessagesBell", () => {
  it("links to /app/messages and shows the unread badge", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: true, unreadCount: 3 })))
    render(<MessagesBell />)

    const link = await screen.findByRole("link", { name: "Messages, 3 unread" })
    expect(link).toHaveAttribute("href", "/app/messages")
    await waitFor(() => {
      expect(link.querySelector(".app-notification-badge")).toHaveTextContent("3")
    })
  })

  it("caps the badge label at 99+", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: true, unreadCount: 120 })))
    render(<MessagesBell />)

    const link = await screen.findByRole("link", { name: "Messages, 120 unread" })
    await waitFor(() => {
      expect(link.querySelector(".app-notification-badge")).toHaveTextContent("99+")
    })
  })

  it("renders without a badge when there is nothing unread", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: true, unreadCount: 0 })))
    render(<MessagesBell />)

    const link = await screen.findByRole("link", { name: "Messages" })
    expect(link.querySelector(".app-notification-badge")).toBeNull()
  })

  it("stays quiet when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")))
    render(<MessagesBell />)

    const link = await screen.findByRole("link", { name: "Messages" })
    expect(link.querySelector(".app-notification-badge")).toBeNull()
  })
})
