import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ContactInbox, type ContactSubmissionRow } from "./contact-inbox"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const SUBMISSIONS: ContactSubmissionRow[] = [
  {
    id: "CT-00000001",
    name: "Ada Lovelace",
    email: "ada@example.com",
    topic: "billing",
    subject: "Invoice question",
    message: "I was charged twice for my subscription invoice.",
    messagePreview: "I was charged twice for my subscription invoice.",
    routedTo: "billing",
    status: "new",
    createdAt: "2026-02-01T12:00:00.000Z",
    updatedAt: "2026-02-01T12:00:00.000Z",
  },
  {
    id: "CT-00000002",
    name: "Grace Hopper",
    email: "grace@navy.mil",
    topic: "product",
    subject: "Compiler bug",
    message: "The export feature crashes on large files.",
    messagePreview: "The export feature crashes on large files.",
    routedTo: "support",
    status: "resolved",
    assignee: "admin@x.io",
    createdAt: "2026-02-01T11:00:00.000Z",
    updatedAt: "2026-02-01T13:00:00.000Z",
  },
]

let fetchMock: ReturnType<typeof vi.fn>

function mockFetch(
  submissions: ContactSubmissionRow[] = SUBMISSIONS,
  opts: { status?: number; patchStatus?: number } = {},
) {
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === "PATCH") {
      const body = JSON.parse(String(init.body)) as { id: string; status: string }
      if (opts.patchStatus && opts.patchStatus !== 200) {
        return Promise.resolve(jsonResponse({ ok: false, message: "Nope" }, opts.patchStatus))
      }
      const found = submissions.find((s) => s.id === body.id)
      if (!found) return Promise.resolve(jsonResponse({ ok: false }, 404))
      const updated = { ...found, status: body.status }
      return Promise.resolve(jsonResponse({ ok: true, submission: updated }))
    }
    if (url.startsWith("/api/admin/contact")) {
      if (opts.status && opts.status !== 200) {
        return Promise.resolve(jsonResponse({ ok: false, message: "Boom" }, opts.status))
      }
      return Promise.resolve(
        jsonResponse({ ok: true, submissions, total: submissions.length, limit: 50, offset: 0 }),
      )
    }
    return Promise.resolve(jsonResponse({ ok: false }, 404))
  })
}

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("ContactInbox", () => {
  it("renders submissions with topic, queue, and status badges", async () => {
    mockFetch()
    render(<ContactInbox />)

    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument()
    expect(screen.getByText("grace@navy.mil")).toBeInTheDocument()
    expect(screen.getByText("Billing or account")).toBeInTheDocument()
    expect(screen.getByText("Product or technical question")).toBeInTheDocument()
    expect(screen.getByText("Billing")).toBeInTheDocument()
    expect(screen.getByText("Support")).toBeInTheDocument()
    expect(screen.getByText("New")).toBeInTheDocument()
    expect(screen.getByText("Resolved")).toBeInTheDocument()
  })

  it("expands a row to show the message and status actions", async () => {
    mockFetch()
    const user = userEvent.setup()
    render(<ContactInbox />)

    await user.click(await screen.findByText("Ada Lovelace"))
    expect(
      await screen.findByText("I was charged twice for my subscription invoice."),
    ).toBeInTheDocument()
    expect(screen.getByText("CT-00000001")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Mark in progress" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Mark resolved" })).toBeInTheDocument()
  })

  it("PATCHes the status when an action is clicked", async () => {
    mockFetch()
    const user = userEvent.setup()
    render(<ContactInbox />)

    await user.click(await screen.findByText("Ada Lovelace"))
    await user.click(await screen.findByRole("button", { name: "Mark resolved" }))

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === "PATCH",
      )
      expect(patchCall).toBeTruthy()
      expect(JSON.parse(String((patchCall![1] as RequestInit).body))).toEqual({
        id: "CT-00000001",
        status: "resolved",
      })
    })
  })

  it("shows the empty state when there are no submissions", async () => {
    mockFetch([])
    render(<ContactInbox />)
    expect(await screen.findByText("No submissions yet")).toBeInTheDocument()
  })

  it("shows an error state with retry when the fetch fails", async () => {
    mockFetch(SUBMISSIONS, { status: 500 })
    render(<ContactInbox />)
    expect(await screen.findByText("Contact inbox unavailable")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
  })

  it("sends filter params to the API", async () => {
    mockFetch()
    const user = userEvent.setup()
    render(<ContactInbox />)

    await screen.findByText("Ada Lovelace")
    await user.type(screen.getByLabelText("Search submissions"), "ada")

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map(([input]) => String(input))
      expect(calls.some((url) => url.includes("q=ada"))).toBe(true)
    })
  })
})
