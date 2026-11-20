// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { clearBetaAccessForTests } from "@/lib/beta-access"

import { GET, POST } from "./route"

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

function cookieFor(email: string, uid = `uid-${email}`) {
  return createAccessToken({ sid: "s1", uid, email, name: "T" }).token
}

let ipCounter = 0

function request(method: string, body?: unknown, cookie?: string, origin?: string) {
  ipCounter += 1
  const headers: Record<string, string> = { "x-forwarded-for": `10.8.0.${ipCounter}` }
  if (cookie) headers.cookie = `${ACCESS_COOKIE}=${cookie}`
  if (origin) headers.origin = origin
  const init: RequestInit = { method, headers }
  if (body !== undefined) {
    headers["content-type"] = "application/json"
    init.body = JSON.stringify(body)
  }
  return new Request("http://localhost/api/admin/beta", init)
}

const adminCookie = () => cookieFor("admin@example.com", "admin-1")

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockResolvedValue(adminUser)
  setAdminEmailsForTests(["admin@example.com"])
  clearBetaAccessForTests()
})

describe("GET /api/admin/beta", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await GET(request("GET"))
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthorized" })
  })

  it("rejects a signed-in non-admin with 403", async () => {
    getUserById.mockResolvedValue({ ...adminUser, id: "u9", email: "user@example.com" })
    const response = await GET(request("GET", undefined, cookieFor("user@example.com", "u9")))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
  })

  it("lists programs with enrolled counts for an admin", async () => {
    await POST(
      request(
        "POST",
        { name: "Copilot", description: "New copilot" },
        adminCookie(),
        "http://localhost",
      ),
    )
    const response = await GET(request("GET", undefined, adminCookie()))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.programs).toHaveLength(1)
    expect(body.programs[0]).toMatchObject({
      name: "Copilot",
      description: "New copilot",
      status: "open",
      enrolledCount: 0,
    })
    expect(body.programs[0].enrolledUserIds).toBeUndefined()
  })
})

describe("POST /api/admin/beta", () => {
  it("rejects cross-origin requests with 403", async () => {
    const response = await POST(
      request("POST", { name: "X", description: "" }, adminCookie(), "https://evil.example"),
    )
    expect(response.status).toBe(403)
  })

  it("creates a program", async () => {
    const response = await POST(
      request(
        "POST",
        { name: "Search v2", description: "Faster search" },
        adminCookie(),
        "http://localhost",
      ),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.program).toMatchObject({
      name: "Search v2",
      description: "Faster search",
      status: "open",
      enrolledCount: 0,
    })
    expect(body.program.id).toMatch(/^beta_/)
  })

  it("rejects a missing name and non-JSON bodies", async () => {
    const bad = await POST(
      request("POST", { name: "  ", description: "" }, adminCookie(), "http://localhost"),
    )
    expect(bad.status).toBe(400)

    ipCounter += 1
    const notJson = await POST(
      new Request("http://localhost/api/admin/beta", {
        method: "POST",
        headers: {
          "x-forwarded-for": `10.8.0.${ipCounter}`,
          cookie: `${ACCESS_COOKIE}=${adminCookie()}`,
          origin: "http://localhost",
          "content-type": "application/json",
        },
        body: "not json",
      }),
    )
    expect(notJson.status).toBe(400)
    expect(await notJson.json()).toMatchObject({ ok: false, code: "invalid_request" })
  })
})
