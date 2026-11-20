// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { addReferralRecord, clearReferralFraudStoreForTests, listFlags } from "@/lib/referral-fraud"

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

function req(path: string, init?: RequestInit, cookie?: string) {
  ipCounter += 1
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.9.1.${ipCounter}`,
    ...(init?.headers as Record<string, string> | undefined),
  }
  if (cookie) headers.cookie = `${ACCESS_COOKIE}=${cookie}`
  return new Request(`http://localhost${path}`, { ...init, headers })
}

const adminCookie = () => cookieFor("admin@example.com", "admin-1")

function suspiciousRecord(id: string) {
  return {
    id,
    referrerEmail: "f@x.com",
    referredEmail: "f@x.com",
    createdAt: "2026-02-01T12:00:00.000Z",
  }
}

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockResolvedValue(adminUser)
  setAdminEmailsForTests(["admin@example.com"])
  clearReferralFraudStoreForTests()
})

afterEach(() => {
  setAdminEmailsForTests(null)
})

describe("GET /api/admin/referral-fraud", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await GET(req("/api/admin/referral-fraud"))
    expect(response.status).toBe(401)
  })

  it("rejects a signed-in non-admin with 403", async () => {
    getUserById.mockResolvedValue({ ...adminUser, id: "u9", email: "user@example.com" })
    const response = await GET(
      req("/api/admin/referral-fraud", undefined, cookieFor("user@example.com", "u9")),
    )
    expect(response.status).toBe(403)
  })

  it("returns an empty queue for an admin", async () => {
    const response = await GET(req("/api/admin/referral-fraud", undefined, adminCookie()))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.flags).toEqual([])
    expect(body.total).toBe(0)
  })

  it("lists flagged referrals and filters by status", async () => {
    addReferralRecord(suspiciousRecord("r1"))
    const scan = await POST(req("/api/admin/referral-fraud", { method: "POST" }, adminCookie()))
    expect(scan.status).toBe(200)
    const flagId = (await scan.json()).flags[0].id

    const pending = await GET(
      req("/api/admin/referral-fraud?status=pending", undefined, adminCookie()),
    )
    const pendingBody = await pending.json()
    expect(pendingBody.total).toBe(1)
    expect(pendingBody.flags[0].id).toBe(flagId)

    const cleared = await GET(
      req("/api/admin/referral-fraud?status=cleared", undefined, adminCookie()),
    )
    expect((await cleared.json()).total).toBe(0)

    const bad = await GET(req("/api/admin/referral-fraud?status=bogus", undefined, adminCookie()))
    expect(bad.status).toBe(400)
  })
})

describe("POST /api/admin/referral-fraud", () => {
  it("scans the stored referral records", async () => {
    addReferralRecord(suspiciousRecord("r1"))
    const response = await POST(req("/api/admin/referral-fraud", { method: "POST" }, adminCookie()))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.flagged).toBe(1)
    expect(body.flags[0]).toMatchObject({
      referralId: "r1",
      status: "pending",
      score: expect.any(Number),
    })
    expect(body.flags[0].reasons.length).toBeGreaterThan(0)
    expect(listFlags({}).total).toBe(1)
  })

  it("scans an explicit records payload", async () => {
    const response = await POST(
      req(
        "/api/admin/referral-fraud",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ records: [suspiciousRecord("adhoc-1")] }),
        },
        adminCookie(),
      ),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.flags[0].referralId).toBe("adhoc-1")
  })

  it("rejects malformed records", async () => {
    const response = await POST(
      req(
        "/api/admin/referral-fraud",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ records: [{ id: "" }] }),
        },
        adminCookie(),
      ),
    )
    expect(response.status).toBe(400)
  })

  it("rejects non-admin scans with 403", async () => {
    getUserById.mockResolvedValue({ ...adminUser, id: "u9", email: "user@example.com" })
    const response = await POST(
      req("/api/admin/referral-fraud", { method: "POST" }, cookieFor("user@example.com", "u9")),
    )
    expect(response.status).toBe(403)
  })
})
