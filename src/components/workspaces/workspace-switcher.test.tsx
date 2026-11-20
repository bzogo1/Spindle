import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { loadSession } from "@/lib/auth/auth-client"

import { WorkspaceSwitcher } from "./workspace-switcher"

const refresh = vi.hoisted(() => vi.fn())

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/dashboard",
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

describe("WorkspaceSwitcher", () => {
  it("renders nothing while the workspace list is empty or fails to load", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, workspaces: [] }))
    const { container, unmount } = render(<WorkspaceSwitcher />)
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/workspaces", expect.anything()),
    )
    expect(container).toBeEmptyDOMElement()
    unmount()

    fetchMock.mockRejectedValue(new Error("offline"))
    const { container: container2 } = render(<WorkspaceSwitcher />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(container2).toBeEmptyDOMElement()
  })

  it("shows the active workspace and switches on select", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/workspaces" && (!init || init.method === undefined)) {
        return Promise.resolve(jsonResponse({ ok: true, workspaces }))
      }
      if (url === "/api/workspaces/ws-2/switch" && init?.method === "POST") {
        return Promise.resolve(
          jsonResponse({
            ok: true,
            workspace: { id: "ws-2", name: "Research team", slug: "research-team", role: "member" },
          }),
        )
      }
      return Promise.resolve(jsonResponse({ ok: false, message: "Unexpected" }, 500))
    })

    render(<WorkspaceSwitcher />)

    const trigger = await screen.findByRole("button", {
      name: "Switch workspace — Personal workspace",
    })
    expect(trigger).toHaveTextContent("Personal workspace")

    await userEvent.click(trigger)

    const researchItem = await screen.findByRole("menuitem", { name: /Research team/ })
    expect(researchItem).toHaveTextContent("member")
    await userEvent.click(researchItem)

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/workspaces/ws-2/switch",
        expect.objectContaining({ method: "POST" }),
      ),
    )
    await waitFor(() => expect(loadSession).toHaveBeenCalled())
    expect(refresh).toHaveBeenCalled()
  })

  it("keeps the current workspace when the switch request fails", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/workspaces" && (!init || init.method === undefined)) {
        return Promise.resolve(jsonResponse({ ok: true, workspaces }))
      }
      return Promise.resolve(jsonResponse({ ok: false, message: "Not a member." }, 403))
    })

    render(<WorkspaceSwitcher />)
    await userEvent.click(
      await screen.findByRole("button", { name: "Switch workspace — Personal workspace" }),
    )
    await userEvent.click(await screen.findByRole("menuitem", { name: /Research team/ }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/workspaces/ws-2/switch",
        expect.objectContaining({ method: "POST" }),
      ),
    )
    expect(loadSession).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })
})
