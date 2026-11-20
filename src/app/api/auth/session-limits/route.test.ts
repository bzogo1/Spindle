// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import {
  DEFAULT_SESSION_LIMIT,
  MemorySessionLimitStore,
  setSessionLimitStoreForTests,
} from "@/lib/auth/session-limits"
import { createAccessToken } from "@/lib/auth/token-codec"
import { GET, PUT } from "./route"

const getUserById = vi.fn()
const listSessions = vi.fn()

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ getUserById, listSessions }),
  }
})

const user = {
  id: "u1",
  email: "ada@lab.edu",
  name: "Ada",
  emailVerified: true,
  createdAt: new Date().toISOString(),
}

const activeSessions = [
  { id: "s3", createdAt: "2025-01-03T00:00:00.000Z", expiresAt: "2025-02-01T00:00:00.000Z" },
  { id: "s2", createdAt: "2025-01-02T00:00:00.000Z", expiresAt: "2025-02-01T00:00:00.000Z" },
  { id: "s1", createdAt: "2025-01-01T00:00:00.000Z", expiresAt: "2025-02-01T00:00:00.000Z" },
]

let store: MemorySessionLimitStore

function accessCookie(uid = user.id) {
  return createAccessToken({ sid: "s1", uid, email: user.email, name: user.name }).token
}

function request(path: string, init: RequestInit = {}, cookie?: string) {
  const headers = new Headers(init.headers)
  if (cookie) headers.set("cookie", `${ACCESS_COOKIE}=${cookie}`)
  return new Request(`http://localhost${path}`, { ...init, headers })
}

function get(cookie?: string) {
  return GET(request("/api/auth/session-limits", {}, cookie))
}

function put(body: unknown, cookie?: string, headers: Record<string, string> = {}) {
  return PUT(
    request(
      "/api/auth/session-limits",
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
  listSessions.mockReset().mockResolvedValue(activeSessions)
  store = new MemorySessionLimitStore()
  setSessionLimitStoreForTests(store)
})

describe("GET /api/auth/session-limits", () => {
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

  it("returns the default limit and active session usage", async () => {
    const response = await get(accessCookie())
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(data.limit).toBe(DEFAULT_SESSION_LIMIT)
    expect(data.unlimited).toBe(false)
    expect(data.activeCount).toBe(3)
    expect(data.sessions).toHaveLength(3)
    expect(listSessions).toHaveBeenCalledWith("u1")
  })
})

describe("PUT /api/auth/session-limits", () => {
  it("rejects cross-origin requests", async () => {
    const response = await put({ limit: 3 }, accessCookie(), {
      origin: "https://evil.example",
    })
    expect(response.status).toBe(403)
  })

  it("rejects unauthenticated requests", async () => {
    expect((await put({ limit: 3 })).status).toBe(401)
  })

  it("rejects malformed bodies and out-of-range limits", async () => {
    expect((await put("not json", accessCookie())).status).toBe(400)
    expect((await put({}, accessCookie())).status).toBe(400)
    expect((await put({ limit: -1 }, accessCookie())).status).toBe(400)
    expect((await put({ limit: 51 }, accessCookie())).status).toBe(400)
    expect((await put({ limit: 2.5 }, accessCookie())).status).toBe(400)
    expect((await put({ limit: 3, extra: true }, accessCookie())).status).toBe(400)
  })

  it("stores the limit and echoes usage", async () => {
    const response = await put({ limit: 2 }, accessCookie())
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(data.limit).toBe(2)
    expect(store.getStoredLimit("u1")).toBe(2)

    const getData = await (await get(accessCookie())).json()
    expect(getData.limit).toBe(2)
  })

  it("accepts 0 as unlimited", async () => {
    const response = await put({ limit: 0 }, accessCookie())
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.limit).toBe(0)
    expect(data.unlimited).toBe(true)
  })

  it("scopes limits per principal", async () => {
    await put({ limit: 1 }, accessCookie("u1"))
    const other = await get(accessCookie("u2"))
    const data = await other.json()
    expect(data.limit).toBe(DEFAULT_SESSION_LIMIT)
  })
})
