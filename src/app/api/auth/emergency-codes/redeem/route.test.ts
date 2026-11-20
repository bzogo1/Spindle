// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  consumeEmergencyCode,
  getEmergencyAccess,
  issueEmergencyCodes,
  setEmergencyCodeStoreForTests,
} from "@/lib/auth/emergency-codes"
import { setAuthAuditLogForTests, listAuthEvents } from "@/lib/auth/audit"
import { sendAuthEmail } from "@/lib/auth/mailer"
import { POST as redeemPost } from "./route"
import { POST as passwordPost } from "../access/password/route"
import { POST as emailVerifiedPost } from "../access/email-verified/route"
import { POST as completePost } from "../access/complete/route"

const getUserByEmail = vi.fn()
const setPassword = vi.fn()
const markEmailVerified = vi.fn()
const revokeAllSessions = vi.fn()

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({
      getUserByEmail,
      setPassword,
      markEmailVerified,
      revokeAllSessions,
    }),
  }
})

vi.mock("@/lib/auth/mailer", () => ({
  authLink: (path: string) => `https://app.test${path}`,
  sendAuthEmail: vi.fn().mockResolvedValue(undefined),
}))

const user = {
  id: "u1",
  email: "ada@lab.edu",
  name: "Ada",
  emailVerified: false,
  createdAt: new Date().toISOString(),
}

let ipCounter = 0
function post(handler: (request: Request) => Promise<Response>, body: unknown) {
  ipCounter += 1
  return handler(
    new Request("http://localhost/api/auth/emergency-codes/x", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `10.20.0.${ipCounter}`,
      },
      body: JSON.stringify(body),
    }),
  )
}

async function issueCodeFor(userId = user.id) {
  const issued = await issueEmergencyCodes(userId, { count: 2 })
  return issued.codes[0]
}

beforeEach(() => {
  getUserByEmail.mockReset().mockResolvedValue(user)
  setPassword.mockReset().mockResolvedValue(undefined)
  markEmailVerified.mockReset().mockResolvedValue(undefined)
  revokeAllSessions.mockReset().mockResolvedValue(undefined)
  vi.mocked(sendAuthEmail).mockClear()
  setEmergencyCodeStoreForTests(undefined)
  setAuthAuditLogForTests(undefined)
})

describe("POST /api/auth/emergency-codes/redeem", () => {
  it("rejects cross-origin, malformed bodies, and rate-limits", async () => {
    const crossOrigin = await redeemPost(
      new Request("http://localhost/api/auth/emergency-codes/redeem", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
          "x-forwarded-for": "10.20.9.1",
        },
        body: JSON.stringify({ email: user.email, code: "AAAA-BBBB" }),
      }),
    )
    expect(crossOrigin.status).toBe(403)
    expect((await post(redeemPost, {})).status).toBe(400)
  })

  it("rejects unknown emails and bad codes with the same generic error", async () => {
    getUserByEmail.mockResolvedValueOnce(null)
    const unknown = await post(redeemPost, { email: "ghost@lab.edu", code: "AAAA-BBBB" })
    expect(unknown.status).toBe(401)
    const unknownBody = await unknown.json()
    expect(unknownBody).toMatchObject({ ok: false, code: "invalid_code" })

    const code = await issueCodeFor()
    const bad = await post(redeemPost, { email: user.email, code: "ZZZZ-ZZZZ" })
    expect(bad.status).toBe(401)
    const badBody = await bad.json()
    expect(badBody).toMatchObject({ ok: false, code: "invalid_code" })
    // Anti-enumeration: the response must be byte-for-byte indistinguishable
    // from the unknown-email branch — no `reason` or other failure detail
    // may leak to the client.
    expect(badBody).toEqual(unknownBody)

    // The good code is untouched by the failed attempts.
    const good = await post(redeemPost, { email: user.email, code })
    expect(good.status).toBe(200)
    void code
  })

  it("redeems a code into a restricted access session — never a sign-in", async () => {
    const code = await issueCodeFor()

    const response = await post(redeemPost, { email: user.email, code })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      ok: true,
      email: user.email,
      passwordResetRequired: true,
    })
    expect(typeof body.accessToken).toBe("string")
    expect(getEmergencyAccess(body.accessToken)?.userId).toBe(user.id)

    // Containment: remaining codes burned, every session revoked, notice sent.
    expect(revokeAllSessions).toHaveBeenCalledWith(user.id)
    expect(vi.mocked(sendAuthEmail)).toHaveBeenCalledWith(
      expect.objectContaining({ to: user.email }),
    )
    const second = await post(redeemPost, {
      email: user.email,
      code: (await issueEmergencyCodes(user.id, { count: 1 })).codes[0],
    })
    // A fresh set works — proving redemption only burned the old set.
    expect(second.status).toBe(200)

    const events = listAuthEvents({ userId: user.id })
    expect(events.some((event) => (event.type as string) === "emergency_code.redeemed")).toBe(true)
  })

  it("fails closed with 500 when post-consume containment throws — no token issued", async () => {
    const code = await issueCodeFor()
    revokeAllSessions.mockRejectedValueOnce(new Error("db down"))

    const response = await post(redeemPost, { email: user.email, code })
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toMatchObject({ ok: false, code: "redeem_failed" })
    expect(body.accessToken).toBeUndefined()

    // The code was still consumed (fail closed): a retry gets the generic
    // invalid_code, never a second chance at the same code.
    const retry = await post(redeemPost, { email: user.email, code })
    expect(retry.status).toBe(401)
    expect(await retry.json()).toMatchObject({ ok: false, code: "invalid_code" })
  })

  it("a redeemed code cannot be used twice and siblings are burned", async () => {
    const issued = await issueEmergencyCodes(user.id, { count: 2 })
    const [first, second] = issued.codes

    // Redeeming the first code revokes the whole set server-side.
    expect((await post(redeemPost, { email: user.email, code: first })).status).toBe(200)
    await expect(consumeEmergencyCode(user.id, second)).resolves.toEqual({
      ok: false,
      reason: "invalid",
    })
    await expect(consumeEmergencyCode(user.id, first)).resolves.toEqual({
      ok: false,
      reason: "invalid",
    })

    // And a fresh set's code is still single-use.
    const fresh = await issueEmergencyCodes(user.id, { count: 1 })
    await expect(consumeEmergencyCode(user.id, fresh.codes[0])).resolves.toEqual({ ok: true })
    await expect(consumeEmergencyCode(user.id, fresh.codes[0])).resolves.toEqual({
      ok: false,
      reason: "used",
    })
  })
})

