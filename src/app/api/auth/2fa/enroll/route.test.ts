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
const startTotpEnrollment = vi.fn()

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ getUserById, startTotpEnrollment }),
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

function post(cookie?: string, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/auth/2fa/enroll", {
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
  startTotpEnrollment.mockReset().mockResolvedValue({
    secret: "JBSWY3DPEHPK3PXP",
    otpauthUrl: "otpauth://totp/Spindle:ada%40lab.edu?secret=JBSWY3DPEHPK3PXP",
    backupCodes: [],
  })
  setBackupCodeStoreForTests(undefined)
})

describe("POST /api/auth/2fa/enroll", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await post()
    expect(response.status).toBe(401)
    expect(startTotpEnrollment).not.toHaveBeenCalled()
  })

  it("returns the secret and provisioning URI", async () => {
    const response = await post(accessCookie())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      ok: true,
      secret: "JBSWY3DPEHPK3PXP",
      digits: 6,
      periodSeconds: 30,
    })
    expect(body.otpauthUrl).toContain("otpauth://totp/")
  })

  it("clears any managed backup-code set since enrollment resets 2FA state", async () => {
    await issueBackupCodes(user.id)
    expect(getBackupCodeStatus(user.id).managed).toBe(true)

    const response = await post(accessCookie())
    expect(response.status).toBe(200)
    expect(getBackupCodeStatus(user.id)).toEqual({ managed: false, remaining: null })
  })
})
