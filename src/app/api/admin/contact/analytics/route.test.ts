// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { clearContactSubmissions, routeSubmission } from "@/lib/contact-routing"

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

function request(path = "", cookie?: string) {
  ipCounter += 1
  const headers: Record<string, string> = { "x-forwarded-for": `10.30.0.${ipCounter}` }
  if (cookie) headers.cookie = `${ACCESS_COOKIE}=${cookie}`
  return GET(new Request(`http://localhost/api/admin/contact/analytics${path}`, { headers }))
}

const adminCookie = () => cookieFor("admin@example.com", "admin-1")

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockResolvedValue(adminUser)
  setAdminEmailsForTests(["admin@example.com"])
  clearContactSubmissions()

  routeSubmission({
    id: "CT-00000001",
    name: "Ada Lovelace",
    email: "ada@example.com",
    topic: "billing",
    subject: "Invoice question",
    message: "I was charged twice for my subscription invoice.",
  })
  routeSubmission({
    id: "CT-00000002",
    name: "Grace Hopper",
    email: "grace@navy.mil",
    topic: "product",
    subject: "Compiler bug",
    message: "The export feature crashes on large files.",
  })
  routeSubmission({
    id: "CT-00000003",
    name: "Spam Bot",
    email: "bot@spam.example",
    topic: "other",
    subject: "Buy now",
    message: "Cheap pills !!!",
    status: "spam",
    spamSignals: ["repeated-chars"],
  })
})

afterEach(() => {
  setAdminEmailsForTests(null)
})

describe("GET /api/admin/contact/analytics", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await request()
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthorized" })
  })

  it("rejects a signed-in non-admin with 403", async () => {
    getUserById.mockResolvedValue({ ...adminUser, id: "u9", email: "user@example.com" })
    const response = await request("", cookieFor("user@example.com", "u9"))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
  })

  it("returns summary counts, queue breakdown, and a zero-filled daily series", async () => {
    const response = await request("?days=7", adminCookie())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)

    expect(body.summary.total).toBe(3)
    expect(body.summary.byStatus).toEqual(
      expect.arrayContaining([
        { key: "new", count: 2 },
        { key: "spam", count: 1 },
      ]),
    )
    expect(body.queueBreakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "billing", count: 1 }),
        expect.objectContaining({ key: "support", count: 1 }),
        // "Buy now" trips the sales keyword rule even though topic is "other".
        expect.objectContaining({ key: "sales", count: 1 }),
      ]),
    )
    const queueTotal = body.queueBreakdown.reduce(
      (sum: number, entry: { count: number }) => sum + entry.count,
      0,
    )
    expect(queueTotal).toBe(3)

    expect(body.days).toBe(7)
    expect(body.daily).toHaveLength(7)
    expect(
      body.daily.every((p: { date: string; count: number }) => typeof p.date === "string"),
    ).toBe(true)
    // All three fixtures were created "now", so today's bucket holds them.
    expect(body.daily.at(-1).count).toBe(3)
    expect(typeof body.generatedAt).toBe("string")
  })

  it("defaults to a 30-day window", async () => {
    const body = await (await request("", adminCookie())).json()
    expect(body.days).toBe(30)
    expect(body.daily).toHaveLength(30)
  })

  it.each(["?days=0", "?days=91", "?days=-3", "?days=abc", "?days=1.5"])(
    "rejects %s with 400",
    async (query) => {
      const response = await request(query, adminCookie())
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ ok: false, code: "invalid_request" })
    },
  )

  it("accepts the boundary values 1 and 90", async () => {
    for (const days of [1, 90]) {
      const body = await (await request(`?days=${days}`, adminCookie())).json()
      expect(body.days).toBe(days)
      expect(body.daily).toHaveLength(days)
    }
  })
})
