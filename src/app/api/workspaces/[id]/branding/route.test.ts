// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { listWorkspaceEvents, resetWorkspaceAuditForTests } from "@/lib/workspace-audit"
import { getWorkspaceBranding, resetWorkspaceBrandingForTests } from "@/lib/workspace-branding"

import { GET, PATCH } from "./route"

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
  method: "GET" | "PATCH",
  id: string,
  options: { cookie?: string; origin?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.4.0.${++ipCounter}`,
  }
  if (options.cookie) headers.cookie = `${ACCESS_COOKIE}=${options.cookie}`
  if (options.origin) headers.origin = options.origin
  const init: RequestInit = { method, headers }
  if (options.body !== undefined) {
    headers["content-type"] = "application/json"
    init.body = JSON.stringify(options.body)
  }
  const request = new Request(`http://localhost/api/workspaces/${id}/branding`, init)
  const params = Promise.resolve({ id })
  return method === "GET" ? GET(request, { params }) : PATCH(request, { params })
}

beforeEach(() => {
  getUserById.mockReset()
  listWorkspaceMemberships.mockReset()
  resetWorkspaceBrandingForTests()
  resetWorkspaceAuditForTests()

  getUserById.mockResolvedValue(user)
})

describe("GET /api/workspaces/[id]/branding", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await call("GET", "ws-1")
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthorized" })
  })

  it("rejects members with 403 (owner/admin only)", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("member")])
    const response = await call("GET", "ws-1", { cookie: cookieFor() })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
  })

  it("returns null branding for an unconfigured owner workspace", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])
    const response = await call("GET", "ws-1", { cookie: cookieFor() })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ ok: true, role: "owner", branding: null })
  })
})

describe("PATCH /api/workspaces/[id]/branding", () => {
  it("rejects cross-origin requests before auth", async () => {
    const response = await call("PATCH", "ws-1", {
      origin: "https://evil.example.com",
      cookie: cookieFor(),
      body: { accentColor: "#112233" },
    })
    expect(response.status).toBe(403)
    expect(getUserById).not.toHaveBeenCalled()
  })

  it("rejects members with 403", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("member")])
    const response = await call("PATCH", "ws-1", {
      cookie: cookieFor(),
      body: { accentColor: "#112233" },
    })
    expect(response.status).toBe(403)
    expect(getWorkspaceBranding("ws-1")).toBeNull()
  })

  it("rejects invalid bodies: bad color, bad URL, unknown keys, empty", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])

    const badColor = await call("PATCH", "ws-1", {
      cookie: cookieFor(),
      body: { accentColor: "blue" },
    })
    expect(badColor.status).toBe(400)

    const badUrl = await call("PATCH", "ws-1", {
      cookie: cookieFor(),
      body: { logoUrl: "javascript:alert(1)" },
    })
    expect(badUrl.status).toBe(400)

    const unknown = await call("PATCH", "ws-1", {
      cookie: cookieFor(),
      body: { workspaceSlug: "hijack" },
    })
    expect(unknown.status).toBe(400)

    const empty = await call("PATCH", "ws-1", { cookie: cookieFor(), body: {} })
    expect(empty.status).toBe(400)
  })

  it("stores branding with slug/name bookkeeping and emits workspace.branding_updated", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("admin")])

    const response = await call("PATCH", "ws-1", {
      cookie: cookieFor(),
      body: {
        displayName: "Research Team",
        logoText: "RT",
        logoUrl: "https://cdn.example.com/rt.png",
        accentColor: "#336699",
      },
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.branding).toMatchObject({
      displayName: "Research Team",
      logoText: "RT",
      accentColor: "#336699",
      workspaceSlug: "research-team",
      workspaceName: "Research team",
    })

    const stored = getWorkspaceBranding("ws-1")
    expect(stored?.workspaceSlug).toBe("research-team")

    const events = listWorkspaceEvents("ws-1").events
    expect(events.map((e) => e.type)).toContain("workspace.branding_updated")
    expect(events.every((e) => e.actorId === user.id)).toBe(true)
  })
})
