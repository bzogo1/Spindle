// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"

import { POST } from "./route"

const getUserById = vi.hoisted(() => vi.fn())
const switchWorkspace = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ getUserById, switchWorkspace }),
  }
})

const user = {
  id: "user-1",
  email: "ada@example.com",
  name: "Ada",
  emailVerified: true,
  createdAt: "2026-01-01T00:00:00.000Z",
}

const membership = {
  workspace: { id: "ws-2", name: "Research team", slug: "research-team" },
  role: "member",
}

function cookieFor(uid = user.id) {
  return createAccessToken({ sid: "s1", uid, email: user.email, name: user.name }).token
}

let ipCounter = 0
function post(id: string, options: { cookie?: string; origin?: string } = {}) {
  const headers: Record<string, string> = {
    // Distinct IP per call: the route is rate limited per IP.
    "x-forwarded-for": `10.0.0.${++ipCounter}`,
  }
  if (options.cookie) headers.cookie = `${ACCESS_COOKIE}=${options.cookie}`
  if (options.origin) headers.origin = options.origin
  return POST(
    new Request(`http://localhost/api/workspaces/${id}/switch`, {
      method: "POST",
      headers,
    }),
    { params: Promise.resolve({ id }) },
  )
}

beforeEach(() => {
  getUserById.mockReset()
  switchWorkspace.mockReset()
})

describe("POST /api/workspaces/[id]/switch", () => {
  it("rejects cross-origin requests before auth", async () => {
    const response = await post("ws-2", { origin: "https://evil.example.com" })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
    expect(getUserById).not.toHaveBeenCalled()
  })

  it("rejects unauthenticated requests", async () => {
    const response = await post("ws-2")
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthorized" })
  })

  it("returns 401 when the token user no longer exists", async () => {
    getUserById.mockResolvedValueOnce(null)
    const response = await post("ws-2", { cookie: cookieFor() })
    expect(response.status).toBe(401)
  })

  it("returns 403 when the user is not a member of the workspace", async () => {
    getUserById.mockResolvedValueOnce(user)
    switchWorkspace.mockResolvedValueOnce(null)
    const response = await post("ws-9", { cookie: cookieFor() })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "forbidden",
      message: "Not a member of this workspace.",
    })
    expect(switchWorkspace).toHaveBeenCalledWith(user.id, "ws-9")
  })

  it("switches the session workspace and returns the membership", async () => {
    getUserById.mockResolvedValueOnce(user)
    switchWorkspace.mockResolvedValueOnce(membership)
    const response = await post("ws-2", { cookie: cookieFor() })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      workspace: {
        id: "ws-2",
        name: "Research team",
        slug: "research-team",
        role: "member",
      },
    })
    expect(switchWorkspace).toHaveBeenCalledWith(user.id, "ws-2")
  })
})
