// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  consumeBackupCode,
  getBackupCodeStatus,
  issueBackupCodes,
  setBackupCodeStoreForTests,
} from "@/lib/auth/backup-codes"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { GET, POST } from "./route"

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

const CODE_FORMAT = /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/

function accessCookie(uid = user.id) {
  return createAccessToken({ sid: "s1", uid, email: user.email, name: user.name }).token
}

function get(cookie?: string) {
  return GET(
    new Request("http://localhost/api/auth/2fa/backup-codes", {
      headers: cookie ? { cookie: `${ACCESS_COOKIE}=${cookie}` } : {},
    }),
  )
}

function post(cookie?: string, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/auth/2fa/backup-codes", {
      method: "POST",
      headers: {
        ...(cookie ? { cookie: `${ACCESS_COOKIE}=${cookie}` } : {}),
        ...headers,
      },
    }),
  )
}

beforeEach(() => {
  getUserById.mockReset().mockResolvedValue(user)
  isTotpEnabled.mockReset().mockResolvedValue(true)
  setBackupCodeStoreForTests(undefined)
})

describe("GET /api/auth/2fa/backup-codes", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await get()
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthenticated" })
    expect(getUserById).not.toHaveBeenCalled()
  })

  it("rejects a token whose user no longer exists", async () => {
    getUserById.mockResolvedValue(null)
    const response = await get(accessCookie())
    expect(response.status).toBe(401)
  })

  it("reports unmanaged status before any set is issued", async () => {
    const response = await get(accessCookie())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      enabled: true,
      managed: false,
      remaining: null,
    })
  })

  it("reports the remaining count for a managed set", async () => {
    await post(accessCookie())
    const response = await get(accessCookie())
    expect(await response.json()).toMatchObject({
      ok: true,
      enabled: true,
      managed: true,
      remaining: 10,
    })
  })

  it("reports disabled and clears stale managed codes when 2FA is off", async () => {
    await issueBackupCodes(user.id)
    expect(getBackupCodeStatus(user.id).managed).toBe(true)

    isTotpEnabled.mockResolvedValue(false)
    const response = await get(accessCookie())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      enabled: false,
      managed: false,
      remaining: null,
    })
    // The stale set is dropped so it cannot revive on re-enable.
    expect(getBackupCodeStatus(user.id)).toEqual({ managed: false, remaining: null })
  })
})

describe("POST /api/auth/2fa/backup-codes", () => {
  it("rejects cross-origin requests", async () => {
    const response = await post(accessCookie(), { origin: "https://evil.example" })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
  })

  it("rejects unauthenticated requests", async () => {
    const response = await post()
    expect(response.status).toBe(401)
    expect(getUserById).not.toHaveBeenCalled()
  })

  it("rejects when two-factor authentication is not enabled", async () => {
    isTotpEnabled.mockResolvedValue(false)
    const response = await post(accessCookie())
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "totp_not_enabled" })
    expect(getBackupCodeStatus(user.id).managed).toBe(false)
  })

  it("issues codes once and stores only hashes", async () => {
    const response = await post(accessCookie())
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.backupCodes).toHaveLength(10)
    expect(body.remaining).toBe(10)
    for (const code of body.backupCodes) expect(code).toMatch(CODE_FORMAT)

    // Plaintext is not persisted: consuming a returned code works exactly once.
    await expect(consumeBackupCode(user.id, body.backupCodes[0])).resolves.toBe(true)
    await expect(consumeBackupCode(user.id, body.backupCodes[0])).resolves.toBe(false)
  })

  it("regeneration invalidates the previous set", async () => {
    const first = await (await post(accessCookie())).json()
    const second = await (await post(accessCookie())).json()

    expect(second.backupCodes).not.toEqual(first.backupCodes)
    for (const code of first.backupCodes) {
      await expect(consumeBackupCode(user.id, code)).resolves.toBe(false)
    }
    await expect(consumeBackupCode(user.id, second.backupCodes[0])).resolves.toBe(true)
  })
})
