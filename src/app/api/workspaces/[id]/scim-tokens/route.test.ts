// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { createScimToken, listScimTokens, resetScimTokensForTests } from "@/lib/scim-tokens"
import { listWorkspaceEvents, resetWorkspaceAuditForTests } from "@/lib/workspace-audit"

import { GET, POST } from "./route"

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

function cookieFor() {
  return createAccessToken({ sid: "s1", uid: user.id, email: user.email, name: user.name }).token
}

let ipCounter = 0
function call(
  method: "GET" | "POST",
  id: string,
  options: { cookie?: string; origin?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.6.0.${++ipCounter}`,
  }
  if (options.cookie) headers.cookie = `${ACCESS_COOKIE}=${options.cookie}`
  if (options.origin) headers.origin = options.origin
  const init: RequestInit = { method, headers }
  if (options.body !== undefined) {
    headers["content-type"] = "application/json"
    init.body = JSON.stringify(options.body)
  }
  const request = new Request(`http://localhost/api/workspaces/${id}/scim-tokens`, init)
  const params = Promise.resolve({ id })
  return method === "GET" ? GET(request, { params }) : POST(request, { params })
}

beforeEach(() => {
  getUserById.mockReset().mockResolvedValue(user)
  listWorkspaceMemberships.mockReset()
  resetScimTokensForTests()
  resetWorkspaceAuditForTests()
})

describe("GET /api/workspaces/[id]/scim-tokens", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await call("GET", "ws-1")
    expect(response.status).toBe(401)
  })

  it("rejects plain members with 403", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("member")])
    const response = await call("GET", "ws-1", { cookie: cookieFor() })
    expect(response.status).toBe(403)
  })

  it("lists token metadata for owner/admin, newest first, no secrets", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("admin")])
    const first = createScimToken("ws-1", "first")
    createScimToken("ws-1", "second")

    const response = await call("GET", "ws-1", { cookie: cookieFor() })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.tokens).toHaveLength(2)
    expect(body.tokens[0].label).toBe("second")
    expect(body.tokens[1].id).toBe(first.id)
    expect(JSON.stringify(body)).not.toContain(first.token)
  })
})

describe("POST /api/workspaces/[id]/scim-tokens", () => {
  it("rejects cross-origin requests before auth", async () => {
    const response = await call("POST", "ws-1", {
      origin: "https://evil.example.com",
      cookie: cookieFor(),
      body: {},
    })
    expect(response.status).toBe(403)
    expect(getUserById).not.toHaveBeenCalled()
  })

  it("rejects members with 403", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("member")])
    const response = await call("POST", "ws-1", { cookie: cookieFor(), body: {} })
    expect(response.status).toBe(403)
    expect(listScimTokens("ws-1")).toHaveLength(0)
  })

  it("rejects invalid bodies", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])
    const bad = await call("POST", "ws-1", {
      cookie: cookieFor(),
      body: { label: "x".repeat(81) },
    })
    expect(bad.status).toBe(400)

    const unknown = await call("POST", "ws-1", {
      cookie: cookieFor(),
      body: { nope: true },
    })
    expect(unknown.status).toBe(400)
  })

  it("creates a token, returns plaintext once, and audits it", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("admin")])

    const response = await call("POST", "ws-1", {
      cookie: cookieFor(),
      body: { label: "Okta prod" },
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.token.token).toMatch(/^spim_/)
    expect(body.token.label).toBe("Okta prod")
    expect(body.token.workspaceId).toBe("ws-1")

    // Plaintext is shown once: the list never contains it.
    const listed = await call("GET", "ws-1", { cookie: cookieFor() })
    expect(JSON.stringify(await listed.json())).not.toContain(body.token.token)

    const events = listWorkspaceEvents("ws-1").events
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: "workspace.scim_token_created",
      actorId: user.id,
      details: { tokenId: body.token.id, label: "Okta prod" },
    })
    expect(JSON.stringify(events[0].details)).not.toContain(body.token.token)
  })

  it("accepts an empty body", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("owner")])
    const response = await call("POST", "ws-1", { cookie: cookieFor(), body: {} })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.token.label).toBeNull()
  })
})
