// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { authenticateScimToken, createScimToken, resetScimTokensForTests } from "@/lib/scim-tokens"
import { listWorkspaceEvents, resetWorkspaceAuditForTests } from "@/lib/workspace-audit"

import { DELETE } from "./route"

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
function call(wsId: string, tokenId: string, options: { cookie?: string; origin?: string } = {}) {
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.5.0.${++ipCounter}`,
  }
  if (options.cookie) headers.cookie = `${ACCESS_COOKIE}=${options.cookie}`
  if (options.origin) headers.origin = options.origin
  const request = new Request(`http://localhost/api/workspaces/${wsId}/scim-tokens/${tokenId}`, {
    method: "DELETE",
    headers,
  })
  const params = Promise.resolve({ id: wsId, tokenId })
  return DELETE(request, { params })
}

beforeEach(() => {
  getUserById.mockReset().mockResolvedValue(user)
  listWorkspaceMemberships.mockReset().mockResolvedValue([membershipFor("owner")])
  resetScimTokensForTests()
  resetWorkspaceAuditForTests()
})

describe("DELETE /api/workspaces/[id]/scim-tokens/[tokenId]", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const token = createScimToken("ws-1")
    const response = await call("ws-1", token.id)
    expect(response.status).toBe(401)
    expect(authenticateScimToken(token.token)).not.toBeNull()
  })

  it("rejects cross-origin requests before auth", async () => {
    const token = createScimToken("ws-1")
    const response = await call("ws-1", token.id, {
      origin: "https://evil.example.com",
      cookie: cookieFor(),
    })
    expect(response.status).toBe(403)
    expect(authenticateScimToken(token.token)).not.toBeNull()
  })

  it("rejects plain members with 403", async () => {
    listWorkspaceMemberships.mockResolvedValue([membershipFor("member")])
    const token = createScimToken("ws-1")
    const response = await call("ws-1", token.id, { cookie: cookieFor() })
    expect(response.status).toBe(403)
    expect(authenticateScimToken(token.token)).not.toBeNull()
  })

  it("revokes the token so it can no longer authenticate", async () => {
    const token = createScimToken("ws-1", "Okta")

    const response = await call("ws-1", token.id, { cookie: cookieFor() })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true })
    expect(authenticateScimToken(token.token)).toBeNull()

    const events = listWorkspaceEvents("ws-1").events
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: "workspace.scim_token_revoked",
      actorId: user.id,
      details: { tokenId: token.id },
    })
  })

  it("returns 404 for unknown or foreign token ids", async () => {
    const foreign = createScimToken("ws-2")
    const response = await call("ws-1", foreign.id, { cookie: cookieFor() })
    expect(response.status).toBe(404)
    // The foreign workspace's token is untouched.
    expect(authenticateScimToken(foreign.token)).not.toBeNull()
  })
})
