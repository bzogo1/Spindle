// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  getDeviceFingerprintStore,
  setDeviceFingerprintStoreForTests,
} from "@/lib/auth/fingerprint"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { getDeviceTrustStore, setDeviceTrustStoreForTests } from "@/lib/auth/device-trust"
import { DELETE, GET, POST } from "./route"

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

const FP = "fp1:" + "a".repeat(64)
const FP_OTHER = "fp1:" + "b".repeat(64)

let ipCounter = 0
/** Unique client IP per call so the per-IP rate limiters never trip in tests. */
function testIp() {
  ipCounter += 1
  return `10.0.0.${ipCounter}`
}

function accessCookie(uid = user.id, sid = "s1") {
  return createAccessToken({ sid, uid, email: user.email, name: user.name }).token
}

function headers(cookie?: string, extra: Record<string, string> = {}) {
  return {
    "x-forwarded-for": testIp(),
    ...(cookie ? { cookie: `${ACCESS_COOKIE}=${cookie}` } : {}),
    ...extra,
  }
}

function get(cookie?: string, extra?: Record<string, string>) {
  return GET(
    new Request("http://localhost/api/auth/device-trust", { headers: headers(cookie, extra) }),
  )
}

function post(body: unknown, cookie?: string, extra?: Record<string, string>) {
  return POST(
    new Request("http://localhost/api/auth/device-trust", {
      method: "POST",
      headers: { ...headers(cookie, extra), "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  )
}

function del(cookie?: string, extra?: Record<string, string>) {
  return DELETE(
    new Request("http://localhost/api/auth/device-trust", {
      method: "DELETE",
      headers: headers(cookie, extra),
    }),
  )
}

function registerFingerprint(sessionId = "s1", hash = FP, uid = user.id) {
  getDeviceFingerprintStore().register({ userId: uid, sessionId, hash })
}

beforeEach(() => {
  getUserById.mockReset().mockResolvedValue(user)
  setDeviceTrustStoreForTests(undefined)
  setDeviceFingerprintStoreForTests(undefined)
})

describe("GET /api/auth/device-trust", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await get()
    expect(response.status).toBe(401)
  })

  it("rejects cross-origin requests", async () => {
    const response = await get(accessCookie(), { origin: "https://evil.example" })
    expect(response.status).toBe(403)
  })

  it("returns empty list with untrusted current device", async () => {
    const response = await get(accessCookie())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      devices: [],
      currentDevice: { trusted: false, deviceId: null },
    })
  })

  it("lists grants with masked fingerprints and flags the current device", async () => {
    registerFingerprint()
    const grant = getDeviceTrustStore().grant({
      userId: user.id,
      fingerprintHash: FP,
      sessionId: "s1",
      label: "Work laptop",
    })

    const response = await get(accessCookie())
    const body = await response.json()
    expect(body.devices).toHaveLength(1)
    expect(body.devices[0]).toMatchObject({
      id: grant.id,
      label: "Work laptop",
      fingerprintVersion: "fp1",
      fingerprint: `fp1:${"a".repeat(6)}…aaaa`,
      grantedAt: grant.grantedAt,
      expiresAt: grant.expiresAt,
    })
    // The raw fingerprint digest must never be echoed to clients.
    expect(JSON.stringify(body)).not.toContain(FP)
    expect(body.currentDevice).toEqual({ trusted: true, deviceId: grant.id })
  })

  it("does not leak another user's grants", async () => {
    getDeviceTrustStore().grant({
      userId: "u2",
      fingerprintHash: FP_OTHER,
      sessionId: "s9",
    })
    const response = await get(accessCookie())
    expect(await response.json()).toMatchObject({ devices: [] })
  })
})

describe("POST /api/auth/device-trust", () => {
  it("rejects unauthenticated requests", async () => {
    expect((await post({})).status).toBe(401)
  })

  it("rejects cross-origin requests", async () => {
    registerFingerprint()
    const response = await post({}, accessCookie(), { origin: "https://evil.example" })
    expect(response.status).toBe(403)
    expect(getDeviceTrustStore().listActive(user.id)).toHaveLength(0)
  })

  it("rejects invalid JSON bodies", async () => {
    const response = await post("{not json", accessCookie())
    expect(response.status).toBe(400)
  })

  it("requires a session-registered fingerprint", async () => {
    const response = await post({ label: "Work laptop" }, accessCookie())
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, code: "fingerprint_required" })
    expect(getDeviceTrustStore().listActive(user.id)).toHaveLength(0)
  })

  it("rejects a fingerprint echo that does not match the session record", async () => {
    registerFingerprint("s1", FP)
    const response = await post({ fingerprint: FP_OTHER }, accessCookie())
    expect(response.status).toBe(400)
    expect(getDeviceTrustStore().listActive(user.id)).toHaveLength(0)
  })

  it("grants trust to the session's registered device", async () => {
    registerFingerprint()
    const response = await post({ label: "  Work   laptop ", fingerprint: FP }, accessCookie())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.device).toMatchObject({
      label: "Work laptop",
      fingerprintVersion: "fp1",
      fingerprint: `fp1:${"a".repeat(6)}…aaaa`,
    })
    // Raw digest never echoed.
    expect(JSON.stringify(body)).not.toContain(FP)
    expect(getDeviceTrustStore().listActive(user.id)).toHaveLength(1)
  })

  it("is idempotent — re-granting refreshes the same record", async () => {
    registerFingerprint()
    registerFingerprint("s2")
    const first = await (await post({ label: "One" }, accessCookie())).json()
    const second = await (await post({ label: "Two" }, accessCookie("u1", "s2"))).json()
    expect(second.device.id).toBe(first.device.id)
    expect(getDeviceTrustStore().listActive(user.id)).toHaveLength(1)
  })
})

describe("DELETE /api/auth/device-trust", () => {
  it("rejects unauthenticated requests", async () => {
    expect((await del()).status).toBe(401)
  })

  it("revokes all of the caller's grants only", async () => {
    getDeviceTrustStore().grant({ userId: user.id, fingerprintHash: FP, sessionId: "s1" })
    getDeviceTrustStore().grant({ userId: user.id, fingerprintHash: FP_OTHER, sessionId: "s1" })
    getDeviceTrustStore().grant({ userId: "u2", fingerprintHash: FP, sessionId: "s9" })

    const response = await del(accessCookie())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, revoked: 2 })
    expect(getDeviceTrustStore().listActive(user.id)).toHaveLength(0)
    expect(getDeviceTrustStore().listActive("u2")).toHaveLength(1)
  })
})
