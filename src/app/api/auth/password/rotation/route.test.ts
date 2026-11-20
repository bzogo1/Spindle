// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import {
  MemoryPasswordRotationStore,
  setPasswordRotationStoreForTests,
  type PasswordRotationPolicy,
} from "@/lib/password-rotation"
import { createAccessToken } from "@/lib/auth/token-codec"
import { GET, PUT } from "./route"

const getUserById = vi.fn()

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ getUserById }),
  }
})

const user = {
  id: "u1",
  email: "ada@lab.edu",
  name: "Ada",
  emailVerified: true,
  createdAt: new Date().toISOString(),
}

const validBody: PasswordRotationPolicy = {
  maxPasswordAgeDays: 90,
  passwordHistoryCount: 5,
}

let store: MemoryPasswordRotationStore

function accessCookie(uid = user.id) {
  return createAccessToken({ sid: "s1", uid, email: user.email, name: user.name }).token
}

function request(path: string, init: RequestInit = {}, cookie?: string) {
  const headers = new Headers(init.headers)
  if (cookie) headers.set("cookie", `${ACCESS_COOKIE}=${cookie}`)
  return new Request(`http://localhost${path}`, { ...init, headers })
}

function get(cookie?: string) {
  return GET(request("/api/auth/password/rotation", {}, cookie))
}

function put(body: unknown, cookie?: string, headers: Record<string, string> = {}) {
  return PUT(
    request(
      "/api/auth/password/rotation",
      {
        method: "PUT",
        headers: { "content-type": "application/json", ...headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
      },
      cookie,
    ),
  )
}

beforeEach(() => {
  getUserById
    .mockReset()
    .mockImplementation(async (id: string) => (id === "u1" || id === "u2" ? { ...user, id } : null))
  store = new MemoryPasswordRotationStore()
  setPasswordRotationStoreForTests(store)
})

describe("GET /api/auth/password/rotation", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await get()
    expect(response.status).toBe(401)
    expect(getUserById).not.toHaveBeenCalled()
  })

  it("rejects tokens whose user no longer exists", async () => {
    getUserById.mockResolvedValue(null)
    const response = await get(accessCookie())
    expect(response.status).toBe(401)
  })

  it("returns default policy and status for a fresh principal", async () => {
    const response = await get(accessCookie())
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(data.policy).toEqual({ maxPasswordAgeDays: 0, passwordHistoryCount: 0 })
    expect(data.status.expired).toBe(false)
    expect(data.status.passwordAgeTracked).toBe(false)
    expect(data.status.expiresAt).toBeNull()
    expect(data.status.historySize).toBe(0)
  })
})

describe("PUT /api/auth/password/rotation", () => {
  it("rejects cross-origin requests", async () => {
    const response = await put(validBody, accessCookie(), {
      origin: "https://evil.example",
    })
    expect(response.status).toBe(403)
  })

  it("rejects unauthenticated requests", async () => {
    expect((await put(validBody)).status).toBe(401)
  })

  it("rejects malformed bodies", async () => {
    expect((await put("not json", accessCookie())).status).toBe(400)
    expect((await put({ maxPasswordAgeDays: 30 }, accessCookie())).status).toBe(400)
    expect(
      (await put({ maxPasswordAgeDays: -5, passwordHistoryCount: 0 }, accessCookie())).status,
    ).toBe(400)
    expect(
      (await put({ maxPasswordAgeDays: 30, passwordHistoryCount: 0, extra: true }, accessCookie()))
        .status,
    ).toBe(400)
  })

  it("stores the policy and echoes policy + status", async () => {
    const response = await put(validBody, accessCookie())
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(data.policy).toEqual(validBody)
    expect(store.getRecord("u1").policy).toEqual(validBody)

    const getData = await (await get(accessCookie())).json()
    expect(getData.policy).toEqual(validBody)
  })

  it("reports advisory expired status (untracked age) after setting a max age", async () => {
    const data = await (
      await put({ maxPasswordAgeDays: 30, passwordHistoryCount: 0 }, accessCookie())
    ).json()
    // Enforcement is not wired: expired/changeRequired are predictions
    // only, and passwordAgeTracked=false marks the age as unknown so the
    // UI shows "not yet tracked" rather than "change required".
    expect(data.status.expired).toBe(true)
    expect(data.status.changeRequired).toBe(true)
    expect(data.status.passwordAgeTracked).toBe(false)
    expect(data.status.passwordChangedAt).toBeNull()
  })

  it("scopes policies per principal", async () => {
    await put(validBody, accessCookie("u1"))
    const other = await (await get(accessCookie("u2"))).json()
    expect(other.policy).toEqual({ maxPasswordAgeDays: 0, passwordHistoryCount: 0 })
  })
})
