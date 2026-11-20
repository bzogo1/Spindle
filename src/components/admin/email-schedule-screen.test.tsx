import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { EmailScheduleScreen, type ScheduledEmailRow } from "./email-schedule-screen"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const EMAILS: ScheduledEmailRow[] = [
  {
    id: "eml_1",
    to: "ada@example.com",
    subject: "Welcome follow-up",
    sendAt: "2999-01-01T10:00:00.000Z",
    status: "scheduled",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "eml_2",
    to: "bob@example.com",
    subject: "Old campaign",
    sendAt: "2025-01-01T10:00:00.000Z",
    status: "failed",
    lastError: "provider down",
    createdAt: "2024-12-01T00:00:00.000Z",
  },
]

function listBody(emails: ScheduledEmailRow[] = EMAILS) {
  return { ok: true, emails, total: emails.length, limit: 50, offset: 0 }
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

describe("EmailScheduleScreen", () => {
  it("renders the form and the queue table", async () => {
    render(<EmailScheduleScreen />)

    expect(await screen.findByText("ada@example.com")).toBeInTheDocument()
    expect(screen.getByText("Welcome follow-up")).toBeInTheDocument()
    expect(screen.getByText("bob@example.com")).toBeInTheDocument()
    expect(screen.getByText("provider down")).toBeInTheDocument()
    expect(screen.getAllByText("scheduled").length).toBeGreaterThan(0)
    expect(screen.getAllByText("failed").length).toBeGreaterThan(0)
    expect(screen.getByRole("button", { name: /Run due now/ })).toBeInTheDocument()
    expect(screen.getByLabelText("To")).toBeInTheDocument()
    expect(screen.getByLabelText("Send at")).toBeInTheDocument()
    expect(screen.getByText(/does not refresh automatically/)).toBeInTheDocument()
  })

  it("shows the empty state when the queue is empty", async () => {
    mockFetch(() => jsonResponse(listBody([])))
    render(<EmailScheduleScreen />)
    expect(await screen.findByText("No scheduled emails")).toBeInTheDocument()
  })

  it("shows an error state with retry when loading fails", async () => {
    mockFetch(() => jsonResponse({ ok: false, message: "boom" }, 500))
    render(<EmailScheduleScreen />)
    expect(await screen.findByText("Schedule unavailable")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
  })

  it("schedules an email via POST", async () => {
    const user = userEvent.setup()
    mockFetch((url, init) => {
      if (url === "/api/admin/email-schedule" && init?.method === "POST") {
        return jsonResponse({ ok: true, email: EMAILS[0] })
      }
      return jsonResponse(listBody())
    })
    render(<EmailScheduleScreen />)
    await screen.findByText("ada@example.com")

    await user.type(screen.getByLabelText("To"), "new@example.com")
    await user.type(screen.getByLabelText("Subject"), "Hello there")
    await user.type(screen.getByLabelText("Send at"), "2030-01-01T10:00")
    await user.type(screen.getByLabelText("Text body"), "Body text")
    await user.click(screen.getByRole("button", { name: /Schedule email/ }))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([input, init]) => String(input) === "/api/admin/email-schedule" && init?.method === "POST",
      )
      expect(post).toBeTruthy()
      const payload = JSON.parse(String((post?.[1] as RequestInit).body))
      expect(payload).toMatchObject({
        to: "new@example.com",
        subject: "Hello there",
        textBody: "Body text",
      })
      expect(payload.sendAt).toBe(new Date("2030-01-01T10:00").toISOString())
    })
    expect(await screen.findByText(/Email scheduled/)).toBeInTheDocument()
  })

  it("cancels a scheduled email via DELETE", async () => {
    const user = userEvent.setup()
    mockFetch((url, init) => {
      if (url === "/api/admin/email-schedule/eml_1" && init?.method === "DELETE") {
        return jsonResponse({ ok: true, email: { ...EMAILS[0], status: "canceled" } })
      }
      return jsonResponse(listBody())
    })
    render(<EmailScheduleScreen />)
    await screen.findByText("ada@example.com")

    // Only the scheduled row has a Cancel button.
    const cancelButtons = screen.getAllByRole("button", { name: /Cancel/ })
    expect(cancelButtons).toHaveLength(1)
    await user.click(cancelButtons[0])

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input) === "/api/admin/email-schedule/eml_1" && init?.method === "DELETE",
        ),
      ).toBe(true)
    })
  })

  it("runs the scheduler tick and shows the result", async () => {
    const user = userEvent.setup()
    mockFetch((url, init) => {
      if (url === "/api/admin/email-schedule/tick" && init?.method === "POST") {
        return jsonResponse({ ok: true, processed: 2, sent: 1, failed: 1 })
      }
      return jsonResponse(listBody())
    })
    render(<EmailScheduleScreen />)
    await screen.findByText("ada@example.com")

    await user.click(screen.getByRole("button", { name: /Run due now/ }))
    expect(
      await screen.findByText(/Scheduler tick complete: 2 due, 1 sent, 1 failed/),
    ).toBeInTheDocument()
  })
})
