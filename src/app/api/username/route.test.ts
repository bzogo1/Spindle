import { beforeEach, describe, expect, it, vi } from "vitest"

import { createAccessToken } from "@/lib/auth/token-codec"
import {
  encodeMockSession,
  MOCK_SESSION_COOKIE,
  type MockSessionData,
} from "@/lib/auth/mock-session"
import { resetProfileOverridesForTests } from "@/lib/profile"
import { resetUsernameStoreForTests } from "@/lib/username"
import { GET as getProfile } from "../profile/route"

import { GET, PUT } from "./route"

// Enable the mock-session branch of session resolution; the real
// encode/decode helpers stay intact via importOriginal.
vi.mock("@/lib/auth/mock-session", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/auth/mock-session")>()
  return { ...mod, mockAuthEnabled: true }
})

const mockSession: MockSessionData = {
  user: { name: "Bogdan Zogovic", email: "bogdan@example.com" },
  workspace: { name: "Personal workspace", slug: "personal" },
  signedInAt: "2026-11-19T12:00:00.000Z",
}

function authCookie() {
  const { token } = createAccessToken({
    sid: "sid-1",
    uid: "user-username-test",
    email: "real@example.com",
    name: "Real User",
  })
  return `spindle_at=${token}`
}

function mockCookie() {
  return `${MOCK_SESSION_COOKIE}=${encodeMockSession(mockSession)}`
}

function get(query = "", cookie?: string) {
  return GET(
    new Request(`http://localhost/api/username${query}`, {
      headers: cookie ? { cookie } : {},
    }),
  )
}

function put(body: unknown, cookie?: string, headers: Record<string, string> = {}) {
  return PUT(
    new Request("http://localhost/api/username", {
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
  resetUsernameStoreForTests()
  resetProfileOverridesForTests()
})

describe("GET /api/username", () => {
  it("reports a valid candidate as available, normalized", async () => {
    const response = await get("?handle=Ada_99")
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      available: true,
      username: "ada_99",
    })
  })

  it("reports invalid, reserved, and taken handles as unavailable", async () => {
    expect(await (await get("?handle=ab")).json()).toMatchObject({
      available: false,
      error: expect.any(String),
    })
    expect(await (await get("?handle=admin")).json()).toMatchObject({ available: false })

    await put({ handle: "ada" }, mockCookie())
    expect(await (await get("?handle=ADA")).json()).toMatchObject({
      available: false,
      username: "ada",
    })
  })

  it("treats the caller's own handle as available", async () => {
    const cookie = mockCookie()
    await put({ handle: "ada" }, cookie)
    const response = await get("?handle=ada", cookie)
    expect(await response.json()).toMatchObject({ available: true })
  })

  it("returns the caller's own handle when no candidate is given", async () => {
    expect(await (await get("", mockCookie())).json()).toMatchObject({ handle: null })

    await put({ handle: "ada" }, mockCookie())
    expect(await (await get("", mockCookie())).json()).toMatchObject({ handle: "ada" })
  })
})

describe("PUT /api/username", () => {
  it("rejects cross-origin requests before auth or parsing", async () => {
    const response = await put({ handle: "ada" }, mockCookie(), {
      origin: "https://evil.example.com",
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
  })

  it("rejects unauthenticated requests", async () => {
    expect((await put({ handle: "ada" })).status).toBe(401)
  })

  it("rejects malformed JSON", async () => {
    expect((await put("{nope", mockCookie())).status).toBe(400)
  })

  it("rejects invalid handles with 422", async () => {
    const cookie = mockCookie()
    expect((await put({ handle: "ab" }, cookie)).status).toBe(422)
    expect((await put({ handle: "admin" }, cookie)).status).toBe(422)
    expect((await put({ handle: "has-dash" }, cookie)).status).toBe(422)
    expect((await put({ handle: 42 }, cookie)).status).toBe(422)
    expect((await put({}, cookie)).status).toBe(422)
  })

  it("claims a handle, normalized, and surfaces it in the profile", async () => {
    const cookie = mockCookie()

    const saved = await put({ handle: "  Ada_99 " }, cookie)
    expect(saved.status).toBe(200)
    expect(await saved.json()).toMatchObject({ ok: true, handle: "ada_99" })

    const profile = await getProfile(
      new Request("http://localhost/api/profile", { headers: { cookie } }),
    )
    expect(await profile.json()).toMatchObject({
      ok: true,
      profile: { handle: "ada_99" },
    })
  })

  it("enforces uniqueness across principals", async () => {
    expect((await put({ handle: "ada" }, mockCookie())).status).toBe(200)
    const clash = await put({ handle: "ADA" }, authCookie())
    expect(clash.status).toBe(422)
    expect(await clash.json()).toMatchObject({ ok: false, code: "invalid_username" })
  })

  it("lets a principal change their handle", async () => {
    const cookie = mockCookie()
    await put({ handle: "ada" }, cookie)
    const changed = await put({ handle: "grace" }, cookie)
    expect(await changed.json()).toMatchObject({ ok: true, handle: "grace" })
    // The old handle is free again.
    expect(await (await get("?handle=ada", cookie)).json()).toMatchObject({
      available: true,
    })
  })

  it("releases the handle with { handle: null }", async () => {
    const cookie = mockCookie()
    await put({ handle: "ada" }, cookie)
    const cleared = await put({ handle: null }, cookie)
    expect(await cleared.json()).toMatchObject({ ok: true, handle: null })
    expect(await (await get("", cookie)).json()).toMatchObject({ handle: null })
  })
})
