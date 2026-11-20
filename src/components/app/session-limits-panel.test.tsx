import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { SessionLimitsPanel } from "./session-limits-panel"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function limitsResponse(overrides: Record<string, unknown> = {}) {
  return jsonResponse({
    ok: true,
    limit: 5,
    unlimited: false,
    activeCount: 2,
    sessions: [],
    ...overrides,
  })
}

function mockFetchSequence(...responses: Response[]) {
  const fetchMock = vi.fn()
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response)
  }
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe("SessionLimitsPanel", () => {
  it("loads and renders current usage and limit", async () => {
    mockFetchSequence(limitsResponse())
    render(<SessionLimitsPanel />)
    expect(screen.getByText(/Loading session limits/)).toBeInTheDocument()
    await screen.findByText("Concurrent session limit")
    expect(screen.getByDisplayValue("5")).toBeInTheDocument()
    expect(screen.getByText("2 of 5")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Save limit/ })).toBeDisabled()
  })

  it("shows unlimited wording when limit is 0", async () => {
    mockFetchSequence(limitsResponse({ limit: 0, unlimited: true }))
    render(<SessionLimitsPanel />)
    await screen.findByDisplayValue("0")
    expect(screen.getByText(/No cap/)).toBeInTheDocument()
  })

  it("PUTs the new limit on save", async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetchSequence(
      limitsResponse(),
      limitsResponse({ limit: 3, activeCount: 2 }),
    )
    render(<SessionLimitsPanel />)
    const input = await screen.findByLabelText("Maximum concurrent sessions")
    await user.clear(input)
    await user.type(input, "3")
    await user.click(screen.getByRole("button", { name: /Save limit/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toBe("/api/auth/session-limits")
    expect(init.method).toBe("PUT")
    expect(JSON.parse(init.body as string)).toEqual({ limit: 3 })
    await screen.findByText(/Session limit saved/)
  })

  it("keeps save disabled for invalid input", async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetchSequence(limitsResponse())
    render(<SessionLimitsPanel />)
    const input = await screen.findByLabelText("Maximum concurrent sessions")
    await user.clear(input)
    await user.type(input, "51")
    expect(screen.getByRole("button", { name: /Save limit/ })).toBeDisabled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("shows an error with retry when the initial load fails", async () => {
    const user = userEvent.setup()
    mockFetchSequence(
      jsonResponse({ ok: false, message: "boom" }, 500),
      limitsResponse({ limit: 2, activeCount: 1 }),
    )
    render(<SessionLimitsPanel />)
    await screen.findByText("Session limits unavailable")
    await user.click(screen.getByRole("button", { name: "Retry" }))
    await screen.findByDisplayValue("2")
  })
})
