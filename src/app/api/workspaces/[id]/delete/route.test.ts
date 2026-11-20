// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { listWorkspaceEvents, resetWorkspaceAuditForTests } from "@/lib/workspace-audit"

import { POST } from "./route"

const getUserById = vi.hoisted(() => vi.fn())
const listWorkspaceMemberships = vi.hoisted(() => vi.fn())
const getWorkspace = vi.hoisted(() => vi.fn())
const deleteWorkspace = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({
      getUserById,
      listWorkspaceMemberships,
      getWorkspace,
      deleteWorkspace,
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
function call(id: string, options: { cookie?: string; origin?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {
    // Distinct IP per call: the route is rate limited per IP.
    "x-forwarded-for": `10.2.0.${++ipCounter}`,
  }
  if (options.cookie) headers.cookie = `${ACCESS_COOKIE}=${options.cookie}`
  if (options.origin) headers.origin = options.origin
  const init: RequestInit = { method: "POST", headers }
  if (options.body !== undefined) {
    headers["content-type"] = "application/json"
    init.body = JSON.stringify(options.body)
  }
  const request = new Request(`http://localhost/api/workspaces/${id}/delete`, init)
  const params = Promise.resolve({ id })
  return POST(request, { params })
}

beforeEach(() => {
  getUserById.mockReset()
  listWorkspaceMemberships.mockReset()
  getWorkspace.mockReset()
  deleteWorkspace.mockReset()
  resetWorkspaceAuditForTests()

  getUserById.mockResolvedValue(user)
  getWorkspace.mockResolvedValue(workspace)
  deleteWorkspace.mockResolvedValue(true)
})

describe("POST /api/workspaces/[id]/delete", () => {
  it("rejects cross-origin requests before auth", async () => {
    const response = await call("ws-1", {
      origin: "https://evil.example.com",
      cookie: cookieFor(),
      body: { confirmation: "Research team" },
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
    expect(getUserById).not.toHaveBeenCalled()
  })

  it("rejects unauthenticated requests with 401", async () => {
    const response = await call("ws-1", { body: { confirmation: "Research team" } })
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthorized" })
    expect(deleteWorkspace).not.toHaveBeenCalled()
  })

  it("rejects a malformed body with 400", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])
    const response = await call("ws-1", { cookie: cookieFor(), body: { confirmation: "" } })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, code: "invalid_input" })
    expect(deleteWorkspace).not.toHaveBeenCalled()
  })

  it("rejects non-owners with 403", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("admin")])
    const response = await call("ws-1", {
      cookie: cookieFor(),
      body: { confirmation: "Research team" },
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
    expect(deleteWorkspace).not.toHaveBeenCalled()
  })

  it("returns 404 for an unknown workspace", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])
    getWorkspace.mockResolvedValue(null)
    const response = await call("ws-1", {
      cookie: cookieFor(),
      body: { confirmation: "Research team" },
    })
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ ok: false, code: "not_found" })
    expect(deleteWorkspace).not.toHaveBeenCalled()
  })

  it("rejects a mismatched confirmation with 400", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])
    const response = await call("ws-1", {
      cookie: cookieFor(),
      body: { confirmation: "research team" },
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, code: "invalid_input" })
    expect(deleteWorkspace).not.toHaveBeenCalled()
  })

  it("deletes the workspace, records workspace.deleted, and returns ok", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])

    const response = await call("ws-1", {
      cookie: cookieFor(),
      body: { confirmation: "Research team" },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, deleted: true })
    expect(deleteWorkspace).toHaveBeenCalledWith(user.id, "ws-1")

    const events = listWorkspaceEvents("ws-1").events
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: "workspace.deleted",
      actorId: user.id,
      details: { name: "Research team", slug: "research-team" },
    })
  })

  it("returns 403 and records no event when the backend denies deletion", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])
    deleteWorkspace.mockResolvedValue(false)

    const response = await call("ws-1", {
      cookie: cookieFor(),
      body: { confirmation: "Research team" },
    })
    expect(response.status).toBe(403)
    expect(listWorkspaceEvents("ws-1").events).toHaveLength(0)
  })
})
