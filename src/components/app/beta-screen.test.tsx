import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { BetaScreen, type BetaProgramRow } from "./beta-screen"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function row(overrides: Partial<BetaProgramRow> = {}): BetaProgramRow {
  return {
    id: "beta_1",
    name: "AI copilot",
    description: "Try the new copilot.",
    status: "open",
    enrolledCount: 3,
    createdAt: "2020-01-01T00:00:00.000Z",
    enrolled: false,
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

function mockList(rows: BetaProgramRow[] = [row()]) {
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString()
    if (init?.method === "POST" && url.endsWith("/enroll")) {
      const body = JSON.parse(String(init.body)) as { enrolled: boolean }
      return Promise.resolve(
        jsonResponse({ ok: true, programId: "beta_1", enrolled: body.enrolled }),
      )
    }
    return Promise.resolve(jsonResponse({ ok: true, programs: rows }))
  })
}

describe("BetaScreen", () => {
  it("lists open programs with a beta badge and enroll button", async () => {
    mockList([row(), row({ id: "beta_2", name: "Dark mode", enrolled: true, enrolledCount: 1 })])
    render(<BetaScreen />)

    expect(await screen.findByText("AI copilot")).toBeInTheDocument()
    expect(screen.getByText("Dark mode")).toBeInTheDocument()
    // One "beta" badge in the panel intro plus one per program row.
    expect(screen.getAllByText("beta")).toHaveLength(3)
    expect(screen.getByRole("button", { name: "Enroll" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Unenrolled — leave/ })).toBeInTheDocument()
    expect(screen.getByText("3 participants")).toBeInTheDocument()
  })

  it("lets the caller leave a closed program they are enrolled in", async () => {
    mockList([
      row({ id: "beta_closed", name: "Closed beta", status: "closed", enrolled: true }),
      row({ id: "beta_closed_out", name: "Closed outsider", status: "closed", enrolled: false }),
    ])
    render(<BetaScreen />)

    const leaveButton = await screen.findByRole("button", { name: /Unenrolled — leave/ })
    // The API only returns closed programs the caller is enrolled in, but a
    // closed + not-enrolled row must not offer Enroll if it ever appears.
    expect(screen.getByRole("button", { name: "Enroll" })).toBeDisabled()
    expect(leaveButton).toBeEnabled()

    const user = userEvent.setup()
    await user.click(leaveButton)

    await waitFor(() => {
      const enrollCall = fetchMock.mock.calls.find(
        ([input, init]) =>
          String(input).endsWith("/api/beta/beta_closed/enroll") && init?.method === "POST",
      )
      expect(enrollCall).toBeDefined()
      expect(JSON.parse(String(enrollCall?.[1]?.body))).toEqual({ enrolled: false })
    })
  })

  it("shows an empty state when there are no programs", async () => {
    mockList([])
    render(<BetaScreen />)
    expect(await screen.findByText("No beta programs right now")).toBeInTheDocument()
  })

  it("shows an error with retry when the list fails", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, message: "denied" }, 403))
    render(<BetaScreen />)
    expect(await screen.findByText("Beta programs unavailable")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
  })

  it("enrolls a program via POST /api/beta/[id]/enroll", async () => {
    mockList([row()])
    const user = userEvent.setup()
    render(<BetaScreen />)

    const enrollButton = await screen.findByRole("button", { name: "Enroll" })
    await user.click(enrollButton)

    await waitFor(() => {
      const enrollCall = fetchMock.mock.calls.find(
        ([input, init]) =>
          String(input).endsWith("/api/beta/beta_1/enroll") && init?.method === "POST",
      )
      expect(enrollCall).toBeDefined()
      expect(JSON.parse(String(enrollCall?.[1]?.body))).toEqual({ enrolled: true })
    })

    expect(await screen.findByRole("button", { name: /Unenrolled — leave/ })).toBeInTheDocument()
  })

  it("rolls back and shows an error when enrollment fails", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString()
      if (init?.method === "POST" && url.endsWith("/enroll")) {
        return Promise.resolve(jsonResponse({ ok: false, message: "closed" }, 409))
      }
      return Promise.resolve(jsonResponse({ ok: true, programs: [row()] }))
    })
    const user = userEvent.setup()
    render(<BetaScreen />)

    await user.click(await screen.findByRole("button", { name: "Enroll" }))

    expect(await screen.findByText("Enrollment update failed")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Enroll" })).toBeInTheDocument()
  })
})
