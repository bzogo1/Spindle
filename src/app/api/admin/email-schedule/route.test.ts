// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { resetEmailScheduleForTests, scheduleEmail } from "@/lib/email-scheduler"

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

function req(method: string, query = "", body?: unknown, cookie?: string) {
  ipCounter += 1
  const headers: Record<string, string> = { "x-forwarded-for": `10.9.2.${ipCounter}` }
  if (cookie) headers.cookie = `${ACCESS_COOKIE}=${cookie}`
  if (body !== undefined) headers["content-type"] = "application/json"
  return new Request(`http://localhost/api/admin/email-schedule${query}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

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

describe("GET /api/admin/email-schedule", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await GET(req("GET"))
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthorized" })
  })

  it("rejects a signed-in non-admin with 403", async () => {
    getUserById.mockResolvedValue({ ...adminUser, id: "u9", email: "user@example.com" })
    const response = await GET(req("GET", "", undefined, cookieFor("user@example.com", "u9")))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
  })

  it("lists scheduled emails with status filter and pagination", async () => {
    scheduleEmail({ to: "a@x.io", subject: "one", sendAt: FUTURE, textBody: "hi" })
    const canceled = scheduleEmail({
      to: "b@x.io",
      subject: "two",
      sendAt: FUTURE,
      textBody: "hi",
    })
    const { cancelScheduled } = await import("@/lib/email-scheduler")
    cancelScheduled(canceled.id)

    const response = await GET(req("GET", "?status=scheduled", undefined, adminCookie()))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.total).toBe(1)
    expect(body.emails[0].to).toBe("a@x.io")

    const all = await GET(req("GET", "?limit=1&offset=0", undefined, adminCookie()))
    const allBody = await all.json()
    expect(allBody.total).toBe(2)
    expect(allBody.emails).toHaveLength(1)
  })

  it("rejects an invalid status and bad pagination", async () => {
    expect((await GET(req("GET", "?status=bogus", undefined, adminCookie()))).status).toBe(400)
    expect((await GET(req("GET", "?limit=abc", undefined, adminCookie()))).status).toBe(400)
    expect((await GET(req("GET", "?offset=-1", undefined, adminCookie()))).status).toBe(400)
  })
})

describe("POST /api/admin/email-schedule", () => {
  const valid = {
    to: "ada@example.com",
    subject: "Scheduled hello",
    sendAt: FUTURE,
    textBody: "See you then.",
  }

  it("rejects unauthenticated requests with 401", async () => {
    const response = await POST(req("POST", "", valid))
    expect(response.status).toBe(401)
  })

  it("schedules a valid email for an admin", async () => {
    const response = await POST(req("POST", "", valid, adminCookie()))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.email).toMatchObject({
      to: "ada@example.com",
      subject: "Scheduled hello",
      status: "scheduled",
      sendAt: FUTURE,
    })
  })

  it("rejects invalid input with 400", async () => {
    for (const bad of [
      { ...valid, to: "not-an-email" },
      { ...valid, subject: "" },
      { ...valid, sendAt: "2000-01-01T00:00:00.000Z" },
      { to: "a@x.io", subject: "s", sendAt: FUTURE }, // no body/template
    ]) {
      const response = await POST(req("POST", "", bad, adminCookie()))
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ ok: false, code: "invalid_request" })
    }
  })

  it("rejects malformed JSON", async () => {
    const response = await POST(
      new Request("http://localhost/api/admin/email-schedule", {
        method: "POST",
        headers: {
          "x-forwarded-for": "10.9.2.99",
          cookie: `${ACCESS_COOKIE}=${adminCookie()}`,
          "content-type": "application/json",
        },
        body: "{nope",
      }),
    )
    expect(response.status).toBe(400)
  })
})
