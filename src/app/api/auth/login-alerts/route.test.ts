// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import { MemoryLoginAlertStore, setLoginAlertStoreForTests } from "@/lib/auth/login-alerts"
import { createAccessToken } from "@/lib/auth/token-codec"
import { GET, POST } from "./route"

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

let store: MemoryLoginAlertStore

function accessCookie(uid = user.id) {
  return createAccessToken({ sid: "s1", uid, email: user.email, name: user.name }).token
}

function request(path: string, init: RequestInit = {}, cookie?: string) {
  const headers = new Headers(init.headers)
  if (cookie) headers.set("cookie", `${ACCESS_COOKIE}=${cookie}`)
  return new Request(`http://localhost${path}`, { ...init, headers })
}

function get(cookie?: string) {
  return GET(request("/api/auth/login-alerts", {}, cookie))
}

function post(body: unknown, cookie?: string, headers: Record<string, string> = {}) {
  return POST(
    request(
      "/api/auth/login-alerts",
      {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      },
      cookie,
    ),
  )
}

beforeEach(() => {
  getUserById.mockReset().mockResolvedValue(user)
  store = new MemoryLoginAlertStore()
  setLoginAlertStoreForTests(store)
})

describe("GET /api/auth/login-alerts", () => {
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

  it("returns alerts, unread count, and preferences", async () => {
    store.createAlert({ userId: "u1", kind: "new_ip" })
    store.createAlert({ userId: "u1", kind: "velocity" })
    store.setPreferences("u1", { inAppNotifications: false })

    const response = await get(accessCookie())
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(data.alerts).toHaveLength(2)
    expect(data.unreadCount).toBe(2)
    expect(data.preferences).toEqual({
      inAppNotifications: false,
      emailNotifications: true,
    })
  })
})

describe("POST /api/auth/login-alerts", () => {
  it("rejects cross-origin requests", async () => {
    const response = await post({ action: "mark_all_read" }, accessCookie(), {
      origin: "https://evil.example",
    })
    expect(response.status).toBe(403)
  })

  it("rejects unauthenticated requests", async () => {
    const response = await post({ action: "mark_all_read" })
    expect(response.status).toBe(401)
  })

  it("rejects malformed bodies and unknown actions", async () => {
    expect((await post({ action: "nope" }, accessCookie())).status).toBe(400)
    expect((await post({ action: "mark_read" }, accessCookie())).status).toBe(400)
    expect((await post("not json", accessCookie())).status).toBe(400)
  })

  it("marks specific alerts read and returns fresh state", async () => {
    const first = store.createAlert({ userId: "u1", kind: "new_ip" })
    store.createAlert({ userId: "u1", kind: "velocity" })

    const response = await post(
      { action: "mark_read", ids: [first!.id, "la_missing"] },
      accessCookie(),
    )
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.unreadCount).toBe(1)
    expect(data.alerts.find((a: { id: string }) => a.id === first!.id).read).toBe(true)
    expect(store.unreadCount("u1")).toBe(1)
  })

  it("marks all alerts read", async () => {
    store.createAlert({ userId: "u1", kind: "new_ip" })
    store.createAlert({ userId: "u1", kind: "velocity" })
    const response = await post({ action: "mark_all_read" }, accessCookie())
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.unreadCount).toBe(0)
    expect(store.unreadCount("u1")).toBe(0)
  })

  it("merges preference updates", async () => {
    const response = await post(
      { action: "update_preferences", preferences: { emailNotifications: false } },
      accessCookie(),
    )
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.preferences).toEqual({
      inAppNotifications: true,
      emailNotifications: false,
    })
    expect(store.getPreferences("u1")).toEqual(data.preferences)
  })

  it("rejects empty preference updates", async () => {
    const response = await post({ action: "update_preferences", preferences: {} }, accessCookie())
    expect(response.status).toBe(400)
  })
})
