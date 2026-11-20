// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { listWorkspaceEvents, resetWorkspaceAuditForTests } from "@/lib/workspace-audit"
import {
  getWorkspaceSsoConfig,
  resetWorkspaceSsoForTests,
  SSO_URL_MASK_SUFFIX,
} from "@/lib/workspace-sso"

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
    "x-forwarded-for": `10.3.0.${++ipCounter}`,
  }
  if (options.cookie) headers.cookie = `${ACCESS_COOKIE}=${options.cookie}`
  if (options.origin) headers.origin = options.origin
  const init: RequestInit = { method, headers }
  if (options.body !== undefined) {
    headers["content-type"] = "application/json"
    init.body = JSON.stringify(options.body)
  }
  const request = new Request(`http://localhost/api/workspaces/${id}/sso`, init)
  const params = Promise.resolve({ id })
  if (method === "GET") return GET(request, { params })
  if (method === "PUT") return PUT(request, { params })
  return PATCH(request, { params })
}

beforeEach(() => {
  getUserById.mockReset()
  listWorkspaceMemberships.mockReset()
  resetWorkspaceSsoForTests()
  resetWorkspaceAuditForTests()

  getUserById.mockResolvedValue(user)
})

describe("GET /api/workspaces/[id]/sso", () => {
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

  it("returns masked defaults to an owner", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])
    const response = await call("GET", "ws-1", { cookie: cookieFor() })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      ok: true,
      role: "owner",
      config: {
        enabled: false,
        provider: "none",
        entityId: "",
        ssoUrl: "",
        enforced: false,
        allowedDomains: [],
      },
    })
  })

  it("masks stored endpoint URLs in the response", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("admin")])
    await call("PATCH", "ws-1", {
      cookie: cookieFor(),
      body: {
        enabled: true,
        provider: "saml",
        entityId: "https://idp.example.com/tenant/entity",
        ssoUrl: "https://idp.example.com/tenant/sso",
      },
    })
    const response = await call("GET", "ws-1", { cookie: cookieFor() })
    const body = await response.json()
    expect(body.config.entityId).toBe(`https://idp.example.com${SSO_URL_MASK_SUFFIX}`)
    expect(body.config.ssoUrl).toBe(`https://idp.example.com${SSO_URL_MASK_SUFFIX}`)
    // Stored value keeps the full path.
    expect(getWorkspaceSsoConfig("ws-1").ssoUrl).toBe("https://idp.example.com/tenant/sso")
  })
})

describe("PUT/PATCH /api/workspaces/[id]/sso", () => {
  it("rejects cross-origin requests before auth", async () => {
    const response = await call("PUT", "ws-1", {
      origin: "https://evil.example.com",
      cookie: cookieFor(),
      body: { enabled: true },
    })
    expect(response.status).toBe(403)
    expect(getUserById).not.toHaveBeenCalled()
  })

  it("rejects members with 403", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("member")])
    for (const method of ["PUT", "PATCH"] as const) {
      const response = await call(method, "ws-1", {
        cookie: cookieFor(),
        body: { enabled: true },
      })
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
    }
    expect(getWorkspaceSsoConfig("ws-1").enabled).toBe(false)
  })

  it("rejects invalid and empty bodies", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])
    const badUrl = await call("PATCH", "ws-1", {
      cookie: cookieFor(),
      body: { ssoUrl: "http://idp.example.com/sso" },
    })
    expect(badUrl.status).toBe(400)

    const badDomain = await call("PATCH", "ws-1", {
      cookie: cookieFor(),
      body: { allowedDomains: ["not a domain"] },
    })
    expect(badDomain.status).toBe(400)

    const unknown = await call("PATCH", "ws-1", {
      cookie: cookieFor(),
      body: { privateKey: "secret" },
    })
    expect(unknown.status).toBe(400)

    const empty = await call("PATCH", "ws-1", { cookie: cookieFor(), body: {} })
    expect(empty.status).toBe(400)
  })

  it("applies a partial update via PUT and records audit events", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("admin")])

    const response = await call("PUT", "ws-1", {
      cookie: cookieFor(),
      body: {
        enabled: true,
        provider: "oidc",
        entityId: "https://idp.example.com",
        ssoUrl: "https://idp.example.com/authorize",
        enforced: true,
        allowedDomains: ["example.com"],
      },
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.config).toMatchObject({
      enabled: true,
      provider: "oidc",
      enforced: true,
      allowedDomains: ["example.com"],
    })

    const events = listWorkspaceEvents("ws-1").events
    const types = events.map((event) => event.type)
    expect(types).toContain("workspace.sso_config_updated")
    expect(types).toContain("workspace.sso_enabled")
    expect(events.every((event) => event.actorId === user.id)).toBe(true)
  })

  it("records sso_disabled when enabled flips back to false", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])
    await call("PATCH", "ws-1", { cookie: cookieFor(), body: { enabled: true, provider: "saml" } })
    resetWorkspaceAuditForTests()

    const response = await call("PATCH", "ws-1", {
      cookie: cookieFor(),
      body: { enabled: false },
    })
    expect(response.status).toBe(200)

    const types = listWorkspaceEvents("ws-1").events.map((event) => event.type)
    expect(types).toContain("workspace.sso_config_updated")
    expect(types).toContain("workspace.sso_disabled")
    expect(types).not.toContain("workspace.sso_enabled")
  })

  it("does not emit enable/disable events for non-transition updates", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])
    const response = await call("PATCH", "ws-1", {
      cookie: cookieFor(),
      body: { allowedDomains: ["example.com"] },
    })
    expect(response.status).toBe(200)
    const types = listWorkspaceEvents("ws-1").events.map((event) => event.type)
    expect(types).toEqual(["workspace.sso_config_updated"])
  })
})
