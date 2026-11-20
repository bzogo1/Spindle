import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { loadSession } from "@/lib/auth/auth-client"

import { WorkspacesScreen } from "./workspaces-screen"

const refresh = vi.hoisted(() => vi.fn())

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/app/workspaces",
}))

vi.mock("@/lib/auth/auth-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/auth-client")>()
  return { ...actual, loadSession: vi.fn(async () => null) }
})

const workspaces = [
  { id: "ws-1", name: "Personal workspace", slug: "personal", role: "owner", active: true },
  { id: "ws-2", name: "Research team", slug: "research-team", role: "member", active: false },
]

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  refresh.mockReset()
  vi.mocked(loadSession).mockClear()
  vi.stubGlobal("fetch", fetchMock)
})

describe("WorkspacesScreen", () => {
  it("lists memberships with role, active badge, and workspace links", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, workspaces }))

    render(<WorkspacesScreen />)

    expect(await screen.findByText("Personal workspace")).toBeInTheDocument()
    expect(screen.getByText("personal")).toBeInTheDocument()
    expect(screen.getByText("research-team")).toBeInTheDocument()
    expect(screen.getByText("Active")).toBeInTheDocument()
    expect(screen.getByText("owner")).toBeInTheDocument()
    expect(screen.getByText("member")).toBeInTheDocument()
    expect(screen.getByText("Current workspace")).toBeInTheDocument()

    expect(screen.getByRole("link", { name: "Create workspace" })).toHaveAttribute(
      "href",
      "/app/workspaces/new",
    )
    // One settings/members/audit/billing link set per workspace row.
    expect(screen.getAllByRole("link", { name: "Settings" })).toHaveLength(2)
    expect(screen.getAllByRole("link", { name: "Members" })).toHaveLength(2)
    expect(screen.getAllByRole("link", { name: "Audit" })).toHaveLength(2)
    expect(screen.getAllByRole("link", { name: "Billing" })).toHaveLength(2)
    expect(screen.getAllByRole("link", { name: "Billing" })[1]).toHaveAttribute(
      "href",
      "/app/workspaces/ws-2/billing",
    )
    expect(screen.getAllByRole("link", { name: "Settings" })[1]).toHaveAttribute(
      "href",
      "/app/workspaces/ws-2/settings",
    )
  })

  it("switches the active workspace and refreshes the session", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/workspaces" && (!init || init.method === undefined)) {
        return Promise.resolve(jsonResponse({ ok: true, workspaces }))
      }
      if (url === "/api/workspaces/ws-2/switch" && init?.method === "POST") {
        return Promise.resolve(jsonResponse({ ok: true }))
      }
      return Promise.resolve(jsonResponse({ ok: false, message: "Unexpected" }, 500))
    })

    render(<WorkspacesScreen />)

    const switchButton = await screen.findByRole("button", { name: "Switch" })
    await userEvent.click(switchButton)

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/workspaces/ws-2/switch",
        expect.objectContaining({ method: "POST" }),
      ),
    )
    await waitFor(() => expect(loadSession).toHaveBeenCalled())
    expect(refresh).toHaveBeenCalled()
    // The active row now shows the switched workspace.
    expect(await screen.findByText("Active")).toBeInTheDocument()
  })

  it("shows an error state with retry when the list fails to load", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, message: "Boom" }, 500))

    render(<WorkspacesScreen />)

    expect(await screen.findByText("Boom")).toBeInTheDocument()
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, workspaces }))
    await userEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(await screen.findByText("Research team")).toBeInTheDocument()
  })

  it("shows the empty state when the user has no workspaces", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, workspaces: [] }))

    render(<WorkspacesScreen />)

    expect(await screen.findByText("No workspaces yet")).toBeInTheDocument()
  })
})
