import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { WorkspaceMembersScreen } from "./members-screen"

const ada = {
  id: "user-1",
  name: "Ada Lovelace",
  email: "ada@example.com",
  role: "owner",
  joinedAt: "2026-01-01T00:00:00.000Z",
}
const grace = {
  id: "user-2",
  name: "Grace Hopper",
  email: "grace@example.com",
  role: "member",
  joinedAt: "2026-02-01T00:00:00.000Z",
}
const alan = {
  id: "user-3",
  name: null,
  email: "alan@example.com",
  role: "admin",
  joinedAt: "2026-03-01T00:00:00.000Z",
}

function membersPayload(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    role: "owner",
    userId: "user-1",
    canManage: true,
    members: [ada, grace, alan],
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const fetchMock = vi.fn()

function mockFetch(handlers: {
  get?: () => Response | Promise<Response>
  patch?: (url: string, init?: RequestInit) => Response | Promise<Response>
  delete?: (url: string, init?: RequestInit) => Response | Promise<Response>
}) {
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    if (method === "PATCH" && handlers.patch) return handlers.patch(url, init)
    if (method === "DELETE" && handlers.delete) return handlers.delete(url, init)
    if (method === "GET" && handlers.get) return handlers.get()
    return Promise.resolve(jsonResponse({ ok: false, message: "Unexpected" }, 500))
  })
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

async function renderLoaded() {
  render(<WorkspaceMembersScreen workspaceId="ws-1" />)
  await screen.findByText("ada@example.com")
}

describe("WorkspaceMembersScreen", () => {
  it("loads the roster and renders member rows for an owner", async () => {
    mockFetch({ get: () => jsonResponse(membersPayload()) })
    await renderLoaded()

    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument()
    expect(screen.getByText("grace@example.com")).toBeInTheDocument()
    expect(screen.getByText("alan@example.com")).toBeInTheDocument()
    expect(screen.getByText("3 members")).toBeInTheDocument()
    // The caller's own row is marked and never offers self-management.
    expect(screen.getByText("You")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Change role for Ada Lovelace" }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Remove Ada Lovelace" })).not.toBeInTheDocument()
    // Other rows do offer controls.
    expect(screen.getByRole("button", { name: "Change role for Grace Hopper" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Remove Grace Hopper" })).toBeInTheDocument()
  })

  it("renders a read-only roster for plain members", async () => {
    mockFetch({
      get: () =>
        jsonResponse(membersPayload({ role: "member", userId: "user-2", canManage: false })),
    })
    render(<WorkspaceMembersScreen workspaceId="ws-1" />)
    await screen.findByText("ada@example.com")

    expect(screen.getByText(/read-only/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Change role for/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Remove / })).not.toBeInTheDocument()
  })

  it("applies a routine role change directly via PATCH", async () => {
    const user = userEvent.setup()
    mockFetch({
      get: () => jsonResponse(membersPayload()),
      patch: (url, init) => {
        expect(url).toBe("/api/workspaces/ws-1/members/user-2")
        expect(init?.body).toBe(JSON.stringify({ role: "admin" }))
        return jsonResponse({
          ok: true,
          member: { ...grace, role: "admin" },
        })
      },
    })
    await renderLoaded()

    await user.click(screen.getByRole("button", { name: "Change role for Grace Hopper" }))
    await user.click(screen.getByRole("menuitem", { name: "Admin" }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/workspaces/ws-1/members/user-2",
        expect.objectContaining({ method: "PATCH" }),
      ),
    )
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Change role for Grace Hopper" }),
      ).toHaveTextContent("Admin"),
    )
  })

  it("requires confirmation before demoting a privileged member", async () => {
    const user = userEvent.setup()
    let patched = false
    mockFetch({
      get: () => jsonResponse(membersPayload()),
      patch: () => {
        patched = true
        return jsonResponse({ ok: true, member: { ...alan, role: "member" } })
      },
    })
    await renderLoaded()

    await user.click(screen.getByRole("button", { name: "Change role for alan@example.com" }))
    await user.click(screen.getByRole("menuitem", { name: "Member" }))

    // The dialog appears and nothing is sent until it is confirmed.
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("Change role?")).toBeInTheDocument()
    expect(patched).toBe(false)

    await user.click(within(dialog).getByRole("button", { name: "Change role" }))

    await waitFor(() => expect(patched).toBe(true))
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Change role for alan@example.com" }),
      ).toHaveTextContent("Member"),
    )
  })

  it("removes a member after confirmation via DELETE", async () => {
    const user = userEvent.setup()
    let deleted = false
    mockFetch({
      get: () => jsonResponse(membersPayload()),
      delete: (url) => {
        expect(url).toBe("/api/workspaces/ws-1/members/user-2")
        deleted = true
        return jsonResponse({ ok: true, removed: true, memberId: "user-2" })
      },
    })
    await renderLoaded()

    await user.click(screen.getByRole("button", { name: "Remove Grace Hopper" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("Remove member?")).toBeInTheDocument()
    expect(deleted).toBe(false)

    await user.click(within(dialog).getByRole("button", { name: "Remove member" }))

    await waitFor(() => expect(deleted).toBe(true))
    await waitFor(() => expect(screen.queryByText("grace@example.com")).not.toBeInTheDocument())
  })

  it("shows an error state with retry when loading fails", async () => {
    mockFetch({ get: () => jsonResponse({ ok: false, message: "Boom" }, 500) })
    render(<WorkspaceMembersScreen workspaceId="ws-1" />)

    expect(await screen.findByText("Boom")).toBeInTheDocument()
    mockFetch({ get: () => jsonResponse(membersPayload()) })
    await userEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(await screen.findByText("ada@example.com")).toBeInTheDocument()
  })
})
