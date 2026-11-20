// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"

import { GET } from "./route"

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: { user: { findMany: mocks.findMany } },
}))

const getUserById = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ getUserById }),
  }
})

const adminUser = {
  id: "admin-1",
  email: "admin@example.com",
  name: "Admin",
  emailVerified: true,
  createdAt: new Date().toISOString(),
}

const directoryRow = {
  id: "u1",
  email: "ada@example.com",
  name: "Ada",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
}

function cookieFor(email: string, uid = `uid-${email}`) {
  return createAccessToken({ sid: "s1", uid, email, name: "T" }).token
}

let ipCounter = 0

function get(query = "", cookie?: string) {
  ipCounter += 1
  const headers: Record<string, string> = { "x-forwarded-for": `10.9.0.${ipCounter}` }
  if (cookie) headers.cookie = `${ACCESS_COOKIE}=${cookie}`
  return GET(new Request(`http://localhost/api/admin/users${query}`, { headers }))
}

beforeEach(() => {
  mocks.findMany.mockReset()
  getUserById.mockReset()
  setAdminEmailsForTests(["admin@example.com"])
})

afterEach(() => {
  setAdminEmailsForTests(null)
})

describe("GET /api/admin/users", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await get()
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthorized" })
    expect(mocks.findMany).not.toHaveBeenCalled()
  })

  it("rejects a signed-in non-admin with 403", async () => {
    getUserById.mockResolvedValue({ ...adminUser, id: "u9", email: "user@example.com" })
    const response = await get("", cookieFor("user@example.com", "u9"))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
    expect(mocks.findMany).not.toHaveBeenCalled()
  })

  it("lists users for an admin with serialized fields and admin flags", async () => {
    getUserById.mockResolvedValue(adminUser)
    mocks.findMany.mockResolvedValue([
      directoryRow,
      { ...directoryRow, id: "u2", email: "admin@example.com" },
    ])

    const response = await get("", cookieFor("admin@example.com", "admin-1"))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.users).toHaveLength(2)
    expect(body.users[0]).toMatchObject({
      id: "u1",
      email: "ada@example.com",
      name: "Ada",
      admin: false,
    })
    expect(body.users[0].createdAt).toBe("2026-01-01T00:00:00.000Z")
    expect(body.users[1].admin).toBe(true)
    expect(body.nextCursor).toBeNull()
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 51, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
    )
  })

  it("passes the search query through as a case-insensitive email/name filter", async () => {
    getUserById.mockResolvedValue(adminUser)
    mocks.findMany.mockResolvedValue([])

    await get("?q=Ada", cookieFor("admin@example.com", "admin-1"))
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              OR: [
                { email: { contains: "Ada", mode: "insensitive" } },
                { name: { contains: "Ada", mode: "insensitive" } },
              ],
            },
          ],
        },
      }),
    )
  })

  it("escapes LIKE wildcards in the search query", async () => {
    getUserById.mockResolvedValue(adminUser)
    mocks.findMany.mockResolvedValue([])

    await get("?q=%25_%5C", cookieFor("admin@example.com", "admin-1"))
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              OR: [
                { email: { contains: "\\%\\_\\\\", mode: "insensitive" } },
                { name: { contains: "\\%\\_\\\\", mode: "insensitive" } },
              ],
            },
          ],
        },
      }),
    )
  })

  it("rejects an invalid order param", async () => {
    getUserById.mockResolvedValue(adminUser)
    const response = await get("?order=sideways", cookieFor("admin@example.com", "admin-1"))
    expect(response.status).toBe(400)
    expect(mocks.findMany).not.toHaveBeenCalled()
  })

  it("treats a malformed cursor as the first page", async () => {
    getUserById.mockResolvedValue(adminUser)
    mocks.findMany.mockResolvedValue([])
    const response = await get("?cursor=not-a-cursor", cookieFor("admin@example.com", "admin-1"))
    expect(response.status).toBe(200)
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: undefined }))
  })

  it("returns 500 when the query fails", async () => {
    getUserById.mockResolvedValue(adminUser)
    mocks.findMany.mockRejectedValue(new Error("db down"))
    const response = await get("", cookieFor("admin@example.com", "admin-1"))
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ ok: false, code: "internal" })
  })
})
