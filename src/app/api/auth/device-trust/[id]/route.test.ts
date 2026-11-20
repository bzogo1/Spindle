// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { getDeviceTrustStore, setDeviceTrustStoreForTests } from "@/lib/auth/device-trust"
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

let ipCounter = 0

function accessCookie(uid = user.id) {
  return createAccessToken({ sid: "s1", uid, email: user.email, name: user.name }).token
}

function del(id: string, cookie?: string, headers: Record<string, string> = {}) {
  ipCounter += 1
  return DELETE(
    new Request(`http://localhost/api/auth/device-trust/${id}`, {
      method: "DELETE",
      headers: {
        "x-forwarded-for": `10.1.0.${ipCounter}`,
        ...(cookie ? { cookie: `${ACCESS_COOKIE}=${cookie}` } : {}),
        ...headers,
      },
    }),
    { params: Promise.resolve({ id }) },
  )
}

beforeEach(() => {
  getUserById.mockReset().mockImplementation(async (id: string) => ({ ...user, id }))
  setDeviceTrustStoreForTests(undefined)
})

describe("DELETE /api/auth/device-trust/[id]", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await del("whatever")
    expect(response.status).toBe(401)
  })

  it("rejects cross-origin requests", async () => {
    const grant = getDeviceTrustStore().grant({
      userId: user.id,
      fingerprintHash: FP,
      sessionId: "s1",
    })
    const response = await del(grant.id, accessCookie(), {
      origin: "https://evil.example",
    })
    expect(response.status).toBe(403)
    expect(getDeviceTrustStore().listActive(user.id)).toHaveLength(1)
  })

  it("revokes the caller's grant", async () => {
    const grant = getDeviceTrustStore().grant({
      userId: user.id,
      fingerprintHash: FP,
      sessionId: "s1",
    })
    const response = await del(grant.id, accessCookie())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, revoked: true })
    expect(getDeviceTrustStore().listActive(user.id)).toHaveLength(0)
  })

  it("404s for unknown or foreign grant ids without enumerating", async () => {
    // A grant owned by u2 must be indistinguishable from a missing one.
    const foreign = getDeviceTrustStore().grant({
      userId: "u2",
      fingerprintHash: FP_B,
      sessionId: "s9",
    })
    const response = await del(foreign.id, accessCookie())
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ ok: false, code: "not_found" })
    // u2's record is untouched.
    expect(getDeviceTrustStore().listActive("u2")).toHaveLength(1)
  })

  it("404s for an already-revoked grant", async () => {
    const grant = getDeviceTrustStore().grant({
      userId: user.id,
      fingerprintHash: FP,
      sessionId: "s1",
    })
    await del(grant.id, accessCookie())
    const again = await del(grant.id, accessCookie())
    expect(again.status).toBe(404)
  })
})
