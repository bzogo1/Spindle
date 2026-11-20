import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { UsersScreen, type AdminUserRow } from "./users-screen"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const USERS: AdminUserRow[] = [
  {
    id: "u1",
    email: "ada@example.com",
    name: "Ada",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    admin: false,
  },
  {
    id: "u2",
    email: "admin@example.com",
    name: null,
    createdAt: "2026-01-03T00:00:00.000Z",
    updatedAt: "2026-01-03T00:00:00.000Z",
    admin: true,
  },
]

function usersBody(users: AdminUserRow[] = USERS, nextCursor: string | null = null) {
  return { ok: true, users, nextCursor, pageSize: 50 }
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("UsersScreen", () => {
  it("shows a loading state then renders the user table", async () => {
    fetchMock.mockResolvedValue(jsonResponse(usersBody()))
    render(<UsersScreen />)

    expect(screen.getByText("Loading users")).toBeInTheDocument()
    expect(await screen.findByText("ada@example.com")).toBeInTheDocument()
    expect(screen.getByText("admin@example.com")).toBeInTheDocument()
    expect(screen.getByText("Ada")).toBeInTheDocument()
    expect(screen.getByText("Admin")).toBeInTheDocument() // badge on u2
    // Row links point at the detail route.
    expect(screen.getByRole("link", { name: "ada@example.com" })).toHaveAttribute(
      "href",
      "/app/admin/users/u1",
    )
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/admin/users?"),
      expect.objectContaining({ cache: "no-store" }),
    )
  })

  it("shows the empty state when there are no users", async () => {
    fetchMock.mockResolvedValue(jsonResponse(usersBody([])))
    render(<UsersScreen />)
    expect(await screen.findByText("No users yet")).toBeInTheDocument()
  })

  it("shows an error state with retry on failure", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, message: "Nope" }, 500))
    render(<UsersScreen />)

    expect(await screen.findByText("Users unavailable")).toBeInTheDocument()
    expect(screen.getByText("Nope")).toBeInTheDocument()
    // The empty state must not render alongside the error.
    expect(screen.queryByText("No users yet")).not.toBeInTheDocument()

    fetchMock.mockResolvedValue(jsonResponse(usersBody()))
    await userEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(await screen.findByText("ada@example.com")).toBeInTheDocument()
  })

  it("debounces search input into a new request with q=", async () => {
    fetchMock.mockResolvedValue(jsonResponse(usersBody()))
    render(<UsersScreen />)
    await screen.findByText("ada@example.com")

    fetchMock.mockClear()
    fetchMock.mockResolvedValue(jsonResponse(usersBody([USERS[0]])))
    await userEvent.type(screen.getByLabelText("Search users"), "ada")

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("q=ada"), expect.anything())
    })
    await waitFor(() => {
      expect(screen.queryByText("admin@example.com")).not.toBeInTheDocument()
    })
  })

  it("loads the next page via the cursor when Load more is clicked", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(usersBody([USERS[0]], "cursor-1")))
      .mockResolvedValueOnce(jsonResponse(usersBody([USERS[1]])))
    render(<UsersScreen />)
    await screen.findByText("ada@example.com")

    await userEvent.click(screen.getByRole("button", { name: "Load more" }))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        expect.stringContaining("cursor=cursor-1"),
        expect.anything(),
      )
    })
    expect(await screen.findByText("admin@example.com")).toBeInTheDocument()
    // Second page had no cursor → button gone.
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument()
  })
})
