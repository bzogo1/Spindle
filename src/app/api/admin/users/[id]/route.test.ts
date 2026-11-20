// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"

import { GET, PATCH } from "./route"

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: { user: { findUnique: mocks.findUnique, update: mocks.update } },
}))

const getUserById = vi.hoisted(() => vi.fn())
const isTotpEnabled = vi.hoisted(() => vi.fn())
const listSessions = vi.hoisted(() => vi.fn())
const listWorkspaceMemberships = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({
      getUserById,
      isTotpEnabled,
      listSessions,
      listWorkspaceMemberships,
    }),
  }
})

const adminUser = {
  id: "admin-1",
  email: "admin@example.com",
  name: "Admin",
  emailVerified: true,
  createdAt: new Date().toISOString(),
}

const directoryUser = {
  id: "u1",
  email: "ada@example.com",
  name: "Ada",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
}

function cookieFor(email: string, uid = `uid-${email}`) {
  return createAccessToken({ sid: "s1", uid, email, name: "T" }).token
}

function adminCookie() {
  return cookieFor("admin@example.com", "admin-1")
}

function context(id: string) {
  return { params: Promise.resolve({ id }) }
}

function get(id: string, cookie?: string) {
  const headers: Record<string, string> = {}
  if (cookie) headers.cookie = `${ACCESS_COOKIE}=${cookie}`
  return GET(new Request(`http://localhost/api/admin/users/${id}`, { headers }), context(id))
}

function patch(id: string, body: unknown, cookie?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (cookie) headers.cookie = `${ACCESS_COOKIE}=${cookie}`
  return PATCH(
    new Request(`http://localhost/api/admin/users/${id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(body),
    }),
    context(id),
  )
}

beforeEach(() => {
  mocks.findUnique.mockReset()
  mocks.update.mockReset()
  getUserById.mockReset().mockResolvedValue(adminUser)
  isTotpEnabled.mockReset().mockResolvedValue(false)
  listSessions.mockReset().mockResolvedValue([])
  listWorkspaceMemberships.mockReset().mockResolvedValue([])
  setAdminEmailsForTests(["admin@example.com"])
})

afterEach(() => {
  setAdminEmailsForTests(null)
})

describe("GET /api/admin/users/[id]", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await get("u1")
    expect(response.status).toBe(401)
    expect(mocks.findUnique).not.toHaveBeenCalled()
  })

  it("rejects a signed-in non-admin with 403", async () => {
    getUserById.mockResolvedValue({ ...adminUser, id: "u9", email: "user@example.com" })
    const response = await get("u1", cookieFor("user@example.com", "u9"))
    expect(response.status).toBe(403)
    expect(mocks.findUnique).not.toHaveBeenCalled()
  })

  it("returns the user with auth enrichment when the id resolves", async () => {
    mocks.findUnique.mockResolvedValue(directoryUser)
    getUserById.mockImplementation(async (id: string) =>
      id === "admin-1"
        ? adminUser
        : {
            id,
            email: "ada@example.com",
            name: "Ada",
            emailVerified: true,
            createdAt: directoryUser.createdAt.toISOString(),
          },
    )
    isTotpEnabled.mockResolvedValue(true)
    listSessions.mockResolvedValue([{ id: "s", createdAt: "", expiresAt: "" }])
    listWorkspaceMemberships.mockResolvedValue([
      { workspace: { id: "w1", name: "Acme", slug: "acme" }, role: "member" },
    ])

    const response = await get("u1", adminCookie())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.user).toMatchObject({ id: "u1", email: "ada@example.com", admin: false })
    expect(body.auth).toMatchObject({
      emailVerified: true,
      totpEnabled: true,
      activeSessionCount: 1,
      memberships: [{ workspace: "Acme", role: "member" }],
    })
  })

  it("returns auth: null when the id does not resolve in the auth backend", async () => {
    mocks.findUnique.mockResolvedValue(directoryUser)
    // Admin check needs a resolvable caller — use a token whose uid the
    // backend knows, then the detail id stays unresolved.
    getUserById.mockImplementation(async (id: string) => (id === "admin-1" ? adminUser : null))
    const response = await get("u1", adminCookie())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.user.id).toBe("u1")
    expect(body.auth).toBeNull()
  })

  it("returns 404 for an unknown user", async () => {
    mocks.findUnique.mockResolvedValue(null)
    const response = await get("missing", adminCookie())
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ ok: false, code: "not_found" })
  })
})

describe("PATCH /api/admin/users/[id]", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await patch("u1", { name: "Ada" })
    expect(response.status).toBe(401)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("rejects a signed-in non-admin with 403", async () => {
    getUserById.mockResolvedValue({ ...adminUser, id: "u9", email: "user@example.com" })
    const response = await patch("u1", { name: "Ada" }, cookieFor("user@example.com", "u9"))
    expect(response.status).toBe(403)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("updates the display name", async () => {
    mocks.findUnique.mockResolvedValue({ id: "u1" })
    mocks.update.mockResolvedValue({ ...directoryUser, name: "Ada Lovelace" })

    const response = await patch("u1", { name: "  Ada Lovelace  " }, adminCookie())
    expect(response.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "u1" },
        data: { name: "Ada Lovelace" },
      }),
    )
    const body = await response.json()
    expect(body.user.name).toBe("Ada Lovelace")
  })

  it("clears the name when null is sent", async () => {
    mocks.findUnique.mockResolvedValue({ id: "u1" })
    mocks.update.mockResolvedValue({ ...directoryUser, name: null })

    const response = await patch("u1", { name: null }, adminCookie())
    expect(response.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: { name: null } }))
  })

  it("rejects invalid names", async () => {
    for (const body of [
      { name: "" },
      { name: "   " },
      { name: "x".repeat(121) },
      { name: 42 },
      {},
    ]) {
      const response = await patch("u1", body, adminCookie())
      expect(response.status).toBe(400)
    }
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("returns 404 when patching an unknown user", async () => {
    mocks.findUnique.mockResolvedValue(null)
    const response = await patch("missing", { name: "Ada" }, adminCookie())
    expect(response.status).toBe(404)
  })

  it("returns 400 for a non-JSON body", async () => {
    const headers: Record<string, string> = {
      cookie: `${ACCESS_COOKIE}=${adminCookie()}`,
    }
    const response = await PATCH(
      new Request("http://localhost/api/admin/users/u1", {
        method: "PATCH",
        headers,
        body: "not json",
      }),
      context("u1"),
    )
    expect(response.status).toBe(400)
  })
})
