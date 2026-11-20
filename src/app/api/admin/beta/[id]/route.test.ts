// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { clearBetaAccessForTests, createProgram, enrollUser } from "@/lib/beta-access"

import { GET, PATCH, POST } from "./route"

const getUserById = vi.hoisted(() => vi.fn())
const getUserByEmail = vi.hoisted(() => vi.fn())
// Toggleable mock-auth flag so most tests run with it off (real 404s) and
// the mock-email fallback test can turn it on.
const mockAuth = vi.hoisted(() => ({ enabled: false }))

vi.mock("@/lib/auth/mock-session", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/auth/mock-session")>()
  return {
    ...mod,
    get mockAuthEnabled() {
      return mockAuth.enabled
    },
  }
})

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ getUserById, getUserByEmail }),
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

const adminCookie = () => cookieFor("admin@example.com", "admin-1")

let ipCounter = 0

function ctx(id: string) {
  return { params: Promise.resolve({ id }) }
}

function request(
  method: string,
  id: string,
  body?: unknown,
  cookie = adminCookie(),
  origin?: string,
) {
  ipCounter += 1
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.7.0.${ipCounter}`,
    cookie: `${ACCESS_COOKIE}=${cookie}`,
  }
  if (origin) headers.origin = origin
  const init: RequestInit = { method, headers }
  if (body !== undefined) {
    headers["content-type"] = "application/json"
    init.body = JSON.stringify(body)
  }
  return new Request(`http://localhost/api/admin/beta/${id}`, init)
}

let programId: string

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockResolvedValue(adminUser)
  getUserByEmail.mockReset()
  mockAuth.enabled = false
  setAdminEmailsForTests(["admin@example.com"])
  clearBetaAccessForTests()
  programId = createProgram({ name: "Copilot", description: "" }).id
})

describe("GET /api/admin/beta/[id]", () => {
  it("returns 404 for a missing program", async () => {
    const response = await GET(request("GET", "beta_missing"), ctx("beta_missing"))
    expect(response.status).toBe(404)
  })

  it("returns the program and its enrollments", async () => {
    enrollUser(programId, "u1")
    enrollUser(programId, "u2")
    const response = await GET(request("GET", programId), ctx(programId))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.program).toMatchObject({ id: programId, name: "Copilot", enrolledCount: 2 })
    expect(body.enrollments).toEqual(["u1", "u2"])
  })
})

describe("PATCH /api/admin/beta/[id] — status", () => {
  it("rejects cross-origin requests with 403", async () => {
    const response = await PATCH(
      request("PATCH", programId, { status: "closed" }, adminCookie(), "https://evil.example"),
      ctx(programId),
    )
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
  })

  it("closes and reopens a program", async () => {
    const closed = await PATCH(request("PATCH", programId, { status: "closed" }), ctx(programId))
    expect(closed.status).toBe(200)
    expect((await closed.json()).program.status).toBe("closed")

    const reopened = await PATCH(request("PATCH", programId, { status: "open" }), ctx(programId))
    expect((await reopened.json()).program.status).toBe("open")
  })

  it("rejects an invalid status and ambiguous bodies", async () => {
    const bad = await PATCH(request("PATCH", programId, { status: "maybe" }), ctx(programId))
    expect(bad.status).toBe(400)

    const both = await PATCH(
      request("PATCH", programId, { status: "open", action: "enroll", userId: "u1" }),
      ctx(programId),
    )
    expect(both.status).toBe(400)

    const neither = await PATCH(request("PATCH", programId, {}), ctx(programId))
    expect(neither.status).toBe(400)
  })
})

