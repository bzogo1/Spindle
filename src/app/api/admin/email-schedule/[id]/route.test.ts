// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { resetEmailScheduleForTests, scheduleEmail } from "@/lib/email-scheduler"

import { DELETE, GET } from "./route"

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

function req(method: string, id: string, cookie?: string) {
  ipCounter += 1
  const headers: Record<string, string> = { "x-forwarded-for": `10.9.3.${ipCounter}` }
  if (cookie) headers.cookie = `${ACCESS_COOKIE}=${cookie}`
  return new Request(`http://localhost/api/admin/email-schedule/${id}`, { method, headers })
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const adminCookie = () => cookieFor("admin@example.com", "admin-1")
const FUTURE = "2999-01-01T00:00:00.000Z"

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockResolvedValue(adminUser)
  setAdminEmailsForTests(["admin@example.com"])
  resetEmailScheduleForTests()
})

afterEach(() => {
  setAdminEmailsForTests(null)
})

describe("GET /api/admin/email-schedule/[id]", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await GET(req("GET", "eml_x"), ctx("eml_x"))
    expect(response.status).toBe(401)
  })

  it("returns one record or 404", async () => {
    const email = scheduleEmail({
      to: "a@x.io",
      subject: "s",
      sendAt: FUTURE,
      textBody: "b",
    })
    const found = await GET(req("GET", email.id, adminCookie()), ctx(email.id))
    expect(found.status).toBe(200)
    expect((await found.json()).email.id).toBe(email.id)

    const missing = await GET(req("GET", "eml_nope", adminCookie()), ctx("eml_nope"))
    expect(missing.status).toBe(404)
  })
})

describe("DELETE /api/admin/email-schedule/[id]", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await DELETE(req("DELETE", "eml_x"), ctx("eml_x"))
    expect(response.status).toBe(401)
  })

  it("cancels a scheduled email", async () => {
    const email = scheduleEmail({
      to: "a@x.io",
      subject: "s",
      sendAt: FUTURE,
      textBody: "b",
    })
    const response = await DELETE(req("DELETE", email.id, adminCookie()), ctx(email.id))
    expect(response.status).toBe(200)
    expect((await response.json()).email.status).toBe("canceled")
  })

  it("returns 404 for unknown ids and 409 for resolved records", async () => {
    const missing = await DELETE(req("DELETE", "eml_nope", adminCookie()), ctx("eml_nope"))
    expect(missing.status).toBe(404)

    const email = scheduleEmail({
      to: "a@x.io",
      subject: "s",
      sendAt: FUTURE,
      textBody: "b",
    })
    await DELETE(req("DELETE", email.id, adminCookie()), ctx(email.id))
    const again = await DELETE(req("DELETE", email.id, adminCookie()), ctx(email.id))
    expect(again.status).toBe(409)
    expect(await again.json()).toMatchObject({ ok: false, code: "not_scheduled" })
  })
})
