// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { listWorkspaceEvents, resetWorkspaceAuditForTests } from "@/lib/workspace-audit"
import { getWorkspaceSettings, resetWorkspaceSettingsForTests } from "@/lib/workspace-settings"

import { GET, PATCH } from "./route"

const getUserById = vi.hoisted(() => vi.fn())
const listWorkspaceMemberships = vi.hoisted(() => vi.fn())
const getWorkspace = vi.hoisted(() => vi.fn())
const listWorkspaceMembers = vi.hoisted(() => vi.fn())
const updateWorkspace = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({
      getUserById,
      listWorkspaceMemberships,
      getWorkspace,
      listWorkspaceMembers,
      updateWorkspace,
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

function membershipFor(role: "owner" | "admin" | "member") {
  return { workspace, role }
}

function cookieFor(uid = user.id) {
  return createAccessToken({ sid: "s1", uid, email: user.email, name: user.name }).token
}

let ipCounter = 0
function call(
  method: "GET" | "PATCH",
  id: string,
  options: { cookie?: string; origin?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = {
    // Distinct IP per call: the routes are rate limited per IP.
    "x-forwarded-for": `10.1.0.${++ipCounter}`,
  }
  if (options.cookie) headers.cookie = `${ACCESS_COOKIE}=${options.cookie}`
  if (options.origin) headers.origin = options.origin
  const init: RequestInit = { method, headers }
  if (options.body !== undefined) {
    headers["content-type"] = "application/json"
    init.body = JSON.stringify(options.body)
  }
  const request = new Request(`http://localhost/api/workspaces/${id}`, init)
  const params = Promise.resolve({ id })
  return method === "GET" ? GET(request, { params }) : PATCH(request, { params })
}

beforeEach(() => {
  getUserById.mockReset()
  listWorkspaceMemberships.mockReset()
  getWorkspace.mockReset()
  listWorkspaceMembers.mockReset()
  updateWorkspace.mockReset()
  resetWorkspaceSettingsForTests()
  resetWorkspaceAuditForTests()

  getUserById.mockResolvedValue(user)
  getWorkspace.mockResolvedValue(workspace)
  listWorkspaceMembers.mockResolvedValue([
    { user, role: "owner" },
    { user: { ...user, id: "user-2" }, role: "member" },
  ])
})

describe("GET /api/workspaces/[id]", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await call("GET", "ws-1")
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthorized" })
    expect(getWorkspace).not.toHaveBeenCalled()
  })

  it("returns 403 when the caller is not a member", async () => {
    listWorkspaceMemberships.mockResolvedValue([])
    const response = await call("GET", "ws-1", { cookie: cookieFor() })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
  })

  it("returns workspace info, role, member count, and default settings", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("member")])
    const response = await call("GET", "ws-1", { cookie: cookieFor() })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      workspace: { id: "ws-1", name: "Research team", slug: "research-team" },
      role: "member",
      memberCount: 2,
      settings: {
        allowMemberInvites: false,
        defaultJoinRole: "member",
        displayLabel: "",
      },
    })
  })
})

describe("PATCH /api/workspaces/[id]", () => {
  it("rejects cross-origin requests before auth", async () => {
    const response = await call("PATCH", "ws-1", {
      origin: "https://evil.example.com",
      cookie: cookieFor(),
      body: { name: "New name" },
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
    expect(getUserById).not.toHaveBeenCalled()
  })

  it("rejects unauthenticated requests", async () => {
    const response = await call("PATCH", "ws-1", { body: { name: "New name" } })
    expect(response.status).toBe(401)
  })

  it("rejects members with 403", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("member")])
    const response = await call("PATCH", "ws-1", {
      cookie: cookieFor(),
      body: { name: "New name" },
    })
    expect(response.status).toBe(403)
    expect(updateWorkspace).not.toHaveBeenCalled()
  })

  it("rejects an empty patch", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])
    const response = await call("PATCH", "ws-1", { cookie: cookieFor(), body: {} })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, code: "invalid_input" })
  })

  it("rejects invalid input", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])
    const response = await call("PATCH", "ws-1", {
      cookie: cookieFor(),
      body: { name: "   " },
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, code: "invalid_input" })
  })

  it("renames the workspace and records a workspace.renamed event", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("admin")])
    updateWorkspace.mockResolvedValue({ ...workspace, name: "New name", slug: "new-name" })

    const response = await call("PATCH", "ws-1", {
      cookie: cookieFor(),
      body: { name: "New name" },
    })

    expect(response.status).toBe(200)
    expect(updateWorkspace).toHaveBeenCalledWith(user.id, "ws-1", { name: "New name" })
    const body = await response.json()
    expect(body).toMatchObject({
      ok: true,
      workspace: { id: "ws-1", name: "New name", slug: "new-name" },
      role: "admin",
    })

    const events = listWorkspaceEvents("ws-1").events
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: "workspace.renamed",
      actorId: user.id,
      details: { from: "Research team", to: "New name" },
    })
  })

  it("returns 403 when the backend denies the rename", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])
    updateWorkspace.mockResolvedValue(null)

    const response = await call("PATCH", "ws-1", {
      cookie: cookieFor(),
      body: { name: "New name" },
    })
    expect(response.status).toBe(403)
    expect(listWorkspaceEvents("ws-1").events).toHaveLength(0)
  })

  it("updates settings and records a workspace.settings_updated event", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])

    const response = await call("PATCH", "ws-1", {
      cookie: cookieFor(),
      body: { settings: { allowMemberInvites: true, defaultJoinRole: "admin" } },
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.settings).toEqual({
      allowMemberInvites: true,
      defaultJoinRole: "admin",
      displayLabel: "",
    })
    expect(getWorkspaceSettings("ws-1")).toEqual(body.settings)

    const events = listWorkspaceEvents("ws-1").events
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: "workspace.settings_updated",
      actorId: user.id,
    })
  })

  it("applies name and settings together", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])
    updateWorkspace.mockResolvedValue({ ...workspace, name: "Renamed", slug: "renamed" })

    const response = await call("PATCH", "ws-1", {
      cookie: cookieFor(),
      body: { name: "Renamed", settings: { displayLabel: "Acme" } },
    })

    expect(response.status).toBe(200)
    const types = listWorkspaceEvents("ws-1")
      .events.map((event) => event.type)
      .sort()
    expect(types).toEqual(["workspace.renamed", "workspace.settings_updated"])
  })

  it("rejects unknown settings keys", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])
    const response = await call("PATCH", "ws-1", {
      cookie: cookieFor(),
      body: { settings: { evil: true } },
    })
    expect(response.status).toBe(400)
  })
})
