// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { listWorkspaceEvents, resetWorkspaceAuditForTests } from "@/lib/workspace-audit"

import { GET } from "./route"

const getUserById = vi.hoisted(() => vi.fn())
const listWorkspaceMemberships = vi.hoisted(() => vi.fn())
const getWorkspace = vi.hoisted(() => vi.fn())
const listWorkspaceMembers = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({
      getUserById,
      listWorkspaceMemberships,
      getWorkspace,
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

function membershipFor(role: "owner" | "admin" | "member") {
  return { workspace, role }
}

function memberEntry(id: string, email: string, name: string | null, role: string) {
  return {
    user: {
      id,
      email,
      name,
      emailVerified: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    role,
  }
}

function cookieFor(uid = user.id) {
  return createAccessToken({ sid: "s1", uid, email: user.email, name: user.name }).token
}

let ipCounter = 0
function call(id: string, options: { cookie?: string } = {}) {
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.9.0.${++ipCounter}`,
  }
  if (options.cookie) headers.cookie = `${ACCESS_COOKIE}=${options.cookie}`
  const request = new Request(`http://localhost/api/workspaces/${id}/export`, { headers })
  return GET(request, { params: Promise.resolve({ id }) })
}

beforeEach(() => {
  getUserById.mockReset()
  listWorkspaceMemberships.mockReset()
  getWorkspace.mockReset()
  listWorkspaceMembers.mockReset()
  resetWorkspaceAuditForTests()

  getUserById.mockResolvedValue(user)
  getWorkspace.mockResolvedValue(workspace)
  listWorkspaceMembers.mockResolvedValue([
    memberEntry("u1", "ada@example.com", "Ada", "owner"),
    memberEntry("u2", "bob@example.com", null, "member"),
  ])
})

describe("GET /api/workspaces/[id]/export", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await call("ws-1")
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthorized" })
  })

  it("rejects plain members with 403", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("member")])
    const response = await call("ws-1", { cookie: cookieFor() })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
  })

  it("rejects non-members with 403", async () => {
    listWorkspaceMemberships.mockResolvedValue([])
    const response = await call("ws-1", { cookie: cookieFor() })
    expect(response.status).toBe(403)
  })

  it("returns the export as a JSON attachment for owners", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])

    const response = await call("ws-1", { cookie: cookieFor() })

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("application/json")
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="workspace-research-team-export.json"',
    )

    const body = await response.json()
    expect(body.workspace).toEqual({ id: "ws-1", name: "Research team", slug: "research-team" })
    expect(body.members).toHaveLength(2)
    expect(body.members[0].user).toEqual({
      id: "u1",
      email: "ada@example.com",
      name: "Ada",
    })
    expect(typeof body.exportedAt).toBe("string")

    const events = listWorkspaceEvents("ws-1").events
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: "workspace.exported",
      actorId: user.id,
      details: { memberCount: 2 },
    })
  })

  it("allows admins", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("admin")])
    const response = await call("ws-1", { cookie: cookieFor() })
    expect(response.status).toBe(200)
  })

  it("returns 404 when the workspace no longer exists", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])
    getWorkspace.mockResolvedValue(null)
    const response = await call("ws-1", { cookie: cookieFor() })
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ ok: false, code: "not_found" })
  })

  it("sanitizes the filename slug", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])
    getWorkspace.mockResolvedValue({ id: "ws-1", name: "X", slug: "Bad Slug!" })
    const response = await call("ws-1", { cookie: cookieFor() })
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="workspace-bad-slug-export.json"',
    )
  })
})
