// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { MemoryAuthAuditLog, setAuthAuditLogForTests } from "@/lib/auth/audit"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"

import { GET } from "./route"

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

let auditLog: MemoryAuthAuditLog

function cookieFor(email: string, uid = `uid-${email}`) {
  return createAccessToken({ sid: "s1", uid, email, name: "T" }).token
}

let ipCounter = 0

function get(query = "", cookie?: string) {
  ipCounter += 1
  const headers: Record<string, string> = { "x-forwarded-for": `10.10.0.${ipCounter}` }
  if (cookie) headers.cookie = `${ACCESS_COOKIE}=${cookie}`
  return GET(new Request(`http://localhost/api/admin/audit/events${query}`, { headers }))
}

function adminGet(query = "") {
  return get(query, cookieFor("admin@example.com", "admin-1"))
}

/** Records an event at a fixed timestamp (fake timers make `new Date` fixed). */
function recordAt(iso: string, input: Parameters<MemoryAuthAuditLog["record"]>[0]) {
  vi.setSystemTime(new Date(iso))
  auditLog.record(input)
}

beforeEach(() => {
  getUserById.mockReset()
  setAdminEmailsForTests(["admin@example.com"])
  auditLog = new MemoryAuthAuditLog()
  setAuthAuditLogForTests(auditLog)
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-02-01T12:00:00.000Z"))
})

afterEach(() => {
  vi.useRealTimers()
  setAuthAuditLogForTests(undefined)
  setAdminEmailsForTests(null)
})

describe("GET /api/admin/audit/events", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await get()
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthorized" })
  })

  it("rejects a signed-in non-admin with 403", async () => {
    getUserById.mockResolvedValue({ ...adminUser, id: "u9", email: "user@example.com" })
    const response = await get("", cookieFor("user@example.com", "u9"))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
  })

  it("lists events across all users, newest first, for an admin", async () => {
    getUserById.mockResolvedValue(adminUser)
    recordAt("2026-02-01T10:00:00.000Z", {
      type: "signin.success",
      userId: "u1",
      email: "ada@example.com",
    })
    recordAt("2026-02-01T11:00:00.000Z", {
      type: "logout",
      userId: "u2",
      email: "bob@example.com",
    })

    const response = await adminGet()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.total).toBe(2)
    expect(body.events).toHaveLength(2)
    expect(body.events[0].type).toBe("logout") // newest first
    expect(body.events[1].email).toBe("ada@example.com")
    expect(body.hasMore).toBe(false)
  })

  it("filters by exact event type", async () => {
    getUserById.mockResolvedValue(adminUser)
    recordAt("2026-02-01T10:00:00.000Z", { type: "signin.success", userId: "u1" })
    recordAt("2026-02-01T10:05:00.000Z", { type: "logout", userId: "u1" })
    recordAt("2026-02-01T10:10:00.000Z", { type: "logout", userId: "u2" })

    const response = await adminGet("?type=logout")
    const body = await response.json()
    expect(body.total).toBe(2)
    expect(body.events.map((e: { type: string }) => e.type)).toEqual(["logout", "logout"])
  })

  it("filters by outcome (failure matches signin.failure only)", async () => {
    getUserById.mockResolvedValue(adminUser)
    recordAt("2026-02-01T10:00:00.000Z", { type: "signin.success", userId: "u1" })
    recordAt("2026-02-01T10:05:00.000Z", { type: "signin.failure", userId: "u1" })
    recordAt("2026-02-01T10:10:00.000Z", { type: "logout", userId: "u1" })

    const response = await adminGet("?outcome=failure")
    const body = await response.json()
    expect(body.total).toBe(1)
    expect(body.events[0].type).toBe("signin.failure")
  })

  it("filters by free-text user across email and userId", async () => {
    getUserById.mockResolvedValue(adminUser)
    recordAt("2026-02-01T10:00:00.000Z", {
      type: "signin.success",
      userId: "u1",
      email: "ada@example.com",
    })
    recordAt("2026-02-01T10:05:00.000Z", {
      type: "signin.success",
      userId: "u2",
      email: "bob@example.com",
    })
    // Anonymous-ish event with only a userId containing the needle.
    recordAt("2026-02-01T10:10:00.000Z", { type: "logout", userId: "ada-admin" })

    const response = await adminGet("?user=ADA")
    const body = await response.json()
    expect(body.total).toBe(2)
    expect(body.events.map((e: { email: string | null }) => e.email)).toEqual([
      null,
      "ada@example.com",
    ])
  })

  it("filters by exact userId and email params", async () => {
    getUserById.mockResolvedValue(adminUser)
    recordAt("2026-02-01T10:00:00.000Z", { type: "signin.success", userId: "u1", email: "a@x.io" })
    recordAt("2026-02-01T10:05:00.000Z", { type: "signin.success", userId: "u2", email: "b@x.io" })

    const byId = await (await adminGet("?userId=u2")).json()
    expect(byId.total).toBe(1)
    expect(byId.events[0].userId).toBe("u2")

    const byEmail = await (await adminGet("?email=b@x.io")).json()
    expect(byEmail.total).toBe(1)
    expect(byEmail.events[0].email).toBe("b@x.io")
  })

  it("applies an inclusive UTC date range", async () => {
    getUserById.mockResolvedValue(adminUser)
    recordAt("2026-01-31T23:59:59.000Z", { type: "signin.success", userId: "u1" })
    recordAt("2026-02-01T00:00:00.000Z", { type: "signin.success", userId: "u1" })
    recordAt("2026-02-01T12:00:00.000Z", { type: "signin.success", userId: "u1" })
    recordAt("2026-02-02T00:00:00.001Z", { type: "signin.success", userId: "u1" })

    const response = await adminGet("?from=2026-02-01&to=2026-02-01")
    const body = await response.json()
    expect(body.total).toBe(2)
    expect(body.events.map((e: { timestamp: string }) => e.timestamp)).toEqual([
      "2026-02-01T12:00:00.000Z",
      "2026-02-01T00:00:00.000Z",
    ])
  })

  it("paginates with limit and offset", async () => {
    getUserById.mockResolvedValue(adminUser)
    for (let i = 0; i < 5; i += 1) {
      recordAt(`2026-02-01T10:0${i}:00.000Z`, { type: "logout", userId: `u${i}` })
    }

    const page1 = await (await adminGet("?limit=2&offset=0")).json()
    expect(page1.events).toHaveLength(2)
    expect(page1.total).toBe(5)
    expect(page1.hasMore).toBe(true)

    const page3 = await (await adminGet("?limit=2&offset=4")).json()
    expect(page3.events).toHaveLength(1)
    expect(page3.hasMore).toBe(false)
  })

  it.each([
    ["?type=bogus", "Unknown event type"],
    ["?outcome=bogus", "Unknown outcome"],
    ["?limit=abc", "Invalid limit or offset"],
    ["?limit=99999999999999999999", "Invalid limit or offset"],
    ["?offset=-1", "Invalid limit or offset"],
    ["?from=not-a-date", "Invalid date range"],
    ["?from=2026-02-02&to=2026-02-01", "start date is after the end date"],
  ])("rejects invalid query %s", async (query) => {
    getUserById.mockResolvedValue(adminUser)
    const response = await adminGet(query)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, code: "invalid_request" })
  })
})
