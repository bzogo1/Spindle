import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { useMockSession } from "@/components/app/mock-session-provider"

import { SessionsScreen } from "./sessions-screen"

vi.mock("@/components/app/mock-session-provider", () => ({
  useMockSession: vi.fn(),
}))

const session = vi.mocked(useMockSession)

const sessionsFixture = [
  {
    id: "sess-current-1234",
    createdAt: "2026-01-16T09:30:00.000Z",
    expiresAt: "2026-02-15T09:30:00.000Z",
  },
  {
    id: "sess-other-5678",
    createdAt: "2026-01-10T08:00:00.000Z",
    expiresAt: "2026-02-09T08:00:00.000Z",
  },
]

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function sessionsResponse(overrides: Record<string, unknown> = {}) {
  return jsonResponse({
    ok: true,
    sessions: sessionsFixture,
    currentSessionId: "sess-current-1234",
    supported: true,
    ...overrides,
  })
}

function mockFetch(...responses: Response[]) {
  const fetchMock = vi.fn()
  fetchMock.mockResolvedValue(sessionsResponse())
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response)
  }
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.unstubAllGlobals()
  session.mockReset()
  session.mockReturnValue({
    user: { name: "Ada", email: "ada@lab.edu" },
    workspace: { name: "Lab", slug: "lab" },
    status: "authenticated",
    workspaces: [],
    signIn: vi.fn(),
    signOut: vi.fn(),
    switchWorkspace: vi.fn(),
  })
})

describe("SessionsScreen", () => {
  it("shows a loading state then renders sessions with the current device badge", async () => {
    mockFetch(sessionsResponse())
    render(<SessionsScreen />)

    expect(screen.getByText(/Loading sessions/)).toBeInTheDocument()
    const table = await screen.findByRole("table")
    const body = within(table)
    // Both sessions render with short labels and full ids in the title attr.
    expect(body.getByText("Session sess-cur")).toBeInTheDocument()
    expect(body.getByText("Session sess-oth")).toBeInTheDocument()
    // Exactly one "This device" badge, on the row matching currentSessionId.
    expect(body.getAllByText("This device")).toHaveLength(1)
    expect(body.getByText("Other device")).toBeInTheDocument()
    // Timestamps render in <time> elements.
    expect(document.querySelectorAll("time").length).toBeGreaterThanOrEqual(4)
    // The revoke-all affordance is present.
    expect(screen.getByRole("button", { name: "Sign out everywhere" })).toBeInTheDocument()
  })

  it("shows the empty state when there are no sessions", async () => {
    mockFetch(sessionsResponse({ sessions: [], currentSessionId: null }))
    render(<SessionsScreen />)
    await screen.findByText("No active sessions")
    expect(screen.queryByRole("table")).not.toBeInTheDocument()
  })

  it("shows an honest unsupported state when the API reports supported:false", async () => {
    mockFetch(sessionsResponse({ sessions: null, supported: false }))
    render(<SessionsScreen />)
    await screen.findByText("Session listing unavailable")
    expect(screen.queryByRole("table")).not.toBeInTheDocument()
  })

  it("shows an error with retry when the fetch fails", async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch(
      jsonResponse({ ok: false, message: "boom" }, 500),
      sessionsResponse(),
    )
    render(<SessionsScreen />)
    await screen.findByText("Sessions unavailable")
    expect(screen.queryByRole("table")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Retry" }))
    await within(await screen.findByRole("table")).findByText("Session sess-cur")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("shows the error state when fetch throws", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"))
    vi.stubGlobal("fetch", fetchMock)
    render(<SessionsScreen />)
    await screen.findByText("Sessions unavailable")
    await waitFor(() => expect(screen.getByText(/Check your connection/)).toBeInTheDocument())
  })
})
