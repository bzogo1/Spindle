// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import {
  addReferralRecord,
  clearReferralFraudStoreForTests,
  scanReferrals,
} from "@/lib/referral-fraud"

import { GET, PATCH } from "./route"

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
    "x-forwarded-for": `10.10.1.${ipCounter}`,
    ...(init?.headers as Record<string, string> | undefined),
  }
  if (cookie) headers.cookie = `${ACCESS_COOKIE}=${cookie}`
  return new Request(`http://localhost${path}`, { ...init, headers })
}

const adminCookie = () => cookieFor("admin@example.com", "admin-1")
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

function patchReq(id: string, body: unknown, cookie?: string) {
  return req(
    `/api/admin/referral-fraud/${id}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    cookie,
  )
}

let flagId: string

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockResolvedValue(adminUser)
  setAdminEmailsForTests(["admin@example.com"])
  clearReferralFraudStoreForTests()
  addReferralRecord({
    id: "r1",
    referrerEmail: "f@x.com",
    referredEmail: "f@x.com",
    createdAt: "2026-02-01T12:00:00.000Z",
  })
  flagId = scanReferrals()[0].id
})

afterEach(() => {
  setAdminEmailsForTests(null)
})

describe("GET /api/admin/referral-fraud/[id]", () => {
  it("returns one flag for an admin", async () => {
    const response = await GET(
      req(`/api/admin/referral-fraud/${flagId}`, undefined, adminCookie()),
      ctx(flagId),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.flag.id).toBe(flagId)
    expect(body.flag.status).toBe("pending")
  })

  it("404s for unknown ids", async () => {
    const response = await GET(
      req("/api/admin/referral-fraud/rff_nope", undefined, adminCookie()),
      ctx("rff_nope"),
    )
    expect(response.status).toBe(404)
  })

  it("rejects non-admins with 403", async () => {
    getUserById.mockResolvedValue({ ...adminUser, id: "u9", email: "user@example.com" })
    const response = await GET(
      req(`/api/admin/referral-fraud/${flagId}`, undefined, cookieFor("user@example.com", "u9")),
      ctx(flagId),
    )
    expect(response.status).toBe(403)
  })
})

describe("PATCH /api/admin/referral-fraud/[id]", () => {
  it("marks a flag confirmed_fraud with reviewer metadata", async () => {
    const response = await PATCH(
      patchReq(flagId, { status: "confirmed_fraud" }, adminCookie()),
      ctx(flagId),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.flag).toMatchObject({
      id: flagId,
      status: "confirmed_fraud",
      reviewedBy: "admin@example.com",
    })
    expect(body.flag.reviewedAt).toBeTruthy()
  })

  it("marks a flag cleared", async () => {
    const response = await PATCH(
      patchReq(flagId, { status: "cleared" }, adminCookie()),
      ctx(flagId),
    )
    expect(response.status).toBe(200)
    expect((await response.json()).flag.status).toBe("cleared")
  })

  it("rejects an invalid status", async () => {
    const response = await PATCH(patchReq(flagId, { status: "bogus" }, adminCookie()), ctx(flagId))
    expect(response.status).toBe(400)
  })

  it("404s for unknown ids", async () => {
    const response = await PATCH(
      patchReq("rff_nope", { status: "cleared" }, adminCookie()),
      ctx("rff_nope"),
    )
    expect(response.status).toBe(404)
  })

  it("rejects non-admins with 403", async () => {
    getUserById.mockResolvedValue({ ...adminUser, id: "u9", email: "user@example.com" })
    const response = await PATCH(
      patchReq(flagId, { status: "cleared" }, cookieFor("user@example.com", "u9")),
      ctx(flagId),
    )
    expect(response.status).toBe(403)
  })
})
