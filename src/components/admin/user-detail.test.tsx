import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AdminUserDetail } from "./user-detail"
import type { AdminUserRow } from "./users-screen"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const USER: AdminUserRow = {
  id: "u1",
  email: "ada@example.com",
  name: "Ada",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  admin: false,
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("AdminUserDetail", () => {
  it("renders the user record and auth enrichment", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        user: USER,
        auth: {
          authUserId: "u1",
          emailVerified: true,
          totpEnabled: true,
          activeSessionCount: 2,
          memberships: [{ workspace: "Acme", role: "member" }],
        },
      }),
    )
    render(<AdminUserDetail userId="u1" />)

    expect(await screen.findByText("ada@example.com")).toBeInTheDocument()
    expect(screen.getByText("Enabled")).toBeInTheDocument() // 2FA
    expect(screen.getByText("Acme (member)")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Open in impersonation/ })).toHaveAttribute(
      "href",
      "/app/admin/impersonation",
    )
  })

  it("shows the not-found state for a missing user", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, code: "not_found" }, 404))
    render(<AdminUserDetail userId="missing" />)
    expect(await screen.findByText("User not found")).toBeInTheDocument()
  })

  it("saves an edited name via PATCH", async () => {
    fetchMock.mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return Promise.resolve(jsonResponse({ ok: true, user: { ...USER, name: "Ada L." } }))
      }
      return Promise.resolve(jsonResponse({ ok: true, user: USER, auth: null }))
    })
    render(<AdminUserDetail userId="u1" />)

    const input = await screen.findByLabelText("Display name")
    await userEvent.clear(input)
    await userEvent.type(input, "Ada L.")
    await userEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/users/u1",
        expect.objectContaining({ method: "PATCH" }),
      )
    })
    const patchCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "PATCH",
    )
    expect(JSON.parse(String((patchCall?.[1] as RequestInit).body))).toEqual({
      name: "Ada L.",
    })
    expect(await screen.findByText("Name updated.")).toBeInTheDocument()
  })
})
