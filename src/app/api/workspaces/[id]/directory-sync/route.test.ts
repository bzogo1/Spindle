// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { resetDirectorySyncForTests } from "@/lib/directory-sync"
import { resetWorkspaceAuditForTests, listWorkspaceEvents } from "@/lib/workspace-audit"

import { GET, POST } from "./route"

const getUserById = vi.hoisted(() => vi.fn())
const listWorkspaceMemberships = vi.hoisted(() => vi.fn())
const listWorkspaceMembers = vi.hoisted(() => vi.fn())
const getWorkspace = vi.hoisted(() => vi.fn())
const upsertOAuthUser = vi.hoisted(() => vi.fn())
const addWorkspaceMember = vi.hoisted(() => vi.fn())
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
      getWorkspace,
      upsertOAuthUser,
      addWorkspaceMember,
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

const workspace = { id: "ws-1", name: "Research team", slug: "research-team" }

const roster = [
  { user: { ...user, id: "u-owner", email: "owner@example.com", name: "Owner" }, role: "owner" },
  {
    user: { ...user, id: "u-member", email: "member@example.com", name: "Member" },
    role: "member",
  },
]

function membershipFor(role: "owner" | "admin" | "member") {
  return { workspace, role }
}

function cookieFor(uid = user.id) {
  return createAccessToken({ sid: "s1", uid, email: user.email, name: user.name }).token
}

let ipCounter = 0
function call(
  method: "GET" | "POST",
  id: string,
  options: { cookie?: string; origin?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.3.0.${++ipCounter}`,
  }
  if (options.cookie) headers.cookie = `${ACCESS_COOKIE}=${options.cookie}`
  if (options.origin) headers.origin = options.origin
  const init: RequestInit = { method, headers }
  if (options.body !== undefined) {
    headers["content-type"] = "application/json"
    init.body = JSON.stringify(options.body)
  }
  const request = new Request(`http://localhost/api/workspaces/${id}/directory-sync`, init)
  const params = Promise.resolve({ id })
  return method === "GET" ? GET(request, { params }) : POST(request, { params })
}

beforeEach(() => {
  for (const fn of [
    getUserById,
    listWorkspaceMemberships,
    listWorkspaceMembers,
    getWorkspace,
    upsertOAuthUser,
    addWorkspaceMember,
    setWorkspaceMemberRole,
    kickWorkspaceMember,
  ]) {
    fn.mockReset()
  }
  resetDirectorySyncForTests()
  resetWorkspaceAuditForTests()

  getUserById.mockResolvedValue(user)
  listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])
  listWorkspaceMembers.mockResolvedValue(roster)
  getWorkspace.mockResolvedValue(workspace)
  upsertOAuthUser.mockImplementation(
    async ({ email, name }: { email: string; name?: string | null }) => ({
      user: { ...user, id: `new-${email}`, email, name: name ?? email },
      created: true,
    }),
  )
  addWorkspaceMember.mockResolvedValue({ workspace, role: "member" })
  setWorkspaceMemberRole.mockResolvedValue({ workspace, role: "admin" })
  kickWorkspaceMember.mockResolvedValue(true)
})

describe("GET /api/workspaces/[id]/directory-sync", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await call("GET", "ws-1")
    expect(response.status).toBe(401)
  })

  it("returns null result before any sync", async () => {
    const response = await call("GET", "ws-1", { cookie: cookieFor() })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, result: null })
  })
})

