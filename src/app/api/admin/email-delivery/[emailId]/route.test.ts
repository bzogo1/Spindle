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

function req(emailId: string, cookie?: string) {
  ipCounter += 1
  const headers: Record<string, string> = { "x-forwarded-for": `10.9.5.${ipCounter}` }
  if (cookie) headers.cookie = `${ACCESS_COOKIE}=${cookie}`
  return new Request(`http://localhost/api/admin/email-delivery/${emailId}`, {
    method: "GET",
    headers,
  })
}

const ctx = (emailId: string) => ({ params: Promise.resolve({ emailId }) })
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

describe("GET /api/admin/email-delivery/[emailId]", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await GET(req("del_x"), ctx("del_x"))
    expect(response.status).toBe(401)
  })

  it("returns one record with its event timeline", async () => {
    const { emailId } = trackEmailSend({ to: "ada@example.com", templateKey: "welcome" })
    recordEvent(emailId, { type: "sent" })
    recordEvent(emailId, { type: "delivered" })

    const response = await GET(req(emailId, adminCookie()), ctx(emailId))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.delivery).toMatchObject({
      emailId,
      to: "ada@example.com",
      templateKey: "welcome",
      status: "delivered",
    })
    expect(body.delivery.events.map((e: { type: string }) => e.type)).toEqual([
      "queued",
      "sent",
      "delivered",
    ])
  })

  it("returns 404 for unknown ids", async () => {
    const response = await GET(req("del_nope", adminCookie()), ctx("del_nope"))
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ ok: false, code: "not_found" })
  })
})
