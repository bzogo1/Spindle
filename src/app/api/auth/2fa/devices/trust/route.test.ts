// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  getDeviceFingerprintStore,
  setDeviceFingerprintStoreForTests,
} from "@/lib/auth/fingerprint"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { getTrustedDeviceStore, setTrustedDeviceStoreForTests } from "@/lib/auth/totp-devices"
import { POST } from "./route"

const getUserById = vi.fn()
const isTotpEnabled = vi.fn()
const verifyUserTotp = vi.fn()

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ getUserById, isTotpEnabled, verifyUserTotp }),
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
const FP_OTHER = "fp1:" + "b".repeat(64)
const TOTP = "123456"

function accessCookie(uid = user.id, sid = "s1") {
  return createAccessToken({ sid, uid, email: user.email, name: user.name }).token
}

/** Registers FP as this session's fingerprint (as /api/auth/fingerprint would). */
function registerSessionFingerprint(sid = "s1", hash = FP) {
  getDeviceFingerprintStore().register({ userId: user.id, sessionId: sid, hash })
}

let ipCounter = 0
function post(body?: unknown, cookie?: string, headers: Record<string, string> = {}) {
  // Unique client IP per call: the route's module-level rate limiter (10/min)
  // is shared across tests in this file.
  ipCounter += 1
  return POST(
    new Request("http://localhost/api/auth/2fa/devices/trust", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `10.9.9.${ipCounter}`,
        ...(cookie ? { cookie: `${ACCESS_COOKIE}=${cookie}` } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  )
}

beforeEach(() => {
  // Echo the requested id so per-user scoping is exercised for real.
  getUserById.mockReset().mockImplementation(async (id: string) => ({ ...user, id }))
  isTotpEnabled.mockReset().mockResolvedValue(true)
  verifyUserTotp.mockReset().mockResolvedValue(true)
  setTrustedDeviceStoreForTests(undefined)
  setDeviceFingerprintStoreForTests(undefined)
})

describe("POST /api/auth/2fa/devices/trust", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await post({ totpCode: TOTP })
    expect(response.status).toBe(401)
    expect(getTrustedDeviceStore().listActive(user.id)).toHaveLength(0)
  })

  it("rejects cross-origin requests", async () => {
    const response = await post({ totpCode: TOTP }, accessCookie(), {
      origin: "https://evil.example",
    })
    expect(response.status).toBe(403)
  })

  it("rejects when the user no longer exists", async () => {
    getUserById.mockResolvedValue(null)
    const response = await post({ totpCode: TOTP }, accessCookie())
    expect(response.status).toBe(401)
  })

  it("requires TOTP to be enabled", async () => {
    isTotpEnabled.mockResolvedValue(false)
    const response = await post({ totpCode: TOTP }, accessCookie())
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "totp_not_enabled" })
    expect(verifyUserTotp).not.toHaveBeenCalled()
  })

  it("requires a totpCode in the body", async () => {
    registerSessionFingerprint()
    const response = await post({}, accessCookie())
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false })
    expect(verifyUserTotp).not.toHaveBeenCalled()
    expect(getTrustedDeviceStore().listActive(user.id)).toHaveLength(0)
  })

  it("rejects malformed totp codes", async () => {
    registerSessionFingerprint()
    for (const bad of ["12345", "1234567", "abcdef", "12 34 5"]) {
      const response = await post({ totpCode: bad }, accessCookie())
      expect(response.status).toBe(400)
    }
    expect(verifyUserTotp).not.toHaveBeenCalled()
  })

  it("rejects when the TOTP code does not verify", async () => {
    registerSessionFingerprint()
    verifyUserTotp.mockResolvedValue(false)
    const response = await post({ totpCode: "000000" }, accessCookie())
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "totp_invalid" })
    expect(verifyUserTotp).toHaveBeenCalledWith(user.id, "000000")
    expect(getTrustedDeviceStore().listActive(user.id)).toHaveLength(0)
  })

  it("rejects invalid JSON bodies", async () => {
    const response = await POST(
      new Request("http://localhost/api/auth/2fa/devices/trust", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "10.9.9.200",
          cookie: `${ACCESS_COOKIE}=${accessCookie()}`,
        },
        body: "{not json",
      }),
    )
    expect(response.status).toBe(400)
  })

  it("requires the session to have a registered fingerprint", async () => {
    // Valid TOTP but the session never registered a device fingerprint —
    // there is nothing safe to bind the trust to.
    const response = await post({ totpCode: TOTP }, accessCookie())
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, code: "fingerprint_required" })
    expect(getTrustedDeviceStore().listActive(user.id)).toHaveLength(0)
  })

  it("rejects a body fingerprint that does not match the session's", async () => {
    registerSessionFingerprint()
    const response = await post({ totpCode: TOTP, fingerprint: FP_OTHER }, accessCookie())
    expect(response.status).toBe(400)
    expect(getTrustedDeviceStore().listActive(user.id)).toHaveLength(0)
  })

  it("accepts a body fingerprint that echoes the session's", async () => {
    registerSessionFingerprint()
    const response = await post(
      { totpCode: TOTP, fingerprint: FP, label: "Work laptop" },
      accessCookie(),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.device).toMatchObject({ label: "Work laptop", fingerprintVersion: "fp1" })
    // Raw digest is never echoed.
    expect(JSON.stringify(body)).not.toContain(FP)
    expect(getTrustedDeviceStore().listActive(user.id)).toHaveLength(1)
  })

  it("trusts the session-registered fingerprint even without a body fingerprint", async () => {
    registerSessionFingerprint()
    const response = await post({ totpCode: TOTP }, accessCookie())
    expect(response.status).toBe(200)
    const device = getTrustedDeviceStore().listActive(user.id)[0]
    expect(device.fingerprintHash).toBe(FP)
  })

  it("does NOT trust an arbitrary body fingerprint without a session record", async () => {
    // Regression: previously a body-supplied digest could arm trust for a
    // fingerprint the session never registered.
    const response = await post({ totpCode: TOTP, fingerprint: FP }, accessCookie())
    expect(response.status).toBe(400)
    expect(getTrustedDeviceStore().listActive(user.id)).toHaveLength(0)
  })

  it("is idempotent — re-trusting returns the same device", async () => {
    registerSessionFingerprint()
    const first = await (await post({ totpCode: TOTP }, accessCookie())).json()
    const second = await (await post({ totpCode: TOTP, label: "Renamed" }, accessCookie())).json()
    expect(second.device.id).toBe(first.device.id)
    expect(second.device.label).toBe("Renamed")
    expect(getTrustedDeviceStore().listActive(user.id)).toHaveLength(1)
  })

  it("scopes trust to the authenticated user", async () => {
    registerSessionFingerprint("s9", FP)
    // u2's session registered FP under sid s9; trust goes to u2 only.
    await post({ totpCode: TOTP }, accessCookie("u2", "s9"))
    expect(getTrustedDeviceStore().listActive(user.id)).toHaveLength(0)
    expect(getTrustedDeviceStore().listActive("u2")).toHaveLength(1)
  })
})
