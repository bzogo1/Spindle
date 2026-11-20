// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { clearAnnouncementsForTests, createAnnouncement } from "@/lib/announcements"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"

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

function request(
  method: "GET" | "POST",
  body?: unknown,
  options: { cookie?: string; origin?: string } = {},
) {
  ipCounter += 1
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.9.5.${ipCounter}`,
    ...(options.cookie ? { cookie: `${ACCESS_COOKIE}=${options.cookie}` } : {}),
    ...(body !== undefined ? { "content-type": "application/json" } : {}),
    ...(options.origin ? { origin: options.origin } : {}),
  }
  return (method === "GET" ? GET : POST)(
    new Request("http://localhost/api/admin/announcements", {
      method,
      headers,
      ...(body !== undefined
        ? { body: typeof body === "string" ? body : JSON.stringify(body) }
        : {}),
    }),
  )
}

const adminCookie = () => cookieFor("admin@example.com", "admin-1")

const VALID_BODY = {
  title: "Maintenance window",
  body: "We will be down on Sunday.",
  startsAt: "2026-03-01T00:00:00.000Z",
  endsAt: "2026-03-02T00:00:00.000Z",
}

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockResolvedValue(adminUser)
  setAdminEmailsForTests(["admin@example.com"])
  clearAnnouncementsForTests()
})

afterEach(() => {
  setAdminEmailsForTests(null)
})

describe("GET /api/admin/announcements", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await request("GET")
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthorized" })
  })

  it("rejects a signed-in non-admin with 403", async () => {
    getUserById.mockResolvedValue({ ...adminUser, id: "u9", email: "user@example.com" })
    const response = await request("GET", undefined, {
      cookie: cookieFor("user@example.com", "u9"),
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
  })

  it("lists all announcements including scheduled and expired", async () => {
    createAnnouncement({
      title: "live",
      body: "b",
      startsAt: "2020-01-01T00:00:00.000Z",
    })
    createAnnouncement({
      title: "scheduled",
      body: "b",
      startsAt: "2099-01-01T00:00:00.000Z",
    })
    createAnnouncement({
      title: "expired",
      body: "b",
      startsAt: "2020-01-01T00:00:00.000Z",
      endsAt: "2020-02-01T00:00:00.000Z",
    })

    const response = await request("GET", undefined, { cookie: adminCookie() })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.announcements).toHaveLength(3)
    expect(body.announcements.map((a: { title: string }) => a.title).sort()).toEqual([
      "expired",
      "live",
      "scheduled",
    ])
  })
})

describe("POST /api/admin/announcements", () => {
  it("rejects cross-origin requests", async () => {
    const response = await request("POST", VALID_BODY, {
      cookie: adminCookie(),
      origin: "https://evil.example.com",
    })
    expect(response.status).toBe(403)
  })

  it("rejects unauthenticated requests with 401", async () => {
    const response = await request("POST", VALID_BODY)
    expect(response.status).toBe(401)
  })

  it("creates a published announcement", async () => {
    const response = await request("POST", VALID_BODY, { cookie: adminCookie() })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.announcement).toMatchObject({
      title: "Maintenance window",
      body: "We will be down on Sunday.",
      audience: "all",
      startsAt: "2026-03-01T00:00:00.000Z",
      endsAt: "2026-03-02T00:00:00.000Z",
    })
    expect(body.announcement.id).toMatch(/^ann_/)
    expect(body.announcement.publishedAt).toBeTruthy()
  })

  it("accepts a minimal payload with CTA and admin audience", async () => {
    const response = await request(
      "POST",
      {
        title: "Admins",
        body: "Internal note",
        ctaLabel: "Open",
        ctaHref: "/app/admin",
        audience: "admins",
        startsAt: "2026-03-01T00:00:00.000Z",
      },
      { cookie: adminCookie() },
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.announcement).toMatchObject({
      audience: "admins",
      ctaLabel: "Open",
      ctaHref: "/app/admin",
    })
    expect(body.announcement.endsAt).toBeUndefined()
  })

  it("accepts internal and https CTA hrefs", async () => {
    const cookie = adminCookie()
    for (const ctaHref of ["/docs", "https://example.com/post"]) {
      const response = await request("POST", { ...VALID_BODY, ctaHref }, { cookie })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.announcement.ctaHref).toBe(ctaHref)
    }
  })

  it("rejects invalid payloads", async () => {
    const cookie = adminCookie()
    // Missing title.
    expect((await request("POST", { ...VALID_BODY, title: "" }, { cookie })).status).toBe(400)
    // endsAt before startsAt.
    expect(
      (await request("POST", { ...VALID_BODY, endsAt: "2026-02-01T00:00:00.000Z" }, { cookie }))
        .status,
    ).toBe(400)
    // Bad audience.
    expect(
      (await request("POST", { ...VALID_BODY, audience: "everyone" }, { cookie })).status,
    ).toBe(400)
    // Unsafe CTA href.
    expect(
      (
        await request(
          "POST",
          { ...VALID_BODY, ctaLabel: "x", ctaHref: "javascript:alert(1)" },
          { cookie },
        )
      ).status,
    ).toBe(400)
    // Protocol-relative URL — starts with "/" but is external.
    expect(
      (
        await request(
          "POST",
          { ...VALID_BODY, ctaLabel: "x", ctaHref: "//evil.example.com" },
          { cookie },
        )
      ).status,
    ).toBe(400)
    // Unparseable startsAt.
    expect((await request("POST", { ...VALID_BODY, startsAt: "soon" }, { cookie })).status).toBe(
      400,
    )
  })

  it("rejects malformed JSON", async () => {
    const response = await request("POST", "{oops", { cookie: adminCookie() })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, code: "invalid_request" })
  })
})
