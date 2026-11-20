// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { resetEmailAbForTests } from "@/lib/email-ab"

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

function request(path: string, init?: RequestInit, cookie?: string) {
  ipCounter += 1
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.8.1.${ipCounter}`,
    ...(init?.headers as Record<string, string> | undefined),
  }
  if (cookie) headers.cookie = `${ACCESS_COOKIE}=${cookie}`
  return new Request(`http://localhost${path}`, { ...init, headers })
}

function get(query = "", cookie?: string) {
  return GET(request(`/api/admin/email-ab${query}`, undefined, cookie))
}

function post(body: unknown, cookie?: string) {
  return POST(
    request(
      "/api/admin/email-ab",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      cookie,
    ),
  )
}

const adminCookie = () => cookieFor("admin@example.com", "admin-1")

const validBody = {
  name: "Welcome subject test",
  emailKey: "welcome-day-0",
  variants: [
    { key: "control", subject: "Welcome aboard", body: "Hi there" },
    { key: "b", subject: "You're in!" },
  ],
}

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockResolvedValue(adminUser)
  setAdminEmailsForTests(["admin@example.com"])
  resetEmailAbForTests()
})

afterEach(() => {
  setAdminEmailsForTests(null)
})

describe("GET /api/admin/email-ab", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await get()
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthorized" })
  })

  it("rejects a signed-in non-admin with 403", async () => {
    getUserById.mockResolvedValue({ ...adminUser, id: "u9", email: "user@example.com" })
    const response = await get("", cookieFor("user@example.com", "u9"))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
  })

  it("lists experiments and filters by status", async () => {
    await post(validBody, adminCookie())
    const response = await get("", adminCookie())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.experiments).toHaveLength(1)
    expect(body.experiments[0]).toMatchObject({
      name: "Welcome subject test",
      emailKey: "welcome-day-0",
      status: "draft",
    })
    expect(body.experiments[0].variants).toHaveLength(2)

    const drafts = await get("?status=draft", adminCookie())
    expect((await drafts.json()).experiments).toHaveLength(1)
    const running = await get("?status=running", adminCookie())
    expect((await running.json()).experiments).toHaveLength(0)
  })

  it("rejects an invalid status filter", async () => {
    const response = await get("?status=bogus", adminCookie())
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, code: "invalid_request" })
  })
})

describe("POST /api/admin/email-ab", () => {
  it("rejects unauthenticated and non-admin requests", async () => {
    expect((await post(validBody)).status).toBe(401)
    getUserById.mockResolvedValue({ ...adminUser, id: "u9", email: "user@example.com" })
    expect((await post(validBody, cookieFor("user@example.com", "u9"))).status).toBe(403)
  })

  it("creates a draft experiment", async () => {
    const response = await post(validBody, adminCookie())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.experiment.status).toBe("draft")
    expect(body.experiment.variants[0].bodyPreview).toBe("Hi there")
  })

  it("rejects invalid payloads", async () => {
    const cases: unknown[] = [
      {},
      { ...validBody, name: "" },
      { ...validBody, emailKey: "" },
      { ...validBody, variants: [{ key: "a", subject: "s" }] }, // too few
      {
        ...validBody,
        variants: [
          { key: "a", subject: "s" },
          { key: "b", subject: "s" },
          { key: "c", subject: "s" },
          { key: "d", subject: "s" },
          { key: "e", subject: "s" },
        ],
      }, // too many
      {
        ...validBody,
        variants: [
          { key: "a", subject: "s" },
          { key: "a", subject: "s2" },
        ],
      }, // duplicate keys
      {
        ...validBody,
        variants: [
          { key: "a", subject: "" },
          { key: "b", subject: "s" },
        ],
      },
      "not json",
    ]
    for (const body of cases) {
      const response =
        typeof body === "string"
          ? await POST(request("/api/admin/email-ab", { method: "POST", body }, adminCookie()))
          : await post(body, adminCookie())
      expect(response.status).toBe(400)
    }
  })
})
