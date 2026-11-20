// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { createCaptchaToken } from "@/lib/captcha"
import { getForcedResetStore, setForcedResetStoreForTests } from "@/lib/auth/forced-reset"
import { POST } from "./route"

const consumeOneTimeToken = vi.fn()
const getUserById = vi.fn()
const setPassword = vi.fn()
const revokeAllSessions = vi.fn()

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ consumeOneTimeToken, getUserById, setPassword, revokeAllSessions }),
  }
})

const user = {
  id: "u-reset",
  email: "ada@lab.edu",
  name: "Ada",
  emailVerified: true,
  createdAt: new Date().toISOString(),
}

let ipCounter = 0

function post(body: unknown, headers: Record<string, string> = {}) {
  ipCounter += 1
  return POST(
    new Request("http://localhost/api/auth/password/reset/confirm", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `10.6.6.${ipCounter}`,
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  )
}

function validBody() {
  return {
    token: "reset-token",
    password: "correct horse",
    captchaToken: createCaptchaToken("0123456789abcdef").token,
  }
}

beforeEach(() => {
  consumeOneTimeToken
    .mockReset()
    .mockResolvedValue({ ok: true, record: { kind: "reset", userId: user.id, email: user.email } })
  getUserById.mockReset().mockResolvedValue(user)
  setPassword.mockReset().mockResolvedValue(undefined)
  revokeAllSessions.mockReset().mockResolvedValue(undefined)
  setForcedResetStoreForTests(undefined)
})

describe("POST /api/auth/password/reset/confirm", () => {
  it("resets the password and revokes sessions with a valid captcha token", async () => {
    const response = await post(validBody())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, reset: true })
    expect(setPassword).toHaveBeenCalledWith(user.id, "correct horse")
    expect(revokeAllSessions).toHaveBeenCalledWith(user.id)
  })

  it("rejects missing or forged captcha tokens before consuming the reset token", async () => {
    const missing = validBody() as Record<string, unknown>
    delete missing.captchaToken
    expect((await post(missing)).status).toBe(403)

    const forged = { ...validBody(), captchaToken: "v1.forged.sig" }
    const response = await post(forged)
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "captcha_failed" })
    expect(consumeOneTimeToken).not.toHaveBeenCalled()
  })

  it("rejects breached passwords without consuming the reset token", async () => {
    const breached = { ...validBody(), password: "qwerty2024" }
    const response = await post(breached)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, code: "password_breach" })
    expect(consumeOneTimeToken).not.toHaveBeenCalled()
    expect(setPassword).not.toHaveBeenCalled()
  })

  it("clears the forced-reset flag on success", async () => {
    getForcedResetStore().require(user.id, { setBy: "admin@lab.edu" })
    expect(getForcedResetStore().get(user.id)).not.toBeNull()

    const response = await post(validBody())
    expect(response.status).toBe(200)
    expect(getForcedResetStore().get(user.id)).toBeNull()
  })

  it("keeps the flag when the reset fails (bad captcha / token / breach)", async () => {
    getForcedResetStore().require(user.id)

    const missing = validBody() as Record<string, unknown>
    delete missing.captchaToken
    expect((await post(missing)).status).toBe(403)

    const breached = { ...validBody(), password: "qwerty2024" }
    expect((await post(breached)).status).toBe(400)

    consumeOneTimeToken.mockResolvedValue({ ok: false })
    expect((await post(validBody())).status).toBe(401)

    expect(getForcedResetStore().get(user.id)).not.toBeNull()
  })

  it("still rejects invalid reset tokens", async () => {
    consumeOneTimeToken.mockResolvedValue({ ok: false })
    const response = await post(validBody())
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "invalid_token" })
  })
})
