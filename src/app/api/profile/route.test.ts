import { beforeEach, describe, expect, it, vi } from "vitest"

import { createAccessToken } from "@/lib/auth/token-codec"
import {
  encodeMockSession,
  MOCK_SESSION_COOKIE,
  type MockSessionData,
} from "@/lib/auth/mock-session"
import { resetProfileOverridesForTests } from "@/lib/profile"
import {
  confirmEmailChange,
  requestEmailChange,
  resetEmailChangeStoreForTests,
} from "@/lib/email-change"

import { GET, PUT } from "./route"

// Enable the mock-session branch of the route's session resolution; the real
// encode/decode helpers stay intact via importOriginal.
vi.mock("@/lib/auth/mock-session", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/auth/mock-session")>()
  return { ...mod, mockAuthEnabled: true }
})

const UID = "user-profile-test"

const mockSession: MockSessionData = {
  user: { name: "Bogdan Zogovic", email: "bogdan@example.com" },
  workspace: { name: "Personal workspace", slug: "personal" },
  signedInAt: "2026-11-19T12:00:00.000Z",
}

function authCookie() {
  const { token } = createAccessToken({
    sid: "sid-1",
    uid: UID,
    email: "real@example.com",
    name: "Real User",
  })
  return `spindle_at=${token}`
}

function mockCookie() {
  return `${MOCK_SESSION_COOKIE}=${encodeMockSession(mockSession)}`
}

function get(cookie?: string) {
  return GET(
    new Request("http://localhost/api/profile", {
      headers: cookie ? { cookie } : {},
    }),
  )
}

function put(body: unknown, cookie?: string, headers: Record<string, string> = {}) {
  return PUT(
    new Request("http://localhost/api/profile", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  resetProfileOverridesForTests()
  resetEmailChangeStoreForTests()
})

describe("GET /api/profile", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await get()
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthenticated" })
  })

  it("returns the profile from the real access-token session", async () => {
    const response = await get(authCookie())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      ok: true,
      profile: { name: "Real User", email: "real@example.com", memberSince: null },
    })
  })

  it("returns the profile from the mock session cookie", async () => {
    const response = await get(mockCookie())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      profile: {
        name: "Bogdan Zogovic",
        email: "bogdan@example.com",
        memberSince: "2026-11-19T12:00:00.000Z",
      },
    })
  })
})

describe("PUT /api/profile", () => {
  it("rejects cross-origin requests before auth or parsing", async () => {
    const response = await put({ name: "X" }, mockCookie(), {
      origin: "https://evil.example.com",
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
  })

  it("rejects unauthenticated requests", async () => {
    const response = await put({ name: "Ada" })
    expect(response.status).toBe(401)
  })

  it("rejects malformed JSON", async () => {
    const response = await put("{nope", mockCookie())
    expect(response.status).toBe(400)
  })

  it("rejects missing, empty, and over-long names", async () => {
    const cookie = mockCookie()
    expect((await put({}, cookie)).status).toBe(422)
    expect((await put({ name: "   " }, cookie)).status).toBe(422)
    expect((await put({ name: "x".repeat(81) }, cookie)).status).toBe(422)
    expect((await put({ name: 42 }, cookie)).status).toBe(422)
  })

  it("persists the display name for the session principal", async () => {
    const cookie = mockCookie()

    const saved = await put({ name: "  Ada   Lovelace " }, cookie)
    expect(saved.status).toBe(200)
    expect(await saved.json()).toMatchObject({
      ok: true,
      profile: { name: "Ada Lovelace", email: "bogdan@example.com" },
    })

    const fetched = await get(cookie)
    expect(await fetched.json()).toMatchObject({
      ok: true,
      profile: { name: "Ada Lovelace" },
    })
  })

  it("returns the effective email after a confirmed email change", async () => {
    const cookie = mockCookie()
    const requested = requestEmailChange(
      { principal: "mock:bogdan@example.com", userId: null, email: "bogdan@example.com" },
      "new@example.com",
    )
    expect(requested.ok).toBe(true)
    if (!requested.ok) return
    const confirmed = await confirmEmailChange(requested.token)
    expect(confirmed.ok).toBe(true)

    const response = await get(cookie)
    expect(await response.json()).toMatchObject({
      ok: true,
      profile: { email: "new@example.com" },
    })
  })

  it("keeps overrides scoped per principal", async () => {
    await put({ name: "Mock Name" }, mockCookie())

    const real = await get(authCookie())
    expect(await real.json()).toMatchObject({
      ok: true,
      profile: { name: "Real User" },
    })
  })
})
