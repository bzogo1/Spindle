import { beforeEach, describe, expect, it, vi } from "vitest"

import { createAccessToken } from "@/lib/auth/token-codec"
import {
  encodeMockSession,
  MOCK_SESSION_COOKIE,
  type MockSessionData,
} from "@/lib/auth/mock-session"
import { defaultUserPreferences, resetUserPreferencesForTests } from "@/lib/preferences"

import { GET, PUT } from "./route"

// Enable the mock-session branch of the route's session resolution; the real
// encode/decode helpers stay intact via importOriginal.
vi.mock("@/lib/auth/mock-session", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/auth/mock-session")>()
  return { ...mod, mockAuthEnabled: true }
})

const UID = "user-prefs-test"

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
    new Request("http://localhost/api/preferences", {
      headers: cookie ? { cookie } : {},
    }),
  )
}

function put(body: unknown, cookie?: string, headers: Record<string, string> = {}) {
  return PUT(
    new Request("http://localhost/api/preferences", {
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
  resetUserPreferencesForTests()
})

describe("GET /api/preferences", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await get()
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthenticated" })
  })

  it("returns defaults for the real access-token session", async () => {
    const response = await get(authCookie())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      preferences: defaultUserPreferences(),
    })
  })

  it("returns defaults for the mock session cookie", async () => {
    const response = await get(mockCookie())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      preferences: defaultUserPreferences(),
    })
  })
})

describe("PUT /api/preferences", () => {
  it("rejects cross-origin requests before auth or parsing", async () => {
    const response = await put({ preferences: { density: "compact" } }, mockCookie(), {
      origin: "https://evil.example.com",
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
  })

  it("rejects unauthenticated requests", async () => {
    const response = await put({ preferences: {} })
    expect(response.status).toBe(401)
  })

  it("rejects malformed JSON", async () => {
    const response = await put("{nope", mockCookie())
    expect(response.status).toBe(400)
  })

  it("rejects invalid preference payloads", async () => {
    const cookie = mockCookie()
    // Unknown density value.
    expect((await put({ preferences: { density: "huge" } }, cookie)).status).toBe(422)
    // Unknown week start.
    expect((await put({ preferences: { weekStartsOn: "friday" } }, cookie)).status).toBe(422)
    // Unknown keys are rejected by the strict schema.
    expect((await put({ preferences: { locale: "uk" } }, cookie)).status).toBe(422)
    // Empty project id is invalid; null is allowed.
    expect((await put({ preferences: { defaultProjectId: "" } }, cookie)).status).toBe(422)
    // Non-object preferences.
    expect((await put({ preferences: "yes" }, cookie)).status).toBe(422)
  })

  it("partial-updates preferences and merges them on GET", async () => {
    const cookie = mockCookie()

    const saved = await put({ preferences: { density: "compact", weekStartsOn: "sunday" } }, cookie)
    expect(saved.status).toBe(200)
    expect(await saved.json()).toMatchObject({
      ok: true,
      preferences: {
        density: "compact",
        weekStartsOn: "sunday",
        defaultProjectId: null,
        confirmDestructiveActions: true,
        reduceMotion: false,
      },
    })

    const fetched = await get(cookie)
    expect(await fetched.json()).toMatchObject({
      ok: true,
      preferences: { density: "compact", weekStartsOn: "sunday" },
    })

    // A second partial update keeps the earlier fields.
    await put({ preferences: { reduceMotion: true } }, cookie)
    const refetched = await get(cookie)
    expect(await refetched.json()).toMatchObject({
      ok: true,
      preferences: {
        density: "compact",
        weekStartsOn: "sunday",
        reduceMotion: true,
      },
    })
  })

  it("sets and clears the default project id", async () => {
    const cookie = mockCookie()

    await put({ preferences: { defaultProjectId: "prj_42" } }, cookie)
    expect(await (await get(cookie)).json()).toMatchObject({
      ok: true,
      preferences: { defaultProjectId: "prj_42" },
    })

    await put({ preferences: { defaultProjectId: null } }, cookie)
    expect(await (await get(cookie)).json()).toMatchObject({
      ok: true,
      preferences: { defaultProjectId: null },
    })
  })

  it("keeps overrides scoped per principal", async () => {
    await put({ preferences: { density: "compact" } }, mockCookie())

    const real = await get(authCookie())
    expect(await real.json()).toMatchObject({
      ok: true,
      preferences: { density: "comfortable" },
    })
  })
})
