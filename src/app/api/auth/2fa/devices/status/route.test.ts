// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  getDeviceFingerprintStore,
  setDeviceFingerprintStoreForTests,
} from "@/lib/auth/fingerprint"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { getTrustedDeviceStore, setTrustedDeviceStoreForTests } from "@/lib/auth/totp-devices"
import { GET } from "./route"

const getUserById = vi.fn()
const isTotpEnabled = vi.fn()

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ getUserById, isTotpEnabled }),
  }
})

const user = {
  id: "u1",
  email: "ada@lab.edu",
  name: "Ada",
  emailVerified: true,
  createdAt: new Date().toISOString(),
}

const FP = "fp1:" + "a".repeat(64)

function accessCookie(uid = user.id, sid = "s1") {
  return createAccessToken({ sid, uid, email: user.email, name: user.name }).token
}

function get(cookie?: string) {
  return GET(
    new Request("http://localhost/api/auth/2fa/devices/status", {
      headers: cookie ? { cookie: `${ACCESS_COOKIE}=${cookie}` } : {},
    }),
  )
}

beforeEach(() => {
  getUserById.mockReset().mockImplementation(async (id: string) => ({ ...user, id }))
  isTotpEnabled.mockReset().mockResolvedValue(true)
  setTrustedDeviceStoreForTests(undefined)
  setDeviceFingerprintStoreForTests(undefined)
})

describe("GET /api/auth/2fa/devices/status", () => {
  it("rejects unauthenticated requests", async () => {
    expect((await get()).status).toBe(401)
  })

  it("reports zero trusted devices and untrusted current device", async () => {
    const response = await get(accessCookie())
    expect(await response.json()).toMatchObject({
      ok: true,
      totpEnabled: true,
      trustedCount: 0,
      currentDeviceTrusted: false,
    })
  })

  it("counts trusted devices and detects the current one", async () => {
    getDeviceFingerprintStore().register({ userId: user.id, sessionId: "s1", hash: FP })
    getTrustedDeviceStore().trust({
      userId: user.id,
      fingerprintHash: FP,
      sessionId: "s1",
    })
    getTrustedDeviceStore().trust({
      userId: user.id,
      fingerprintHash: "fp1:" + "b".repeat(64),
      sessionId: "s2",
    })

    const response = await get(accessCookie())
    expect(await response.json()).toMatchObject({
      ok: true,
      totpEnabled: true,
      trustedCount: 2,
      currentDeviceTrusted: true,
    })
  })

  it("reflects totpEnabled false", async () => {
    isTotpEnabled.mockResolvedValue(false)
    const response = await get(accessCookie())
    expect(await response.json()).toMatchObject({ ok: true, totpEnabled: false })
  })
})
