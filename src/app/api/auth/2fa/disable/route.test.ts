// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  getBackupCodeStatus,
  issueBackupCodes,
  setBackupCodeStoreForTests,
} from "@/lib/auth/backup-codes"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { POST } from "./route"

const getUserById = vi.fn()
const disableTotp = vi.fn()

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ getUserById, disableTotp }),
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

function post(body: unknown, cookie?: string, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/auth/2fa/disable", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie: `${ACCESS_COOKIE}=${cookie}` } : {}),
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  getUserById.mockReset().mockResolvedValue(user)
  disableTotp.mockReset().mockResolvedValue(true)
  setBackupCodeStoreForTests(undefined)
})

describe("POST /api/auth/2fa/disable", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await post({ password: "correct horse" })
    expect(response.status).toBe(401)
    expect(disableTotp).not.toHaveBeenCalled()
  })

  it("rejects cross-origin requests", async () => {
    const response = await post({ password: "correct horse" }, accessCookie(), {
      origin: "https://evil.example",
    })
    expect(response.status).toBe(403)
    expect(disableTotp).not.toHaveBeenCalled()
  })

  it("requires a password", async () => {
    const response = await post({}, accessCookie())
    expect(response.status).toBe(400)
    expect(disableTotp).not.toHaveBeenCalled()
  })

  it("fails when the backend rejects the password or 2FA state", async () => {
    disableTotp.mockResolvedValue(false)
    const response = await post({ password: "wrong" }, accessCookie())
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, code: "totp_invalid" })
  })

  it("disables 2FA and clears any managed backup-code set", async () => {
    await issueBackupCodes(user.id)
    expect(getBackupCodeStatus(user.id).managed).toBe(true)

    const response = await post({ password: "correct horse" }, accessCookie())
    expect(response.status).toBe(200)
    expect(disableTotp).toHaveBeenCalledWith(user.id, "correct horse")
    expect(await response.json()).toMatchObject({ ok: true, disabled: true })

    // Managed codes are dropped so disable→re-enable cannot revive them.
    expect(getBackupCodeStatus(user.id)).toEqual({ managed: false, remaining: null })
  })
})
