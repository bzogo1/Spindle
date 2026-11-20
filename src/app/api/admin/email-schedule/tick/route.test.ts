// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { resetEmailScheduleForTests, scheduleEmail } from "@/lib/email-scheduler"

import { POST } from "./route"

const getUserById = vi.hoisted(() => vi.fn())
const sendEmail = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ getUserById }),
  }
})

vi.mock("@/lib/email", () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}))

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

function post(cookie?: string) {
  ipCounter += 1
  const headers: Record<string, string> = { "x-forwarded-for": `10.9.4.${ipCounter}` }
  if (cookie) headers.cookie = `${ACCESS_COOKIE}=${cookie}`
  return POST(
    new Request("http://localhost/api/admin/email-schedule/tick", { method: "POST", headers }),
  )
}

const adminCookie = () => cookieFor("admin@example.com", "admin-1")

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockResolvedValue(adminUser)
  sendEmail.mockReset()
  sendEmail.mockResolvedValue("sent")
  setAdminEmailsForTests(["admin@example.com"])
  resetEmailScheduleForTests()
})

afterEach(() => {
  setAdminEmailsForTests(null)
})

describe("POST /api/admin/email-schedule/tick", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await post()
    expect(response.status).toBe(401)
  })

  it("rejects a non-admin with 403", async () => {
    getUserById.mockResolvedValue({ ...adminUser, id: "u9", email: "user@example.com" })
    const response = await post(cookieFor("user@example.com", "u9"))
    expect(response.status).toBe(403)
  })

  it("processes due emails and returns counts", async () => {
    // Fake the clock so sendAt can be scheduled in the "future" yet already
    // due by the time the tick runs.
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-06-01T00:00:00.000Z"))
    try {
      scheduleEmail({
        to: "a@x.io",
        subject: "due",
        sendAt: "2026-06-02T00:00:00.000Z",
        textBody: "b",
      })
      scheduleEmail({
        to: "b@x.io",
        subject: "later",
        sendAt: "2026-06-03T00:00:00.000Z",
        textBody: "b",
      })
      vi.setSystemTime(new Date("2026-06-02T12:00:00.000Z"))

      const response = await post(adminCookie())
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body).toMatchObject({ ok: true, processed: 1, sent: 1, failed: 0 })
      expect(sendEmail).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it("records send failures honestly", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-06-01T00:00:00.000Z"))
    try {
      scheduleEmail({
        to: "a@x.io",
        subject: "due",
        sendAt: "2026-06-01T01:00:00.000Z",
        textBody: "b",
      })
      sendEmail.mockRejectedValue(new Error("boom"))
      vi.setSystemTime(new Date("2026-06-02T00:00:00.000Z"))

      const response = await post(adminCookie())
      const body = await response.json()
      expect(body).toMatchObject({ ok: true, processed: 1, sent: 0, failed: 1 })
    } finally {
      vi.useRealTimers()
    }
  })

  it("returns zero counts when nothing is due", async () => {
    scheduleEmail({
      to: "a@x.io",
      subject: "later",
      sendAt: "2999-01-01T00:00:00.000Z",
      textBody: "b",
    })
    const response = await post(adminCookie())
    const body = await response.json()
    expect(body).toMatchObject({ ok: true, processed: 0, sent: 0, failed: 0 })
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
