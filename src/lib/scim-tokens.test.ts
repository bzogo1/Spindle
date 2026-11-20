// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest"

import {
  authenticateScimToken,
  createScimToken,
  listScimTokens,
  resetScimTokensForTests,
  revokeScimToken,
  SCIM_TOKEN_PREFIX,
} from "@/lib/scim-tokens"

beforeEach(() => {
  resetScimTokensForTests()
})

describe("createScimToken", () => {
  it("returns plaintext once with safe metadata and a spim_ prefix", () => {
    const created = createScimToken("ws-1", "Okta prod", 1_700_000_000_000)
    expect(created.token).toMatch(/^spim_[A-Za-z0-9_-]{43}$/)
    expect(created.workspaceId).toBe("ws-1")
    expect(created.label).toBe("Okta prod")
    expect(created.prefix).toBe(created.token.slice(0, SCIM_TOKEN_PREFIX.length + 8))
    expect(created.createdAt).toBe(new Date(1_700_000_000_000).toISOString())
    expect(created.lastUsedAt).toBeNull()
    // The stored record must not contain the plaintext secret.
    expect(JSON.stringify(listScimTokens("ws-1"))).not.toContain(created.token)
  })

  it("trims labels and stores null for empty ones", () => {
    expect(createScimToken("ws-1", "  ").label).toBeNull()
    expect(createScimToken("ws-1", "  Label  ").label).toBe("Label")
    expect(createScimToken("ws-1").label).toBeNull()
  })

  it("produces unique tokens", () => {
    const a = createScimToken("ws-1")
    const b = createScimToken("ws-1")
    expect(a.token).not.toBe(b.token)
    expect(a.id).not.toBe(b.id)
  })
})

describe("listScimTokens", () => {
  it("returns newest-first metadata per workspace, never secrets", () => {
    createScimToken("ws-1", "first")
    createScimToken("ws-2", "other")
    createScimToken("ws-1", "second")

    const list = listScimTokens("ws-1")
    expect(list).toHaveLength(2)
    expect(list[0].label).toBe("second")
    expect(list[1].label).toBe("first")
    expect(list.every((t) => !("token" in t))).toBe(true)
    expect(listScimTokens("ws-9")).toEqual([])
  })
})

describe("authenticateScimToken", () => {
  it("resolves a live token to its workspace and stamps lastUsedAt", () => {
    const created = createScimToken("ws-1")
    const auth = authenticateScimToken(created.token)
    expect(auth).toMatchObject({ workspaceId: "ws-1", tokenId: created.id })

    const listed = listScimTokens("ws-1").find((t) => t.id === created.id)
    expect(listed?.lastUsedAt).not.toBeNull()
  })

  it("rejects unknown, malformed, and empty tokens", () => {
    expect(authenticateScimToken("spim_bogus")).toBeNull()
    expect(authenticateScimToken("")).toBeNull()
    expect(authenticateScimToken("   ")).toBeNull()
    expect(authenticateScimToken("not-a-token")).toBeNull()
  })

  it("stops resolving after revoke", () => {
    const created = createScimToken("ws-1")
    expect(revokeScimToken("ws-1", created.id)).toBe(true)
    expect(authenticateScimToken(created.token)).toBeNull()
    expect(revokeScimToken("ws-1", created.id)).toBe(false)
  })
})

describe("revokeScimToken", () => {
  it("is workspace-scoped: foreign ids cannot be revoked", () => {
    const created = createScimToken("ws-1")
    expect(revokeScimToken("ws-2", created.id)).toBe(false)
    expect(authenticateScimToken(created.token)).not.toBeNull()
    expect(revokeScimToken("ws-1", "does-not-exist")).toBe(false)
  })
})
