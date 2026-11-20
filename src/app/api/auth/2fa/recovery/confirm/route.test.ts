// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  getBackupCodeStatus,
  issueBackupCodes,
  setBackupCodeStoreForTests,
} from "@/lib/auth/backup-codes"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { listAuthEvents, setAuthAuditLogForTests } from "@/lib/auth/audit"
import {
  getTotpRecoveryStore,
  hashRecoveryToken,
  setTotpRecoveryStoreForTests,
} from "@/lib/auth/totp-recovery"
import { POST } from "./route"

const getUserById = vi.fn()
const isTotpEnabled = vi.fn()
const consumeOneTimeToken = vi.fn()
const consumeBackendBackupCode = vi.fn()

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({
      getUserById,
      isTotpEnabled,
      consumeOneTimeToken,
      consumeBackupCode: consumeBackendBackupCode,
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

function accessCookie(uid = user.id) {
  return createAccessToken({ sid: "s1", uid, email: user.email, name: user.name }).token
}

let ipCounter = 0
function post(
  body: unknown,
  cookie: string | null = accessCookie(),
  headers: Record<string, string> = {},
) {
  ipCounter += 1
  return POST(
    new Request("http://localhost/api/auth/2fa/recovery/confirm", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `10.2.0.${ipCounter}`,
        ...(cookie ? { cookie: `${ACCESS_COOKIE}=${cookie}` } : {}),
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  )
}

function pendingRecovery(boundToken = "good") {
  const store = getTotpRecoveryStore()
  store.create({ userId: user.id, email: user.email })
  store.bindToken(user.id, hashRecoveryToken(boundToken))
}

beforeEach(() => {
  getUserById.mockReset().mockResolvedValue(user)
  isTotpEnabled.mockReset().mockResolvedValue(true)
  consumeOneTimeToken.mockReset().mockResolvedValue({
    ok: true,
    record: { email: user.email, userId: user.id },
  })
  consumeBackendBackupCode.mockReset().mockResolvedValue(false)
  setTotpRecoveryStoreForTests(undefined)
  setBackupCodeStoreForTests(undefined)
  setAuthAuditLogForTests(undefined)
})

describe("POST /api/auth/2fa/recovery/confirm", () => {
  it("rejects unauthenticated, cross-origin, and malformed requests", async () => {
    expect((await post({ token: "t" }, null)).status).toBe(401)
    expect(
      (await post({ token: "t" }, accessCookie(), { origin: "https://evil.example" })).status,
    ).toBe(403)
    expect((await post({})).status).toBe(400)
    expect(consumeOneTimeToken).not.toHaveBeenCalled()
  })

  it("rejects invalid/expired/used tokens with reason", async () => {
    pendingRecovery()
    consumeOneTimeToken.mockResolvedValue({ ok: false, reason: "expired" })
    const response = await post({ token: "bad" })
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "invalid_token",
      reason: "expired",
    })
  })

  it("rejects a token issued for a different user", async () => {
    pendingRecovery()
    consumeOneTimeToken.mockResolvedValue({
      ok: true,
      record: { email: "other@lab.edu", userId: "u2" },
    })
    const response = await post({ token: "theirs" })
    expect(response.status).toBe(401)
    expect(getTotpRecoveryStore().getActive(user.id)?.phase).toBe("awaiting_token")
  })

  it("moves the recovery into cooldown and audits both transitions", async () => {
    pendingRecovery()
    const response = await post({ token: "good" })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.state).toBe("cooldown")
    expect(body.executeAt).toBeTruthy()

    const active = getTotpRecoveryStore().getActive(user.id)
    expect(active?.phase).toBe("cooldown")
    expect(Date.parse(active!.executeAt!)).toBeGreaterThan(Date.now())

    const types = listAuthEvents({ userId: user.id }).map((e) => e.type)
    expect(types).toContain("totp.recovery.token_verified")
    expect(types).toContain("totp.recovery.cooldown_started")
  })

  it("requires a pending awaiting_token recovery — checked BEFORE consuming", async () => {
    // Token is valid but no recovery was requested: 409 and the token is
    // NOT consumed (consumeOneTimeToken must not even be called).
    const response = await post({ token: "good" })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ ok: false, code: "no_pending_recovery" })
    expect(consumeOneTimeToken).not.toHaveBeenCalled()
  })

  it("rejects a valid verify-kind token that was not bound to this recovery", async () => {
    // Simulates e.g. an email-verification link: consume succeeds for this
    // user, but the hash does not match the token bound at request time.
    pendingRecovery("good")
    consumeOneTimeToken.mockResolvedValue({
      ok: true,
      record: { email: user.email, userId: user.id },
    })
    const response = await post({ token: "verify-email-link-token" })
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "invalid_token",
      reason: "invalid",
    })
    expect(getTotpRecoveryStore().getActive(user.id)?.phase).toBe("awaiting_token")
  })

  it("rejects when 2FA is no longer enabled, before consuming anything", async () => {
    pendingRecovery()
    isTotpEnabled.mockResolvedValue(false)
    const response = await post({ token: "good" })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "totp_not_enabled" })
    expect(consumeOneTimeToken).not.toHaveBeenCalled()
    expect(getTotpRecoveryStore().getActive(user.id)?.phase).toBe("awaiting_token")
  })

  it("rejects when the recovery has no bound token", async () => {
    getTotpRecoveryStore().create({ userId: user.id, email: user.email })
    const response = await post({ token: "good" })
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ code: "invalid_token" })
  })

  it("consumes an optional backup code from the managed store when present", async () => {
    pendingRecovery()
    const issued = await issueBackupCodes(user.id)
    const code = issued.codes[0]
    expect(getBackupCodeStatus(user.id).managed).toBe(true)

    const bad = await post({ token: "good", backupCode: "AAAA-BBBB" })
    expect(bad.status).toBe(400)
    expect(await bad.json()).toMatchObject({ ok: false, code: "invalid_backup_code" })
    // Backup code is validated BEFORE the email token: a bad code neither
    // burns the token nor the recovery.
    expect(consumeOneTimeToken).not.toHaveBeenCalled()
    expect(getTotpRecoveryStore().getActive(user.id)?.phase).toBe("awaiting_token")

    const good = await post({ token: "good", backupCode: code })
    expect(good.status).toBe(200)
    expect(consumeBackendBackupCode).not.toHaveBeenCalled()
  })

  it("falls back to backend backup codes when no managed set exists", async () => {
    pendingRecovery()
    consumeBackendBackupCode.mockResolvedValue(true)
    const response = await post({ token: "good", backupCode: "WXYZ-2345" })
    expect(response.status).toBe(200)
    expect(consumeBackendBackupCode).toHaveBeenCalledWith(user.id, "WXYZ-2345")
  })
})
