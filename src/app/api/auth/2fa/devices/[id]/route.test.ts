// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { getTrustedDeviceStore, setTrustedDeviceStoreForTests } from "@/lib/auth/totp-devices"
import { DELETE } from "./route"

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
const FP_B = "fp1:" + "b".repeat(64)

function accessCookie(uid = user.id) {
  return createAccessToken({ sid: "s1", uid, email: user.email, name: user.name }).token
}

function del(id: string, cookie?: string, headers: Record<string, string> = {}) {
  return DELETE(
    new Request(`http://localhost/api/auth/2fa/devices/${id}`, {
      method: "DELETE",
      headers: {
        ...(cookie ? { cookie: `${ACCESS_COOKIE}=${cookie}` } : {}),
        ...headers,
      },
    }),
    { params: Promise.resolve({ id }) },
  )
}

beforeEach(() => {
  getUserById.mockReset().mockImplementation(async (id: string) => ({ ...user, id }))
  setTrustedDeviceStoreForTests(undefined)
})

describe("DELETE /api/auth/2fa/devices/[id]", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await del("whatever")
    expect(response.status).toBe(401)
  })

  it("rejects cross-origin requests", async () => {
    const device = getTrustedDeviceStore().trust({
      userId: user.id,
      fingerprintHash: FP,
      sessionId: "s1",
    })
    const response = await del(device.id, accessCookie(), {
      origin: "https://evil.example",
    })
    expect(response.status).toBe(403)
    expect(getTrustedDeviceStore().listActive(user.id)).toHaveLength(1)
  })

  it("revokes the caller's device", async () => {
    const device = getTrustedDeviceStore().trust({
      userId: user.id,
      fingerprintHash: FP,
      sessionId: "s1",
    })
    const response = await del(device.id, accessCookie())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, revoked: true })
    expect(getTrustedDeviceStore().listActive(user.id)).toHaveLength(0)
  })

  it("404s for unknown or foreign device ids without enumerating", async () => {
    // A device owned by u2 must be indistinguishable from a missing one.
    const foreign = getTrustedDeviceStore().trust({
      userId: "u2",
      fingerprintHash: FP_B,
      sessionId: "s9",
    })
    const response = await del(foreign.id, accessCookie())
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ ok: false, code: "not_found" })
    // u2's record is untouched.
    expect(getTrustedDeviceStore().listActive("u2")).toHaveLength(1)
  })

  it("404s for an already-revoked device", async () => {
    const device = getTrustedDeviceStore().trust({
      userId: user.id,
      fingerprintHash: FP,
      sessionId: "s1",
    })
    await del(device.id, accessCookie())
    const again = await del(device.id, accessCookie())
    expect(again.status).toBe(404)
  })
})
