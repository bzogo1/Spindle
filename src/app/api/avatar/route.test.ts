import { beforeEach, describe, expect, it, vi } from "vitest"

import { createAccessToken } from "@/lib/auth/token-codec"
import {
  encodeMockSession,
  MOCK_SESSION_COOKIE,
  type MockSessionData,
} from "@/lib/auth/mock-session"
import { getAvatar, AVATAR_MAX_BYTES, resetAvatarsForTests } from "@/lib/avatar"

import { DELETE, GET, PUT } from "./route"

// Enable the mock-session branch of session resolution, same as the profile
// route tests.
vi.mock("@/lib/auth/mock-session", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/auth/mock-session")>()
  return { ...mod, mockAuthEnabled: true }
})

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`

const mockSession: MockSessionData = {
  user: { name: "Bogdan Zogovic", email: "bogdan@example.com" },
  workspace: { name: "Personal workspace", slug: "personal" },
  signedInAt: "2026-11-19T12:00:00.000Z",
}

function mockCookie() {
  return `${MOCK_SESSION_COOKIE}=${encodeMockSession(mockSession)}`
}

function get(cookie?: string) {
  return GET(
    new Request("http://localhost/api/avatar", {
      headers: cookie ? { cookie } : {},
    }),
  )
}

function putJson(body: unknown, cookie?: string, headers: Record<string, string> = {}) {
  return PUT(
    new Request("http://localhost/api/avatar", {
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

function del(cookie?: string, headers: Record<string, string> = {}) {
  return DELETE(
    new Request("http://localhost/api/avatar", {
      method: "DELETE",
      headers: { ...(cookie ? { cookie } : {}), ...headers },
    }),
  )
}

beforeEach(() => {
  resetAvatarsForTests()
})

describe("GET /api/avatar", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await get()
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthenticated" })
  })

  it("returns null when no avatar is stored", async () => {
    const response = await get(mockCookie())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, avatar: null })
  })

  it("returns the stored avatar data URL", async () => {
    await putJson({ dataUrl: PNG_DATA_URL }, mockCookie())
    const response = await get(mockCookie())
    const body = await response.json()
    expect(body.avatar.dataUrl).toBe(PNG_DATA_URL)
    expect(body.avatar.mime).toBe("image/png")
  })
})

describe("PUT /api/avatar", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await putJson({ dataUrl: PNG_DATA_URL })
    expect(response.status).toBe(401)
  })

  it("rejects cross-origin mutations", async () => {
    const response = await putJson({ dataUrl: PNG_DATA_URL }, mockCookie(), {
      origin: "https://evil.example.com",
    })
    // The request URL host is localhost; a foreign Origin must be blocked.
    expect(response.status).toBe(403)
  })

  it("stores an avatar uploaded as a JSON dataUrl", async () => {
    const response = await putJson({ dataUrl: PNG_DATA_URL }, mockCookie())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.avatar.dataUrl).toBe(PNG_DATA_URL)
    expect(getAvatar("mock:bogdan@example.com")?.dataUrl).toBe(PNG_DATA_URL)
  })

  it("accepts raw base64 data with a mime hint", async () => {
    const response = await putJson({ data: PNG_BASE64, mime: "image/png" }, mockCookie())
    expect(response.status).toBe(200)
  })

  it("accepts multipart/form-data uploads", async () => {
    const bytes = Buffer.from(PNG_BASE64, "base64")
    // jsdom's FormData/File are not interchangeable with undici's, so
    // `Request#formData()` cannot parse a real multipart body in this
    // environment. Stub the method with a jsdom FormData instead — the route
    // only relies on `formData()`, `headers`, and `json()`.
    const form = new FormData()
    form.append("avatar", new File([bytes], "avatar.png", { type: "image/png" }))
    const request = {
      headers: new Headers({
        cookie: mockCookie(),
        "content-type": "multipart/form-data; boundary=test",
      }),
      formData: () => Promise.resolve(form),
    } as unknown as Request
    const response = await PUT(request)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.avatar.dataUrl).toBe(PNG_DATA_URL)
  })

  it("rejects oversized multipart parts before buffering them", async () => {
    const oversized = new Uint8Array(AVATAR_MAX_BYTES + 1)
    oversized.set(Buffer.from(PNG_BASE64, "base64").subarray(0, 8), 0)
    const file = new File([oversized], "huge.png", { type: "image/png" })
    const arrayBufferSpy = vi.spyOn(file, "arrayBuffer")

    const form = new FormData()
    form.append("avatar", file)
    const request = {
      headers: new Headers({
        cookie: mockCookie(),
        "content-type": "multipart/form-data; boundary=test",
      }),
      formData: () => Promise.resolve(form),
    } as unknown as Request
    const response = await PUT(request)

    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({ ok: false, code: "file_too_large" })
    // The early size check must fire before the part is read into memory.
    expect(arrayBufferSpy).not.toHaveBeenCalled()
  })

  it("rejects non-image bytes even with an image MIME", async () => {
    const fake = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>")
    const response = await putJson(
      { dataUrl: `data:image/png;base64,${fake.toString("base64")}` },
      mockCookie(),
    )
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ ok: false, code: "invalid_avatar" })
  })

  it("rejects malformed JSON bodies", async () => {
    const response = await putJson("{not json", mockCookie())
    expect(response.status).toBe(400)
  })

  it("rejects bodies without an image payload", async () => {
    const response = await putJson({ hello: "world" }, mockCookie())
    expect(response.status).toBe(400)
  })
})

describe("DELETE /api/avatar", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await del()
    expect(response.status).toBe(401)
  })

  it("removes the stored avatar", async () => {
    await putJson({ dataUrl: PNG_DATA_URL }, mockCookie())
    const response = await del(mockCookie())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, avatar: null })
    expect(getAvatar("mock:bogdan@example.com")).toBeNull()
  })

  it("is idempotent when no avatar exists", async () => {
    const response = await del(mockCookie())
    expect(response.status).toBe(200)
  })
})

describe("real-session auth", () => {
  it("accepts a spindle_at access token", async () => {
    const { token } = createAccessToken({
      sid: "sid-1",
      uid: "user-avatar-test",
      email: "real@example.com",
      name: "Real User",
    })
    const response = await putJson({ dataUrl: PNG_DATA_URL }, `spindle_at=${token}`)
    expect(response.status).toBe(200)
    expect(getAvatar("user:user-avatar-test")?.mime).toBe("image/png")
  })
})
