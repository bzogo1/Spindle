// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { listWorkspaceEvents, resetWorkspaceAuditForTests } from "@/lib/workspace-audit"

import { DELETE, PATCH } from "./route"

const getUserById = vi.hoisted(() => vi.fn())
const listWorkspaceMemberships = vi.hoisted(() => vi.fn())
const listWorkspaceMembers = vi.hoisted(() => vi.fn())
const setWorkspaceMemberRole = vi.hoisted(() => vi.fn())
const kickWorkspaceMember = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({
      getUserById,
      listWorkspaceMemberships,
      listWorkspaceMembers,
      setWorkspaceMemberRole,
      kickWorkspaceMember,
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

const otherUser = {
  id: "user-2",
  email: "grace@example.com",
  name: "Grace",
  emailVerified: true,
  createdAt: "2026-02-01T00:00:00.000Z",
}

const workspace = { id: "ws-1", name: "Research team", slug: "research-team" }

function membershipFor(role: "owner" | "admin" | "member") {
  return { workspace, role }
}

function cookieFor(uid = user.id) {
  return createAccessToken({ sid: "s1", uid, email: user.email, name: user.name }).token
}

const roster = [
  { user, role: "owner" as const },
  { user: otherUser, role: "member" as const },
]

let ipCounter = 0
function call(
  method: "PATCH" | "DELETE",
  targetUserId: string,
  options: { cookie?: string; origin?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = {
    // Distinct IP per call: the route is rate limited per IP.
    "x-forwarded-for": `10.3.0.${++ipCounter}`,
  }
  if (options.cookie) headers.cookie = `${ACCESS_COOKIE}=${options.cookie}`
  if (options.origin) headers.origin = options.origin
  const init: RequestInit = { method, headers }
  if (options.body !== undefined) {
    headers["content-type"] = "application/json"
    init.body = JSON.stringify(options.body)
  }
  const request = new Request(`http://localhost/api/workspaces/ws-1/members/${targetUserId}`, init)
  const params = Promise.resolve({ id: "ws-1", userId: targetUserId })
  return method === "PATCH" ? PATCH(request, { params }) : DELETE(request, { params })
}

beforeEach(() => {
  getUserById.mockReset()
  listWorkspaceMemberships.mockReset()
  listWorkspaceMembers.mockReset()
  setWorkspaceMemberRole.mockReset()
  kickWorkspaceMember.mockReset()
  resetWorkspaceAuditForTests()

  getUserById.mockResolvedValue(user)
  listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])
  listWorkspaceMembers.mockResolvedValue(roster)
  setWorkspaceMemberRole.mockResolvedValue({ workspace, role: "admin" })
  kickWorkspaceMember.mockResolvedValue(true)
})

describe("PATCH /api/workspaces/[id]/members/[userId]", () => {
  it("rejects cross-origin requests before auth", async () => {
    const response = await call("PATCH", "user-2", {
      origin: "https://evil.example.com",
      cookie: cookieFor(),
      body: { role: "admin" },
    })
    expect(response.status).toBe(403)
    expect(getUserById).not.toHaveBeenCalled()
  })

  it("rejects unauthenticated requests with 401", async () => {
    const response = await call("PATCH", "user-2", { body: { role: "admin" } })
    expect(response.status).toBe(401)
  })

  it("rejects plain members with 403", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("member")])
    const response = await call("PATCH", "user-2", {
      cookie: cookieFor(),
      body: { role: "admin" },
    })
    expect(response.status).toBe(403)
    expect(setWorkspaceMemberRole).not.toHaveBeenCalled()
  })

  it("rejects invalid roles with 400", async () => {
    const response = await call("PATCH", "user-2", {
      cookie: cookieFor(),
      body: { role: "superuser" },
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, code: "invalid_input" })
    expect(setWorkspaceMemberRole).not.toHaveBeenCalled()
  })

  it("returns 404 for a user outside the workspace", async () => {
    const response = await call("PATCH", "user-9", {
      cookie: cookieFor(),
      body: { role: "admin" },
    })
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ ok: false, code: "not_found" })
    expect(setWorkspaceMemberRole).not.toHaveBeenCalled()
  })

  it("returns 403 when the backend denies the change", async () => {
    setWorkspaceMemberRole.mockResolvedValue(null)
    const response = await call("PATCH", "user-2", {
      cookie: cookieFor(),
      body: { role: "admin" },
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
    expect(listWorkspaceEvents("ws-1").events).toHaveLength(0)
  })

  it("changes the role and records a member.role_changed event", async () => {
    const response = await call("PATCH", "user-2", {
      cookie: cookieFor(),
      body: { role: "admin" },
    })

    expect(response.status).toBe(200)
    expect(setWorkspaceMemberRole).toHaveBeenCalledWith(user.id, "ws-1", "user-2", "admin")
    expect(await response.json()).toMatchObject({
      ok: true,
      member: { id: "user-2", email: "grace@example.com", role: "admin" },
      role: "admin",
    })

    const events = listWorkspaceEvents("ws-1").events
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: "member.role_changed",
      actorId: user.id,
      details: { targetUserId: "user-2", from: "member", to: "admin" },
    })
  })
})

describe("DELETE /api/workspaces/[id]/members/[userId]", () => {
  it("rejects cross-origin requests before auth", async () => {
    const response = await call("DELETE", "user-2", {
      origin: "https://evil.example.com",
      cookie: cookieFor(),
    })
    expect(response.status).toBe(403)
    expect(getUserById).not.toHaveBeenCalled()
  })

  it("rejects plain members with 403", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("member")])
    const response = await call("DELETE", "user-2", { cookie: cookieFor() })
    expect(response.status).toBe(403)
    expect(kickWorkspaceMember).not.toHaveBeenCalled()
  })

  it("returns 404 for a user outside the workspace", async () => {
    const response = await call("DELETE", "user-9", { cookie: cookieFor() })
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ ok: false, code: "not_found" })
    expect(kickWorkspaceMember).not.toHaveBeenCalled()
  })

  it("returns 403 when the backend denies the removal", async () => {
    kickWorkspaceMember.mockResolvedValue(false)
    const response = await call("DELETE", "user-2", { cookie: cookieFor() })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
    expect(listWorkspaceEvents("ws-1").events).toHaveLength(0)
  })

  it("removes the member and records a member.removed event", async () => {
    const response = await call("DELETE", "user-2", { cookie: cookieFor() })

    expect(response.status).toBe(200)
    expect(kickWorkspaceMember).toHaveBeenCalledWith(user.id, "ws-1", "user-2")
    expect(await response.json()).toMatchObject({ ok: true, removed: true, memberId: "user-2" })

    const events = listWorkspaceEvents("ws-1").events
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: "member.removed",
      actorId: user.id,
      details: { targetUserId: "user-2", role: "member", email: "grace@example.com" },
    })
  })
})
