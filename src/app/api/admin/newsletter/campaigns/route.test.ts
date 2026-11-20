// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { clearNewsletterStore, recordCampaign } from "@/lib/newsletter-store"

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

function request(method: "GET" | "POST", query = "", body?: unknown, cookie?: string) {
  ipCounter += 1
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.9.2.${ipCounter}`,
    ...(cookie ? { cookie: `${ACCESS_COOKIE}=${cookie}` } : {}),
    ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
  }
  return (method === "GET" ? GET : POST)(
    new Request(`http://localhost/api/admin/newsletter/campaigns${query}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  )
}

const adminCookie = () => cookieFor("admin@example.com", "admin-1")

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockResolvedValue(adminUser)
  setAdminEmailsForTests(["admin@example.com"])
  clearNewsletterStore()
})

afterEach(() => {
  setAdminEmailsForTests(null)
})

describe("GET /api/admin/newsletter/campaigns", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await request("GET")
    expect(response.status).toBe(401)
  })

  it("lists campaigns for an admin", async () => {
    recordCampaign({ subject: "One", body: "hello" })
    recordCampaign({ subject: "Two", status: "sent" })

    const response = await request("GET", "", undefined, adminCookie())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.total).toBe(2)
    expect(body.campaigns).toHaveLength(2)
    expect(body.campaigns[0].subject).toBeTruthy()
  })
})

describe("POST /api/admin/newsletter/campaigns", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await request("POST", "", { subject: "Hi" })
    expect(response.status).toBe(401)
  })

  it("creates a draft campaign with a body preview", async () => {
    const response = await request(
      "POST",
      "",
      { subject: "Spring launch", body: "Big news inside." },
      adminCookie(),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.campaign).toMatchObject({
      subject: "Spring launch",
      status: "draft",
      bodyPreview: "Big news inside.",
    })
    expect(body.campaign.id).toMatch(/^cmp_/)
  })

  it("rejects a missing subject", async () => {
    const response = await request("POST", "", { body: "no subject" }, adminCookie())
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, code: "invalid_request" })
  })

  it("rejects malformed JSON", async () => {
    ipCounter += 1
    const response = await POST(
      new Request("http://localhost/api/admin/newsletter/campaigns", {
        method: "POST",
        headers: {
          "x-forwarded-for": `10.9.2.${ipCounter}`,
          cookie: `${ACCESS_COOKIE}=${adminCookie()}`,
          "Content-Type": "application/json",
        },
        body: "{oops",
      }),
    )
    expect(response.status).toBe(400)
  })
})