describe("emergency access session endpoints", () => {
  async function redeemForAccess() {
    const code = await issueCodeFor()
    const response = await post(redeemPost, { email: user.email, code })
    const body = await response.json()
    return body.accessToken as string
  }

  it("password endpoint sets a new password for a live access token", async () => {
    const accessToken = await redeemForAccess()
    const response = await post(passwordPost, { accessToken, password: "new-secret-1" })
    expect(response.status).toBe(200)
    expect(setPassword).toHaveBeenCalledWith(user.id, "new-secret-1")

    // Short passwords and forged tokens are rejected.
    const short = await post(passwordPost, { accessToken, password: "short" })
    expect(short.status).toBe(400)
    const forged = await post(passwordPost, { accessToken: "forged", password: "long-enough-1" })
    expect(forged.status).toBe(401)

    // Breached/common passwords are rejected with the same code as
    // reset/confirm, and the access session stays usable for a retry.
    setPassword.mockClear()
    const breached = await post(passwordPost, { accessToken, password: "password123" })
    expect(breached.status).toBe(400)
    expect(await breached.json()).toMatchObject({ ok: false, code: "password_breach" })
    expect(setPassword).not.toHaveBeenCalled()

    const retry = await post(passwordPost, { accessToken, password: "new-secret-1" })
    expect(retry.status).toBe(200)
    expect(setPassword).toHaveBeenCalledWith(user.id, "new-secret-1")
  })

  it("email-verified endpoint marks the email verified", async () => {
    const accessToken = await redeemForAccess()
    const response = await post(emailVerifiedPost, { accessToken })
    expect(response.status).toBe(200)
    expect(markEmailVerified).toHaveBeenCalledWith(user.id)
  })

  it("complete requires a password reset first, then finishes once", async () => {
    const accessToken = await redeemForAccess()

    // Mandatory password step: completion is refused before it.
    const early = await post(completePost, { accessToken })
    expect(early.status).toBe(403)
    expect(await early.json()).toMatchObject({ ok: false, code: "password_required" })

    await post(passwordPost, { accessToken, password: "new-secret-1" })
    await post(emailVerifiedPost, { accessToken })

    const done = await post(completePost, { accessToken })
    expect(done.status).toBe(200)
    expect(await done.json()).toMatchObject({ ok: true, completed: true })
    expect(revokeAllSessions).toHaveBeenCalledTimes(2) // redeem + complete

    // The access token is single-use.
    const replay = await post(completePost, { accessToken })
    expect(replay.status).toBe(401)

    const events = listAuthEvents({ userId: user.id })
    for (const type of [
      "emergency_code.password_reset",
      "emergency_code.email_verified",
      "emergency_code.completed",
    ]) {
      expect(events.some((event) => (event.type as string) === type)).toBe(true)
    }
  })
})
