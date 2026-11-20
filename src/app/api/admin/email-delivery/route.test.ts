// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { recordEvent, resetEmailDeliveryForTests, trackEmailSend } from "@/lib/email-delivery"

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

function cookieFor(email: string, uid = `uid-${email}`) {
  return createAccessToken({ sid: "s1", uid, email, name: "T" }).token
}

let ipCounter = 0

function req(query = "", cookie?: string) {
  ipCounter += 1
  const headers: Record<string, string> = { "x-forwarded-for": `10.9.4.${ipCounter}` }
  if (cookie) headers.cookie = `${ACCESS_COOKIE}=${cookie}`
  return new Request(`http://localhost/api/admin/email-delivery${query}`, {
    method: "GET",
    headers,
  })
}

const adminCookie = () => cookieFor("admin@example.com", "admin-1")

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockResolvedValue(adminUser)
  setAdminEmailsForTests(["admin@example.com"])
  resetEmailDeliveryForTests()
})

afterEach(() => {
  setAdminEmailsForTests(null)
})

describe("GET /api/admin/email-delivery", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await GET(req())
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthorized" })
  })

  it("rejects a signed-in non-admin with 403", async () => {
    getUserById.mockResolvedValue({ ...adminUser, id: "u9", email: "user@example.com" })
    const response = await GET(req("", cookieFor("user@example.com", "u9")))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
  })

  it("lists deliveries with status/to filters, pagination, and stats", async () => {
    const ok = trackEmailSend({ to: "ada@example.com", templateKey: "welcome" })
    recordEvent(ok.emailId, { type: "sent" })
    recordEvent(ok.emailId, { type: "delivered" })
    const bad = trackEmailSend({ to: "bob@example.com" })
    recordEvent(bad.emailId, { type: "sent" })
    recordEvent(bad.emailId, { type: "bounced" })
    trackEmailSend({ to: "queued@example.com" })

    const response = await GET(req("?status=delivered", adminCookie()))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.total).toBe(1)
    expect(body.deliveries[0].emailId).toBe(ok.emailId)
    expect(body.deliveries[0].events.map((e: { type: string }) => e.type)).toEqual([
      "queued",
      "sent",
      "delivered",
    ])
    expect(body.stats.total).toBe(3)
    expect(body.stats.byStatus.delivered).toBe(1)
    expect(body.stats.rates.deliveryRate).toBeCloseTo(0.5)

    const byTo = await GET(req("?to=bob@", adminCookie()))
    expect((await byTo.json()).total).toBe(1)

    const page = await GET(req("?limit=1&offset=1", adminCookie()))
    const pageBody = await page.json()
    expect(pageBody.total).toBe(3)
    expect(pageBody.deliveries).toHaveLength(1)
  })

  it("rejects an invalid status and bad pagination", async () => {
    expect((await GET(req("?status=bogus", adminCookie()))).status).toBe(400)
    expect((await GET(req("?limit=abc", adminCookie()))).status).toBe(400)
    expect((await GET(req("?offset=-1", adminCookie()))).status).toBe(400)
    expect((await GET(req(`?to=${"x".repeat(321)}`, adminCookie()))).status).toBe(400)
  })
})