describe("PATCH /api/admin/beta/[id] — enroll/unenroll", () => {
  it("enrolls and unenrolls by userId", async () => {
    const enrolled = await PATCH(
      request("PATCH", programId, { action: "enroll", userId: "u1" }),
      ctx(programId),
    )
    expect(enrolled.status).toBe(200)
    const body = await enrolled.json()
    expect(body.program.enrolledCount).toBe(1)

    const unenrolled = await PATCH(
      request("PATCH", programId, { action: "unenroll", userId: "u1" }),
      ctx(programId),
    )
    expect((await unenrolled.json()).program.enrolledCount).toBe(0)
  })

  it("enrolls by email via the auth backend as a user:<id> principal", async () => {
    getUserByEmail.mockResolvedValue({ id: "u-real", email: "ada@example.com" })
    const response = await PATCH(
      request("PATCH", programId, { action: "enroll", email: "Ada@Example.com" }),
      ctx(programId),
    )
    expect(response.status).toBe(200)
    expect(getUserByEmail).toHaveBeenCalledWith("ada@example.com")
    expect((await response.json()).program.enrolledCount).toBe(1)

    const detail = await GET(request("GET", programId), ctx(programId))
    expect((await detail.json()).enrollments).toEqual(["user:u-real"])
  })

  it("falls back to the mock:<email> principal when mock auth is enabled", async () => {
    mockAuth.enabled = true
    getUserByEmail.mockResolvedValue(null)
    const response = await PATCH(
      request("PATCH", programId, { action: "enroll", email: "Dev@Mock.Local" }),
      ctx(programId),
    )
    expect(response.status).toBe(200)
    expect((await response.json()).program.enrolledCount).toBe(1)

    const detail = await GET(request("GET", programId), ctx(programId))
    expect((await detail.json()).enrollments).toEqual(["mock:dev@mock.local"])
  })

  it("returns 404 user_not_found for an unknown email", async () => {
    getUserByEmail.mockResolvedValue(null)
    const response = await PATCH(
      request("PATCH", programId, { action: "enroll", email: "nobody@example.com" }),
      ctx(programId),
    )
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ ok: false, code: "user_not_found" })
  })

  it("rejects bodies with both or neither identifier", async () => {
    const both = await PATCH(
      request("PATCH", programId, { action: "enroll", userId: "u1", email: "a@b.co" }),
      ctx(programId),
    )
    expect(both.status).toBe(400)

    const neither = await PATCH(request("PATCH", programId, { action: "enroll" }), ctx(programId))
    expect(neither.status).toBe(400)
  })

  it("enrolls into closed programs (admin override)", async () => {
    await PATCH(request("PATCH", programId, { status: "closed" }), ctx(programId))
    const response = await PATCH(
      request("PATCH", programId, { action: "enroll", userId: "u1" }),
      ctx(programId),
    )
    expect(response.status).toBe(200)
    expect((await response.json()).program.enrolledCount).toBe(1)
  })
})

describe("POST /api/admin/beta/[id] — enroll/unenroll", () => {
  it("enrolls and unenrolls by userId", async () => {
    const enrolled = await POST(
      request("POST", programId, { action: "enroll", userId: "u9" }),
      ctx(programId),
    )
    expect(enrolled.status).toBe(200)
    expect((await enrolled.json()).program.enrolledCount).toBe(1)

    const unenrolled = await POST(
      request("POST", programId, { action: "unenroll", userId: "u9" }),
      ctx(programId),
    )
    expect(unenrolled.status).toBe(200)
    expect((await unenrolled.json()).program.enrolledCount).toBe(0)
  })

  it("enrolls by email via the auth backend", async () => {
    getUserByEmail.mockResolvedValue({ id: "u-real", email: "ada@example.com" })
    const response = await POST(
      request("POST", programId, { action: "enroll", email: "ada@example.com" }),
      ctx(programId),
    )
    expect(response.status).toBe(200)
    expect(getUserByEmail).toHaveBeenCalledWith("ada@example.com")
  })

  it("rejects status bodies and missing programs", async () => {
    const statusBody = await POST(request("POST", programId, { status: "closed" }), ctx(programId))
    expect(statusBody.status).toBe(400)

    const missing = await POST(
      request("POST", "beta_missing", { action: "enroll", userId: "u1" }),
      ctx("beta_missing"),
    )
    expect(missing.status).toBe(404)
  })

  it("requires admin", async () => {
    getUserById.mockResolvedValue({ ...adminUser, email: "user@example.com" })
    const response = await POST(
      request(
        "POST",
        programId,
        { action: "enroll", userId: "u1" },
        cookieFor("user@example.com", "u-2"),
      ),
      ctx(programId),
    )
    expect(response.status).toBe(403)
  })
})
