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
    new Request("http://localhost/api/auth/2fa/devices", {
      headers: cookie ? { cookie: `${ACCESS_COOKIE}=${cookie}` } : {},
    }),
  )
}

beforeEach(() => {
  getUserById.mockReset().mockResolvedValue(user)
  isTotpEnabled.mockReset().mockResolvedValue(true)
  setTrustedDeviceStoreForTests(undefined)
  setDeviceFingerprintStoreForTests(undefined)
})

describe("GET /api/auth/2fa/devices", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await get()
    expect(response.status).toBe(401)
  })

  it("returns empty list with totpEnabled and untrusted current device", async () => {
    const response = await get(accessCookie())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      totpEnabled: true,
      devices: [],
      currentDevice: { trusted: false, deviceId: null },
    })
  })

  it("lists trusted devices and flags the current session's device", async () => {
    const store = getDeviceFingerprintStore()
    store.register({ userId: user.id, sessionId: "s1", hash: FP })

    const deviceStore = getTrustedDeviceStore()
    const device = deviceStore.trust({
      userId: user.id,
      fingerprintHash: FP,
      sessionId: "s1",
      label: "Work laptop",
    })

    const response = await get(accessCookie())
    const body = await response.json()
    expect(body.devices).toHaveLength(1)
    expect(body.devices[0]).toMatchObject({
      id: device.id,
      label: "Work laptop",
      fingerprintVersion: "fp1",
    })
    // The raw fingerprint digest must never be echoed to clients.
    expect(JSON.stringify(body)).not.toContain(FP)
    expect(body.currentDevice).toEqual({ trusted: true, deviceId: device.id })
  })

  it("reports totpEnabled false when 2FA is off", async () => {
    isTotpEnabled.mockResolvedValue(false)
    const response = await get(accessCookie())
    expect(await response.json()).toMatchObject({ ok: true, totpEnabled: false })
  })
})
