import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { WinBackScreen, type WinBackCampaignRow } from "./win-back-screen"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function row(overrides: Partial<WinBackCampaignRow> = {}): WinBackCampaignRow {
  return {
    id: "wb_1",
    name: "Spring win-back",
    status: "draft",
    subject: "We miss you, {{name}}",
    bodyTemplate: "Come back {{name}}.",
    minInactiveDays: 30,
    createdAt: "2026-01-01T00:00:00.000Z",
    stats: { sent: 0, suppressed: 0, failed: 0 },
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
  vi.restoreAllMocks()
})

function mockList(rows: WinBackCampaignRow[] = [row()]) {
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === "POST" && url === "/api/admin/win-back") {
      return Promise.resolve(jsonResponse({ ok: true, campaign: row({ id: "wb_new" }) }))
    }
    if (init?.method === "POST") {
      return Promise.resolve(
        jsonResponse({ ok: true, candidates: 4, sent: 3, suppressed: 1, failed: 0 }),
      )
    }
    if (init?.method === "PATCH") {
      return Promise.resolve(jsonResponse({ ok: true, campaign: row({ status: "active" }) }))
    }
    if (url.includes("preview=1")) {
      return Promise.resolve(jsonResponse({ ok: true, candidateCount: 7 }))
    }
    return Promise.resolve(jsonResponse({ ok: true, campaigns: rows, total: rows.length }))
  })
}

describe("WinBackScreen", () => {
  it("shows a loading state then the campaign list with stats", async () => {
    mockList([
      row({
        status: "active",
        stats: { sent: 12, suppressed: 3, failed: 1, churnRisk: 2 },
        lastRun: {
          at: "2026-02-01T10:00:00.000Z",
          candidates: 16,
          sent: 12,
          suppressed: 3,
          failed: 1,
        },
      }),
    ])
    render(<WinBackScreen />)

    expect(await screen.findByText("Spring win-back")).toBeInTheDocument()
    expect(screen.getByText("We miss you, {{name}}")).toBeInTheDocument()
    expect(screen.getByText("12")).toBeInTheDocument()
    expect(screen.getByText("3")).toBeInTheDocument()
    expect(screen.getByText("2")).toBeInTheDocument() // churnRisk
    expect(screen.getByText(/opted out|unsubscribed/i)).toBeInTheDocument()
  })

  it("shows the empty state when there are no campaigns", async () => {
    mockList([])
    render(<WinBackScreen />)
    expect(await screen.findByText("No win-back campaigns yet")).toBeInTheDocument()
  })

  it("creates a campaign via POST", async () => {
    const user = userEvent.setup()
    mockList([])
    render(<WinBackScreen />)
    await screen.findByText("No win-back campaigns yet")

    await user.type(screen.getByPlaceholderText("Spring win-back"), "Autumn push")
    // fireEvent.change: userEvent.type treats "{{" as key syntax.
    fireEvent.change(screen.getByPlaceholderText("We miss you, {{name}}"), {
      target: { value: "Return {{name}}" },
    })
    fireEvent.change(screen.getByPlaceholderText(/Hi \{\{name\}\}/), {
      target: { value: "Hi {{name}}, we saved your spot." },
    })
    await user.click(screen.getByRole("button", { name: /create draft/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/win-back",
        expect.objectContaining({ method: "POST" }),
      )
    })
    const init = fetchMock.mock.calls.find(
      ([url, i]) => String(url) === "/api/admin/win-back" && (i as RequestInit)?.method === "POST",
    )?.[1] as RequestInit
    expect(JSON.parse(String(init.body))).toMatchObject({
      name: "Autumn push",
      subject: "Return {{name}}",
      minInactiveDays: 30,
    })
  })

  it("previews candidate count for a campaign", async () => {
    const user = userEvent.setup()
    mockList()
    render(<WinBackScreen />)
    await screen.findByText("Spring win-back")

    await user.click(screen.getByRole("button", { name: /preview/i }))
    expect(await screen.findByText(/7 candidates right now/)).toBeInTheDocument()
  })

  it("runs a campaign after confirmation and shows results", async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true)
    mockList()
    render(<WinBackScreen />)
    await screen.findByText("Spring win-back")

    await user.click(screen.getByRole("button", { name: /^run$/i }))
    expect(confirmSpy).toHaveBeenCalled()
    expect(
      await screen.findByText(/Sent 3, suppressed 1 \(opt-outs\), failed 0 of 4 candidates/),
    ).toBeInTheDocument()
  })

  it("does not run when the admin cancels the confirmation", async () => {
    const user = userEvent.setup()
    vi.spyOn(window, "confirm").mockReturnValue(false)
    mockList()
    render(<WinBackScreen />)
    await screen.findByText("Spring win-back")

    await user.click(screen.getByRole("button", { name: /^run$/i }))
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(
          ([url, i]) => String(url) === "/api/admin/win-back/wb_1" && i?.method === "POST",
        ),
      ).toHaveLength(0)
    })
  })

  it("disables run for completed campaigns", async () => {
    mockList([row({ status: "completed" })])
    render(<WinBackScreen />)
    await screen.findByText("Spring win-back")
    expect(screen.getByRole("button", { name: /^run$/i })).toBeDisabled()
  })
})
