// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  consumeBackupCode,
  getBackupCodeStatus,
  issueBackupCodes,
  setBackupCodeStoreForTests,
} from "@/lib/auth/backup-codes"
import type { TokenPair } from "@/lib/auth/backend"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { getForcedResetStore, setForcedResetStoreForTests } from "@/lib/auth/forced-reset"
import { MemoryLoginAlertStore, setLoginAlertStoreForTests } from "@/lib/auth/login-alerts"
import { createTotpChallenge } from "@/lib/auth/token-codec"
import { POST } from "./route"

const verifyTotpLogin = vi.fn()
const getUserById = vi.fn()
const createSessionForUser = vi.fn()
const isTotpEnabled = vi.fn()

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({
      verifyTotpLogin,
      getUserById,
      createSessionForUser,
      isTotpEnabled,
    }),
  }
})

const user = {
  id: "u1",
  email: "ada@lab.edu",
  name: "Ada",
  emailVerified: true,
  createdAt: new Date().toISOString(),
}

const tokens: TokenPair = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  session: {
    user,
    workspace: null,
    sessionId: "sess-1",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  },
}

let ipCounter = 0

function post(body: unknown, ip?: string, headers: Record<string, string> = {}) {
  ipCounter += 1
  return POST(
    new Request("http://localhost/api/auth/2fa/verify-login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": ip ?? `10.0.0.${ipCounter}`,
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  )
}

function challengeFor(uid = user.id) {
  return createTotpChallenge(uid).token
}

let alertStore: MemoryLoginAlertStore

beforeEach(() => {
  verifyTotpLogin.mockReset().mockResolvedValue(tokens)
  getUserById.mockReset().mockResolvedValue(user)
  createSessionForUser.mockReset().mockResolvedValue(tokens)
  isTotpEnabled.mockReset().mockResolvedValue(true)
  setBackupCodeStoreForTests(undefined)
  setForcedResetStoreForTests(undefined)
  alertStore = new MemoryLoginAlertStore()
  setLoginAlertStoreForTests(alertStore)
})

describe("POST /api/auth/2fa/verify-login", () => {
  it("rejects malformed bodies", async () => {
    const response = await post({ challenge: "", code: "123" })
    expect(response.status).toBe(400)
  })

  it("accepts a TOTP code through the backend", async () => {
    const response = await post({ challenge: challengeFor(), code: "123456" })
    expect(response.status).toBe(200)
    expect(verifyTotpLogin).toHaveBeenCalledTimes(1)
    expect(createSessionForUser).not.toHaveBeenCalled()
    expect(response.headers.get("set-cookie")).toContain(ACCESS_COOKIE)
  })

  it("returns 401 when the backend rejects the code", async () => {
    verifyTotpLogin.mockResolvedValue(null)
    const response = await post({ challenge: challengeFor(), code: "123456" })
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "totp_invalid" })
  })

  it("accepts an enrollment backup code via the backend when unmanaged", async () => {
    const response = await post({ challenge: challengeFor(), code: "ABCD-1234" })
    expect(response.status).toBe(200)
    // Unmanaged users delegate backup codes to the backend store.
    expect(verifyTotpLogin).toHaveBeenCalledTimes(1)
    expect(createSessionForUser).not.toHaveBeenCalled()
  })

  it("accepts a managed backup code and consumes it once", async () => {
    const { codes } = await issueBackupCodes(user.id)
    const challenge = challengeFor()

    const first = await post({ challenge, code: codes[0] })
    expect(first.status).toBe(200)
    expect(verifyTotpLogin).not.toHaveBeenCalled()
    expect(createSessionForUser).toHaveBeenCalledWith(user.id)

    const second = await post({ challenge, code: codes[0] })
    expect(second.status).toBe(401)
  })

  it("rejects superseded enrollment codes once a managed set exists", async () => {
    await issueBackupCodes(user.id)
    verifyTotpLogin.mockResolvedValue(tokens) // would succeed for old codes

    const response = await post({ challenge: challengeFor(), code: "WXYZ-9876" })
    expect(response.status).toBe(401)
    // Managed users get no backend fallback for backup-shaped input.
    expect(verifyTotpLogin).not.toHaveBeenCalled()
    expect(createSessionForUser).not.toHaveBeenCalled()
  })

  it("still accepts TOTP for managed users", async () => {
    await issueBackupCodes(user.id)
    const response = await post({ challenge: challengeFor(), code: "654321" })
    expect(response.status).toBe(200)
    expect(verifyTotpLogin).toHaveBeenCalledTimes(1)
  })

  it("rejects a managed code when 2FA was disabled after the challenge", async () => {
    const { codes } = await issueBackupCodes(user.id)
    isTotpEnabled.mockResolvedValue(false)

    const response = await post({ challenge: challengeFor(), code: codes[0] })
    expect(response.status).toBe(401)
    expect(createSessionForUser).not.toHaveBeenCalled()
    // The code is NOT burned — lookup/enable checks run before consume.
    expect(getBackupCodeStatus(user.id).remaining).toBe(10)
    // And the code still works afterwards (it was never consumed).
    await expect(consumeBackupCode(user.id, codes[0])).resolves.toBe(true)
  })

  it("does not burn a managed code when the user no longer exists", async () => {
    const { codes } = await issueBackupCodes(user.id)
    getUserById.mockResolvedValue(null)

    const response = await post({ challenge: challengeFor(), code: codes[0] })
    expect(response.status).toBe(401)
    expect(createSessionForUser).not.toHaveBeenCalled()
    expect(getBackupCodeStatus(user.id).remaining).toBe(10)
  })

  it("records login-alert fingerprints only after a session is created", async () => {
    const challenge = challengeFor()
    // A rejected code is not a sign-in: nothing is recorded.
    verifyTotpLogin.mockResolvedValueOnce(null)
    expect((await post({ challenge, code: "000000" })).status).toBe(401)
    expect(alertStore.listAlerts(user.id)).toEqual([])

    // First successful verification seeds fingerprints silently.
    expect(
      (await post({ challenge, code: "123456" }, undefined, { "user-agent": "UA-A" })).status,
    ).toBe(200)
    expect(alertStore.listAlerts(user.id)).toEqual([])

    // A different device on the next verification raises a new_device alert.
    expect(
      (await post({ challenge, code: "123456" }, undefined, { "user-agent": "UA-B" })).status,
    ).toBe(200)
    expect(alertStore.listAlerts(user.id).map((a) => a.kind)).toContain("new_device")
  })

  it("refuses a flagged user holding a pre-flag TOTP challenge", async () => {
    // Simulate: challenge issued, THEN the admin set the flag (5min TTL).
    const challenge = challengeFor()
    getForcedResetStore().require(user.id, { setBy: "admin@lab.edu" })

    const response = await post({ challenge, code: "123456" })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "password_reset_required",
    })
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(verifyTotpLogin).not.toHaveBeenCalled()
    expect(createSessionForUser).not.toHaveBeenCalled()
  })

  it("refuses a flagged user on the managed backup-code path without burning the code", async () => {
    const { codes } = await issueBackupCodes(user.id)
    const challenge = challengeFor()
    getForcedResetStore().require(user.id, { setBy: "admin@lab.edu" })

    const response = await post({ challenge, code: codes[0] })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "password_reset_required",
    })
    expect(createSessionForUser).not.toHaveBeenCalled()
    expect(getBackupCodeStatus(user.id).remaining).toBe(10)
  })

  it("rejects a managed code issued to a different user", async () => {
    await issueBackupCodes(user.id)
    const { codes: otherCodes } = await issueBackupCodes("other-user")

    const response = await post({ challenge: challengeFor(), code: otherCodes[0] })
    expect(response.status).toBe(401)
    expect(createSessionForUser).not.toHaveBeenCalled()
  })
})
