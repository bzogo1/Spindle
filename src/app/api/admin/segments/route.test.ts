// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { clearSegmentsForTests, createSegment } from "@/lib/segments"

import { GET, POST } from "./route"

const backendHolder = vi.hoisted(() => ({
  current: null as { getUserById: (id: string) => Promise<unknown> } | null,
}))

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => backendHolder.current,
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
    "x-forwarded-for": `10.9.6.${ipCounter}`,
    ...(options.cookie ? { cookie: `${ACCESS_COOKIE}=${options.cookie}` } : {}),
    ...(body !== undefined ? { "content-type": "application/json" } : {}),
    ...(options.origin ? { origin: options.origin } : {}),
  }
  return (method === "GET" ? GET : POST)(
    new Request("http://localhost/api/admin/segments", {
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
  name: "Verified example users",
  description: "Users with a verified email on example.com",
  combinator: "all",
  rules: [
    { field: "emailVerified", operator: "isTrue", value: "" },
    { field: "emailDomain", operator: "equals", value: "example.com" },
  ],
}

beforeEach(() => {
  backendHolder.current = { getUserById: async () => adminUser }
  setAdminEmailsForTests(["admin@example.com"])
  clearSegmentsForTests()
})

afterEach(() => {
  setAdminEmailsForTests(null)
})

describe("GET /api/admin/segments", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await request("GET")
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthorized" })
  })

  it("rejects a signed-in non-admin with 403", async () => {
    backendHolder.current = {
      getUserById: async () => ({ ...adminUser, id: "u9", email: "user@example.com" }),
    }
    const response = await request("GET", undefined, {
      cookie: cookieFor("user@example.com", "u9"),
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
  })

  it("lists all segments newest first", async () => {
    createSegment({
      name: "first",
      rules: [{ field: "hasSession", operator: "isTrue", value: "" }],
    })
    // Ensure distinct createdAt timestamps for the newest-first ordering.
    await new Promise((resolve) => setTimeout(resolve, 2))
    createSegment({
      name: "second",
      combinator: "any",
      rules: [{ field: "role", operator: "equals", value: "admin" }],
    })

    const response = await request("GET", undefined, { cookie: adminCookie() })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.segments).toHaveLength(2)
    expect(body.segments[0].name).toBe("second")
  })
})

describe("POST /api/admin/segments", () => {
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

  it("creates a segment and normalizes rule values", async () => {
    const response = await request(
      "POST",
      {
        name: "Domain segment",
        combinator: "any",
        rules: [{ field: "emailDomain", operator: "equals", value: " Example.COM " }],
      },
      { cookie: adminCookie() },
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.segment.id).toMatch(/^seg_/)
    expect(body.segment.combinator).toBe("any")
    expect(body.segment.rules[0].value).toBe("example.com")
  })

  it("accepts every field/operator combination the schema allows", async () => {
    const cookie = adminCookie()
    const cases: Array<Record<string, unknown>> = [
      { field: "emailDomain", operator: "notEquals", value: "example.com" },
      { field: "emailDomain", operator: "contains", value: "example.com" },
      { field: "emailVerified", operator: "isFalse", value: "" },
      { field: "createdAfter", operator: "is", value: "2026-01-01T00:00:00.000Z" },
      { field: "createdBefore", operator: "is", value: "2026-12-31T00:00:00.000Z" },
      { field: "hasSession", operator: "isTrue", value: "" },
      { field: "role", operator: "equals", value: "member" },
      { field: "role", operator: "notEquals", value: "admin" },
    ]
    for (const rule of cases) {
      const response = await request(
        "POST",
        { name: `seg-${rule.field}-${rule.operator}`, rules: [rule] },
        { cookie },
      )
      expect(response.status).toBe(200)
    }
  })

  it("rejects invalid payloads", async () => {
    const cookie = adminCookie()
    // Missing name.
    expect((await request("POST", { ...VALID_BODY, name: "" }, { cookie })).status).toBe(400)
    // Unknown field.
    expect(
      (
        await request(
          "POST",
          { ...VALID_BODY, rules: [{ field: "bogus", operator: "equals", value: "x" }] },
          { cookie },
        )
      ).status,
    ).toBe(400)
    // Operator not allowed for the field.
    expect(
      (
        await request(
          "POST",
          {
            ...VALID_BODY,
            rules: [{ field: "emailVerified", operator: "equals", value: "" }],
          },
          { cookie },
        )
      ).status,
    ).toBe(400)
    // Invalid domain value (passes zod, rejected by createSegment).
    expect(
      (
        await request(
          "POST",
          {
            ...VALID_BODY,
            rules: [{ field: "emailDomain", operator: "equals", value: "not a domain" }],
          },
          { cookie },
        )
      ).status,
    ).toBe(400)
    // Value on a boolean predicate.
    expect(
      (
        await request(
          "POST",
          {
            ...VALID_BODY,
            rules: [{ field: "hasSession", operator: "isTrue", value: "yes" }],
          },
          { cookie },
        )
      ).status,
    ).toBe(400)
    // Empty rules.
    expect((await request("POST", { ...VALID_BODY, rules: [] }, { cookie })).status).toBe(400)
    // Bad combinator.
    expect((await request("POST", { ...VALID_BODY, combinator: "some" }, { cookie })).status).toBe(
      400,
    )
    // Bad date.
    expect(
      (
        await request(
          "POST",
          {
            ...VALID_BODY,
            rules: [{ field: "createdAfter", operator: "is", value: "soon" }],
          },
          { cookie },
        )
      ).status,
    ).toBe(400)
  })

  it("rejects malformed JSON", async () => {
    const response = await request("POST", "{oops", { cookie: adminCookie() })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, code: "invalid_request" })
  })
})
