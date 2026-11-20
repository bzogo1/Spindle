// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { getTrustedDeviceStore, setTrustedDeviceStoreForTests } from "@/lib/auth/totp-devices"
import { POST } from "./route"

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

const FP_A = "fp1:" + "a".repeat(64)
const FP_B = "fp1:" + "b".repeat(64)

function accessCookie(uid = user.id) {
  return createAccessToken({ sid: "s1", uid, email: user.email, name: user.name }).token
}

function post(cookie?: string, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/auth/2fa/devices/revoke-all", {
      method: "POST",
      headers: {
        ...(cookie ? { cookie: `${ACCESS_COOKIE}=${cookie}` } : {}),
        ...headers,
      },
    }),
  )
}

beforeEach(() => {
  getUserById.mockReset().mockImplementation(async (id: string) => ({ ...user, id }))
  setTrustedDeviceStoreForTests(undefined)
})

describe("POST /api/auth/2fa/devices/revoke-all", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await post()
    expect(response.status).toBe(401)
  })

  it("rejects cross-origin requests", async () => {
    const response = await post(accessCookie(), { origin: "https://evil.example" })
    expect(response.status).toBe(403)
  })

  it("revokes every trusted device for the caller only", async () => {
    const store = getTrustedDeviceStore()
    store.trust({ userId: user.id, fingerprintHash: FP_A, sessionId: "s1" })
    store.trust({ userId: user.id, fingerprintHash: FP_B, sessionId: "s1" })
    store.trust({ userId: "u2", fingerprintHash: FP_A, sessionId: "s9" })

    const response = await post(accessCookie())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, revoked: 2 })
    expect(store.listActive(user.id)).toHaveLength(0)
    expect(store.listActive("u2")).toHaveLength(1)
  })

  it("is idempotent when nothing is trusted", async () => {
    const response = await post(accessCookie())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, revoked: 0 })
  })
})
