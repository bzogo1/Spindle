// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { listWorkspaceEvents, resetWorkspaceAuditForTests } from "@/lib/workspace-audit"
import { getWorkspaceDomain, resetWorkspaceDomainsForTests } from "@/lib/workspace-domains"

import { DELETE, GET, POST, PUT } from "./route"

const getUserById = vi.hoisted(() => vi.fn())
const listWorkspaceMemberships = vi.hoisted(() => vi.fn())
const getWorkspace = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({
      getUserById,
      listWorkspaceMemberships,
      getWorkspace,
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

function membershipFor(role: "owner" | "admin" | "member", id = "ws-1") {
  return { workspace: { ...workspace, id }, role }
}

function cookieFor(uid = user.id) {
  return createAccessToken({ sid: "s1", uid, email: user.email, name: user.name }).token
}

let ipCounter = 0
function call(
  method: "GET" | "PUT" | "DELETE" | "POST",
  id: string,
  options: { cookie?: string; origin?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = {
    // Distinct IP per call: the routes are rate limited per IP.
    "x-forwarded-for": `10.2.0.${++ipCounter}`,
  }
  if (options.cookie) headers.cookie = `${ACCESS_COOKIE}=${options.cookie}`
  if (options.origin) headers.origin = options.origin
  const init: RequestInit = { method, headers }
  if (options.body !== undefined) {
    headers["content-type"] = "application/json"
    init.body = JSON.stringify(options.body)
  }
  const request = new Request(`http://localhost/api/workspaces/${id}/domain`, init)
  const params = Promise.resolve({ id })
  switch (method) {
    case "GET":
      return GET(request, { params })
    case "PUT":
      return PUT(request, { params })
    case "DELETE":
      return DELETE(request, { params })
    case "POST":
      return POST(request, { params })
  }
}

beforeEach(() => {
  getUserById.mockReset()
  listWorkspaceMemberships.mockReset()
  getWorkspace.mockReset()
  resetWorkspaceDomainsForTests()
  resetWorkspaceAuditForTests()

  getUserById.mockResolvedValue(user)
  getWorkspace.mockResolvedValue(workspace)
})

describe("GET /api/workspaces/[id]/domain", () => {
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

  it("returns domain: null for members and owners when unset", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("member")])
    const response = await call("GET", "ws-1", { cookie: cookieFor() })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, role: "member", domain: null })
  })

  it("hides verificationToken from members but shows it to owner/admin", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])
    await call("PUT", "ws-1", { cookie: cookieFor(), body: { domain: "app.example.com" } })

    listWorkspaceMemberships.mockResolvedValue([membershipFor("member")])
    const memberRes = await call("GET", "ws-1", { cookie: cookieFor() })
    const memberBody = await memberRes.json()
    expect(memberBody.role).toBe("member")
    expect(memberBody.domain).toMatchObject({
      domain: "app.example.com",
      status: "pending",
      verifiedAt: null,
    })
    expect(memberBody.domain.verificationToken).toBeUndefined()

    listWorkspaceMemberships.mockResolvedValue([membershipFor("admin")])
    const adminRes = await call("GET", "ws-1", { cookie: cookieFor() })
    const adminBody = await adminRes.json()
    expect(adminBody.domain.verificationToken).toBe(getWorkspaceDomain("ws-1")!.verificationToken)
  })
})

describe("PUT /api/workspaces/[id]/domain", () => {
  it("rejects cross-origin requests before auth", async () => {
    const response = await call("PUT", "ws-1", {
      origin: "https://evil.example.com",
      cookie: cookieFor(),
      body: { domain: "app.example.com" },
    })
    expect(response.status).toBe(403)
    expect(getUserById).not.toHaveBeenCalled()
  })

  it("rejects members with 403", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("member")])
    const response = await call("PUT", "ws-1", {
      cookie: cookieFor(),
      body: { domain: "app.example.com" },
    })
    expect(response.status).toBe(403)
    expect(getWorkspaceDomain("ws-1")).toBeNull()
  })

  it("rejects invalid domains with 400", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])
    const response = await call("PUT", "ws-1", {
      cookie: cookieFor(),
      body: { domain: "https://app.example.com" },
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, code: "invalid_input" })
  })

  it("sets the domain, returns the record with token, and emits workspace.domain_updated", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("admin")])
    const response = await call("PUT", "ws-1", {
      cookie: cookieFor(),
      body: { domain: "APP.Example.com" },
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.domain).toMatchObject({ domain: "app.example.com", status: "pending" })
    expect(body.domain.verificationToken).toBeTruthy()

    const events = listWorkspaceEvents("ws-1").events
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: "workspace.domain_updated",
      actorId: user.id,
      details: { domain: "app.example.com", status: "pending" },
    })
  })

  it("returns 409 when another workspace claimed the domain", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("owner", "ws-2")])
    await call("PUT", "ws-2", { cookie: cookieFor(), body: { domain: "taken.example.com" } })

    listWorkspaceMemberships.mockResolvedValue([membershipFor("owner", "ws-1")])
    getWorkspace.mockImplementation((id: string) =>
      Promise.resolve(id === "ws-1" ? workspace : { ...workspace, id: "ws-2" }),
    )
    const response = await call("PUT", "ws-1", {
      cookie: cookieFor(),
      body: { domain: "taken.example.com" },
    })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ ok: false, code: "domain_unavailable" })
  })
})

