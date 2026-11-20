// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  consumeEmergencyCode,
  getEmergencyCodeStatus,
  setEmergencyCodeStoreForTests,
} from "@/lib/auth/emergency-codes"
import { setAuthAuditLogForTests, listAuthEvents } from "@/lib/auth/audit"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
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

const CODE_FORMAT = /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/

function accessCookie(uid = user.id) {
  return createAccessToken({ sid: "s1", uid, email: user.email, name: user.name }).token
}

function authed(headers: Record<string, string> = {}, cookie?: string) {
  return {
    ...(cookie ? { cookie: `${ACCESS_COOKIE}=${cookie}` } : {}),
    ...headers,
  }
}

function get(cookie?: string) {
  return GET(
    new Request("http://localhost/api/auth/emergency-codes", { headers: authed({}, cookie) }),
  )
}

function post(cookie?: string, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/auth/emergency-codes", {
      method: "POST",
      headers: authed(headers, cookie),
    }),
  )
}

function del(cookie?: string, headers: Record<string, string> = {}) {
  return DELETE(
    new Request("http://localhost/api/auth/emergency-codes", {
      method: "DELETE",
      headers: authed(headers, cookie),
    }),
  )
}

beforeEach(() => {
  getUserById.mockReset().mockResolvedValue(user)
  setEmergencyCodeStoreForTests(undefined)
  setAuthAuditLogForTests(undefined)
})

describe("GET /api/auth/emergency-codes", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await get()
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthenticated" })
    expect(getUserById).not.toHaveBeenCalled()
  })

  it("reports unmanaged status before any set is issued", async () => {
    const response = await get(accessCookie())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      active: false,
      remaining: null,
      expiresAt: null,
    })
  })

  it("reports the remaining count and expiry for a live set", async () => {
    await post(accessCookie())
    const response = await get(accessCookie())
    const body = await response.json()
    expect(body).toMatchObject({ ok: true, active: true, remaining: 10 })
    expect(typeof body.expiresAt).toBe("string")
  })
})

describe("POST /api/auth/emergency-codes", () => {
  it("rejects cross-origin and unauthenticated requests", async () => {
    expect((await post(accessCookie(), { origin: "https://evil.example" })).status).toBe(403)
    expect((await post()).status).toBe(401)
  })

  it("issues codes once, stores only hashes, and audits generation", async () => {
    const response = await post(accessCookie())
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.emergencyCodes).toHaveLength(10)
    for (const code of body.emergencyCodes) expect(code).toMatch(CODE_FORMAT)
    expect(body.remaining).toBe(10)

    // Plaintext is not persisted: consuming a returned code works exactly once.
    await expect(consumeEmergencyCode(user.id, body.emergencyCodes[0])).resolves.toEqual({
      ok: true,
    })
    await expect(consumeEmergencyCode(user.id, body.emergencyCodes[0])).resolves.toEqual({
      ok: false,
      reason: "used",
    })

    const events = listAuthEvents({ userId: user.id })
    expect(events.some((event) => (event.type as string) === "emergency_code.generated")).toBe(true)
  })

  it("regeneration invalidates the previous set", async () => {
    const first = await (await post(accessCookie())).json()
    const second = await (await post(accessCookie())).json()

    expect(second.emergencyCodes).not.toEqual(first.emergencyCodes)
    for (const code of first.emergencyCodes) {
      await expect(consumeEmergencyCode(user.id, code)).resolves.toMatchObject({ ok: false })
    }
    await expect(consumeEmergencyCode(user.id, second.emergencyCodes[0])).resolves.toEqual({
      ok: true,
    })
  })
})

describe("DELETE /api/auth/emergency-codes", () => {
  it("rejects cross-origin and unauthenticated requests", async () => {
    expect((await del(accessCookie(), { origin: "https://evil.example" })).status).toBe(403)
    expect((await del()).status).toBe(401)
  })

  it("revokes the whole set and audits the event", async () => {
    const issued = await (await post(accessCookie())).json()
    const code = issued.emergencyCodes[0]

    const response = await del(accessCookie())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, revoked: true })
    expect(getEmergencyCodeStatus(user.id)).toEqual({
      active: false,
      remaining: null,
      expiresAt: null,
    })
    await expect(consumeEmergencyCode(user.id, code)).resolves.toEqual({
      ok: false,
      reason: "invalid",
    })

    const events = listAuthEvents({ userId: user.id })
    expect(events.some((event) => (event.type as string) === "emergency_code.revoked")).toBe(true)
  })
})
