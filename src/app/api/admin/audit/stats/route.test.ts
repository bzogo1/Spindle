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
  const headers: Record<string, string> = { "x-forwarded-for": `10.11.0.${ipCounter}` }
  if (cookie) headers.cookie = `${ACCESS_COOKIE}=${cookie}`
  return GET(new Request(`http://localhost/api/admin/audit/stats${query}`, { headers }))
}

function adminGet(query = "") {
  return get(query, cookieFor("admin@example.com", "admin-1"))
}

function recordAt(iso: string, input: Parameters<MemoryAuthAuditLog["record"]>[0]) {
  vi.setSystemTime(new Date(iso))
  auditLog.record(input)
}

function seedEvents() {
  recordAt("2026-02-01T10:00:00.000Z", {
    type: "signin.success",
    userId: "u1",
    email: "ada@example.com",
  })
  recordAt("2026-02-01T11:00:00.000Z", {
    type: "signin.failure",
    userId: "u1",
    email: "ada@example.com",
  })
  recordAt("2026-02-01T12:00:00.000Z", {
    type: "signin.success",
    userId: "u2",
    email: "bob@example.com",
  })
  recordAt("2026-02-02T09:00:00.000Z", { type: "logout", userId: "u2" })
}

beforeEach(() => {
  getUserById.mockReset()
  setAdminEmailsForTests(["admin@example.com"])
  auditLog = new MemoryAuthAuditLog()
  setAuthAuditLogForTests(auditLog)
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-02-03T00:00:00.000Z"))
})

afterEach(() => {
  vi.useRealTimers()
  setAuthAuditLogForTests(undefined)
  setAdminEmailsForTests(null)
})

describe("GET /api/admin/audit/stats", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await get()
    expect(response.status).toBe(401)
  })

  it("rejects a signed-in non-admin with 403", async () => {
    getUserById.mockResolvedValue({ ...adminUser, id: "u9", email: "user@example.com" })
    const response = await get("", cookieFor("user@example.com", "u9"))
    expect(response.status).toBe(403)
  })

  it("returns counts by type/day, top users, and failure rate", async () => {
    getUserById.mockResolvedValue(adminUser)
    seedEvents()

    const response = await adminGet()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.scanned).toBe(4)

    const { stats } = body
    expect(stats.total).toBe(4)
    // signin.success x2 -> success; signin.failure -> failure; logout -> info.
    expect(stats.successCount).toBe(2)
    expect(stats.failureCount).toBe(1)
    expect(stats.byType["signin.success"]).toBe(2)
    expect(stats.byType["signin.failure"]).toBe(1)
    expect(stats.byType.logout).toBe(1)
    expect(stats.byType["token.refresh"]).toBe(0)

    expect(stats.byDay).toEqual([
      { day: "2026-02-01", count: 3 },
      { day: "2026-02-02", count: 1 },
    ])

    // ada@example.com has 2 events; bob@example.com and the userId-only
    // logout (keyed "u2") have 1 each.
    expect(stats.topUsers).toHaveLength(3)
    expect(stats.topUsers[0]).toMatchObject({
      label: "ada@example.com",
      count: 2,
    })
    expect(stats.failureRate).toBeCloseTo(0.25)
  })

  it("returns null failureRate and empty aggregates for an empty window", async () => {
    getUserById.mockResolvedValue(adminUser)
    const body = await (await adminGet()).json()
    expect(body.stats.total).toBe(0)
    expect(body.stats.failureRate).toBeNull()
    expect(body.stats.topUsers).toEqual([])
    expect(body.stats.byDay).toEqual([])
  })

  it("honours the same filters as the events endpoint", async () => {
    getUserById.mockResolvedValue(adminUser)
    seedEvents()

    const failures = await (await adminGet("?outcome=failure")).json()
    expect(failures.stats.total).toBe(1)
    expect(failures.stats.failureRate).toBe(1)

    // `user` is a substring match on email OR userId: "bob" hits only the
    // bob@example.com event; "u2" hits both u2 events.
    const bob = await (await adminGet("?user=bob")).json()
    expect(bob.stats.total).toBe(1)

    const u2 = await (await adminGet("?user=u2")).json()
    expect(u2.stats.total).toBe(2)
  })

  it("rejects invalid filters with 400", async () => {
    getUserById.mockResolvedValue(adminUser)
    const response = await adminGet("?type=bogus")
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, code: "invalid_request" })
  })
})