describe("POST /api/workspaces/[id]/domain", () => {
  it("rejects cross-origin and member requests", async () => {
    const crossOrigin = await call("POST", "ws-1", {
      origin: "https://evil.example.com",
      cookie: cookieFor(),
      body: { action: "verify", token: "x" },
    })
    expect(crossOrigin.status).toBe(403)

    listWorkspaceMemberships.mockResolvedValue([membershipFor("member")])
    const memberRes = await call("POST", "ws-1", {
      cookie: cookieFor(),
      body: { action: "verify", token: "x" },
    })
    expect(memberRes.status).toBe(403)
  })

  it("rejects malformed bodies", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])
    for (const body of [{ action: "verify" }, { action: "delete", token: "x" }, { token: "x" }]) {
      const response = await call("POST", "ws-1", { cookie: cookieFor(), body })
      expect(response.status).toBe(400)
    }
  })

  it("verifies with the correct token and emits workspace.domain_verified", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])
    await call("PUT", "ws-1", { cookie: cookieFor(), body: { domain: "app.example.com" } })
    const token = getWorkspaceDomain("ws-1")!.verificationToken

    const response = await call("POST", "ws-1", {
      cookie: cookieFor(),
      body: { action: "verify", token },
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.domain.status).toBe("verified")
    expect(body.domain.verifiedAt).toBeTruthy()

    const events = listWorkspaceEvents("ws-1").events
    expect(events.map((e) => e.type)).toContain("workspace.domain_verified")
  })

  it("does not emit duplicate workspace.domain_verified events on repeat verify calls", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])
    await call("PUT", "ws-1", { cookie: cookieFor(), body: { domain: "app.example.com" } })
    const token = getWorkspaceDomain("ws-1")!.verificationToken

    const first = await call("POST", "ws-1", {
      cookie: cookieFor(),
      body: { action: "verify", token },
    })
    expect(first.status).toBe(200)
    // A second verify (any token — verified records short-circuit) must not
    // write another audit event.
    const second = await call("POST", "ws-1", {
      cookie: cookieFor(),
      body: { action: "verify", token: "anything" },
    })
    expect(second.status).toBe(200)
    expect((await second.json()).domain.status).toBe("verified")

    const events = listWorkspaceEvents("ws-1").events.filter(
      (e) => e.type === "workspace.domain_verified",
    )
    expect(events).toHaveLength(1)
  })

  it("rejects verification tokens longer than 256 chars", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])
    await call("PUT", "ws-1", { cookie: cookieFor(), body: { domain: "app.example.com" } })

    const response = await call("POST", "ws-1", {
      cookie: cookieFor(),
      body: { action: "verify", token: "x".repeat(257) },
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, code: "invalid_input" })
  })

  it("returns 400 on a wrong token", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])
    await call("PUT", "ws-1", { cookie: cookieFor(), body: { domain: "app.example.com" } })

    const response = await call("POST", "ws-1", {
      cookie: cookieFor(),
      body: { action: "verify", token: "wrong" },
    })
    expect(response.status).toBe(400)
    expect(getWorkspaceDomain("ws-1")!.status).toBe("pending")
  })
})

describe("DELETE /api/workspaces/[id]/domain", () => {
  it("rejects members and removes the domain for owners", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])
    await call("PUT", "ws-1", { cookie: cookieFor(), body: { domain: "app.example.com" } })

    listWorkspaceMemberships.mockResolvedValue([membershipFor("member")])
    const memberRes = await call("DELETE", "ws-1", { cookie: cookieFor() })
    expect(memberRes.status).toBe(403)
    expect(getWorkspaceDomain("ws-1")).not.toBeNull()

    listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])
    const response = await call("DELETE", "ws-1", { cookie: cookieFor() })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, removed: true })
    expect(getWorkspaceDomain("ws-1")).toBeNull()

    const events = listWorkspaceEvents("ws-1").events
    expect(events.map((e) => e.type)).toContain("workspace.domain_removed")
    expect(events.find((e) => e.type === "workspace.domain_removed")!.details).toMatchObject({
      domain: "app.example.com",
    })
  })

  it("returns removed:false when no domain is configured", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])
    const response = await call("DELETE", "ws-1", { cookie: cookieFor() })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, removed: false })
  })
})
