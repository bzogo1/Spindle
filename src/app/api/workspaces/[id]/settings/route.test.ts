// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { listWorkspaceEvents, resetWorkspaceAuditForTests } from "@/lib/workspace-audit"
import {
  getWorkspaceSettings,
  resetWorkspaceSettingsForTests,
  updateWorkspaceSettings,
} from "@/lib/workspace-settings"

import { GET, PATCH, PUT } from "./route"

const getUserById = vi.hoisted(() => vi.fn())
const listWorkspaceMemberships = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ getUserById, listWorkspaceMemberships }),
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
  method: "GET" | "PUT" | "PATCH",
  id: string,
  options: { cookie?: string; origin?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.2.0.${++ipCounter}`,
  }
  if (options.cookie) headers.cookie = `${ACCESS_COOKIE}=${options.cookie}`
  if (options.origin) headers.origin = options.origin
  const init: RequestInit = { method, headers }
  if (options.body !== undefined) {
    headers["content-type"] = "application/json"
    init.body = JSON.stringify(options.body)
  }
  const request = new Request(`http://localhost/api/workspaces/${id}/settings`, init)
  const params = Promise.resolve({ id })
  if (method === "GET") return GET(request, { params })
  if (method === "PUT") return PUT(request, { params })
  return PATCH(request, { params })
}

beforeEach(() => {
  getUserById.mockReset()
  listWorkspaceMemberships.mockReset()
  resetWorkspaceSettingsForTests()
  resetWorkspaceAuditForTests()

  getUserById.mockResolvedValue(user)
})

describe("GET /api/workspaces/[id]/settings", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await call("GET", "ws-1")
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthorized" })
  })

  it("returns current settings to any member", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("member")])
    updateWorkspaceSettings("ws-1", {
      allowMemberInvites: true,
      defaultJoinRole: "admin",
      displayLabel: "Acme",
    })
    const response = await call("GET", "ws-1", { cookie: cookieFor() })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      settings: {
        allowMemberInvites: true,
        defaultJoinRole: "admin",
        displayLabel: "Acme",
      },
    })
  })
})

describe("PUT/PATCH /api/workspaces/[id]/settings", () => {
  it("rejects cross-origin requests before auth", async () => {
    const response = await call("PUT", "ws-1", {
      origin: "https://evil.example.com",
      cookie: cookieFor(),
      body: { allowMemberInvites: true },
    })
    expect(response.status).toBe(403)
    expect(getUserById).not.toHaveBeenCalled()
  })

  it("rejects members with 403", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("member")])
    for (const method of ["PUT", "PATCH"] as const) {
      const response = await call(method, "ws-1", {
        cookie: cookieFor(),
        body: { allowMemberInvites: true },
      })
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
    }
    expect(getWorkspaceSettings("ws-1").allowMemberInvites).toBe(false)
  })

  it("rejects invalid and empty bodies", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])
    const bad = await call("PATCH", "ws-1", {
      cookie: cookieFor(),
      body: { displayLabel: "x".repeat(41) },
    })
    expect(bad.status).toBe(400)

    const empty = await call("PATCH", "ws-1", { cookie: cookieFor(), body: {} })
    expect(empty.status).toBe(400)
  })

  it("applies a partial update via PUT and records an audit event", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("admin")])

    const response = await call("PUT", "ws-1", {
      cookie: cookieFor(),
      body: { allowMemberInvites: true },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      settings: {
        allowMemberInvites: true,
        defaultJoinRole: "member",
        displayLabel: "",
      },
    })

    const events = listWorkspaceEvents("ws-1").events
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: "workspace.settings_updated",
      actorId: user.id,
    })
  })

  it("applies a partial update via PATCH", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])

    const response = await call("PATCH", "ws-1", {
      cookie: cookieFor(),
      body: { defaultJoinRole: "admin", displayLabel: "Acme" },
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.settings).toMatchObject({
      defaultJoinRole: "admin",
      displayLabel: "Acme",
      allowMemberInvites: false,
    })
  })
})