describe("POST /api/workspaces/[id]/directory-sync", () => {
  it("rejects cross-origin requests before auth", async () => {
    const response = await call("POST", "ws-1", {
      origin: "https://evil.example.com",
      cookie: cookieFor(),
      body: { users: [] },
    })
    expect(response.status).toBe(403)
    expect(getUserById).not.toHaveBeenCalled()
  })

  it("rejects plain members with 403", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("member")])
    const response = await call("POST", "ws-1", {
      cookie: cookieFor(),
      body: { users: [{ email: "a@b.co" }] },
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
  })

  it("rejects bodies over 500 users and malformed entries", async () => {
    const tooMany = await call("POST", "ws-1", {
      cookie: cookieFor(),
      body: { users: Array.from({ length: 501 }, (_, i) => ({ email: `u${i}@x.co` })) },
    })
    expect(tooMany.status).toBe(400)

    const bad = await call("POST", "ws-1", {
      cookie: cookieFor(),
      body: { users: [{ email: 42 }] },
    })
    expect(bad.status).toBe(400)
  })

  it("dryRun returns the plan without mutating the roster", async () => {
    const response = await call("POST", "ws-1", {
      cookie: cookieFor(),
      body: {
        dryRun: true,
        users: [
          { email: "owner@example.com" },
          { email: "member@example.com", role: "admin" },
          { email: "new@example.com", name: "New" },
        ],
      },
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.plan.toAdd).toEqual([{ email: "new@example.com", name: "New", role: "member" }])
    expect(body.plan.toUpdate).toHaveLength(1)
    expect(body.plan.toUpdate[0].to.role).toBe("admin")
    expect(body.result.dryRun).toBe(true)
    expect(body.result.applied).toBe(false)
    expect(body.result.outcome).toBeNull()

    expect(upsertOAuthUser).not.toHaveBeenCalled()
    expect(addWorkspaceMember).not.toHaveBeenCalled()
    expect(setWorkspaceMemberRole).not.toHaveBeenCalled()
    expect(kickWorkspaceMember).not.toHaveBeenCalled()
    expect(listWorkspaceEvents("ws-1").events).toHaveLength(0)
  })

  it("applies the plan, records an audit event, and stores the result", async () => {
    const response = await call("POST", "ws-1", {
      cookie: cookieFor(),
      body: {
        removeAbsent: true,
        users: [
          { email: "owner@example.com" },
          { email: "member@example.com", role: "admin" },
          { email: "new@example.com", name: "New" },
        ],
      },
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.result.applied).toBe(true)
    expect(body.result.outcome).toMatchObject({ added: 1, updated: 1, removed: 0, failed: [] })

    expect(upsertOAuthUser).toHaveBeenCalledWith({
      email: "new@example.com",
      name: "New",
      provider: "directory",
    })
    expect(addWorkspaceMember).toHaveBeenCalledWith({
      userId: "new-new@example.com",
      workspace,
      role: "member",
    })
    expect(setWorkspaceMemberRole).toHaveBeenCalledWith(user.id, "ws-1", "u-member", "admin")

    const events = listWorkspaceEvents("ws-1").events
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: "directory_sync.applied", actorId: user.id })
  })

  it("does not count name-only updates in outcome.updated", async () => {
    const response = await call("POST", "ws-1", {
      cookie: cookieFor(),
      body: { users: [{ email: "member@example.com", name: "Renamed" }] },
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    // The plan still reports the diff, but no backend mutation exists for
    // display names, so outcome.updated must stay 0.
    expect(body.plan.toUpdate).toHaveLength(1)
    expect(body.result.outcome).toMatchObject({ added: 0, updated: 0, removed: 0, failed: [] })
    expect(setWorkspaceMemberRole).not.toHaveBeenCalled()
  })

  it("removes absent members when removeAbsent is set and apply runs", async () => {
    const response = await call("POST", "ws-1", {
      cookie: cookieFor(),
      body: {
        removeAbsent: true,
        users: [{ email: "owner@example.com" }, { email: "new@example.com" }],
      },
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.plan.toRemove).toEqual([{ userId: "u-member", email: "member@example.com" }])
    expect(body.result.outcome.removed).toBe(1)
    expect(kickWorkspaceMember).toHaveBeenCalledWith(user.id, "ws-1", "u-member")
  })

  it("collects per-item failures into outcome.failed", async () => {
    kickWorkspaceMember.mockResolvedValue(false)
    const response = await call("POST", "ws-1", {
      cookie: cookieFor(),
      body: {
        removeAbsent: true,
        users: [{ email: "owner@example.com" }],
      },
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.result.outcome.removed).toBe(0)
    expect(body.result.outcome.failed).toEqual([
      { email: "member@example.com", reason: "removal denied by workspace permissions" },
    ])
  })

  it("GET returns the stored result after a sync", async () => {
    await call("POST", "ws-1", {
      cookie: cookieFor(),
      body: { users: [{ email: "owner@example.com" }] },
    })

    const response = await call("GET", "ws-1", { cookie: cookieFor() })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.result).not.toBeNull()
    expect(body.result.applied).toBe(true)
    expect(body.result.plan).toBeDefined()
  })
})
