// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"

import { GET } from "./route"

const getUserById = vi.hoisted(() => vi.fn())
const listWorkspaceMemberships = vi.hoisted(() => vi.fn())
const listWorkspaceMembers = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({
      getUserById,
      listWorkspaceMemberships,
      listWorkspaceMembers,
    }),
  }
})

const user = {
  id: "user-1",
  email: "ada@example.com",
  name: "Ada",
  emailVerified: true,
  createdAt: "2026-01-01T00:00:00.000Z",
}

const workspace = { id: "ws-1", name: "Research team", slug: "research-team" }

const otherUser = {
  id: "user-2",
  email: "grace@example.com",
  name: "Grace",
  emailVerified: true,
  createdAt: "2026-02-01T00:00:00.000Z",
}

function membershipFor(role: "owner" | "admin" | "member") {
  return { workspace, role }
}

function cookieFor(uid = user.id) {
  return createAccessToken({ sid: "s1", uid, email: user.email, name: user.name }).token
}

let ipCounter = 0
function call(id: string, options: { cookie?: string } = {}) {
  const headers: Record<string, string> = {
    // Distinct IP per call: the route is rate limited per IP.
    "x-forwarded-for": `10.2.0.${++ipCounter}`,
  }
  if (options.cookie) headers.cookie = `${ACCESS_COOKIE}=${options.cookie}`
  const request = new Request(`http://localhost/api/workspaces/${id}/members`, { headers })
  return GET(request, { params: Promise.resolve({ id }) })
}

beforeEach(() => {
  getUserById.mockReset()
  listWorkspaceMemberships.mockReset()
  listWorkspaceMembers.mockReset()

  getUserById.mockResolvedValue(user)
  listWorkspaceMembers.mockResolvedValue([
    { user, role: "owner" },
    { user: otherUser, role: "member" },
  ])
})

describe("GET /api/workspaces/[id]/members", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await call("ws-1")
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthorized" })
    expect(listWorkspaceMembers).not.toHaveBeenCalled()
  })

  it("returns 403 when the caller is not a member", async () => {
    listWorkspaceMemberships.mockResolvedValue([])
    const response = await call("ws-1", { cookie: cookieFor() })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
  })

  it("returns the roster, caller role, and canManage for an owner", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])
    const response = await call("ws-1", { cookie: cookieFor() })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      role: "owner",
      userId: "user-1",
      canManage: true,
      members: [
        {
          id: "user-1",
          name: "Ada",
          email: "ada@example.com",
          role: "owner",
          joinedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "user-2",
          name: "Grace",
          email: "grace@example.com",
          role: "member",
          joinedAt: "2026-02-01T00:00:00.000Z",
        },
      ],
    })
  })

  it("reports canManage false for a plain member", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("member")])
    const response = await call("ws-1", { cookie: cookieFor() })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ ok: true, role: "member", canManage: false })
    expect(body.members).toHaveLength(2)
  })
})
