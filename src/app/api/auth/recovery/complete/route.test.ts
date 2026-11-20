// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { getAccountRecoveryStore, setAccountRecoveryStoreForTests } from "@/lib/auth/recovery-store"
import { setAuthAuditLogForTests } from "@/lib/auth/audit"
import { sendAuthEmail } from "@/lib/auth/mailer"

import { POST as statusPost } from "../status/route"
import { POST as passwordPost } from "../password/route"
import { POST as emailVerifiedPost } from "../email-verified/route"
import { POST as completePost } from "./route"

const revokeAllSessions = vi.fn()
const setPassword = vi.fn()
const markEmailVerified = vi.fn()
const getUserById = vi.fn()

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ revokeAllSessions, setPassword, markEmailVerified, getUserById }),
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
function call(handler: (request: Request) => Promise<Response>, path: string, body: unknown) {
  ipCounter += 1
  return handler(
    new Request(`http://localhost/api/auth/recovery/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `10.11.0.${ipCounter}`,
      },
      body: JSON.stringify(body),
    }),
  )
}

async function verifiedSession() {
  const store = getAccountRecoveryStore()
  const issued = store.issue({ userId: user.id, email: user.email })
  if (!issued.ok) throw new Error("issue failed")
  const consumed = store.consumeToken(issued.token)
  if (!consumed.ok) throw new Error("consume failed")
  return consumed.sessionToken
}

beforeEach(() => {
  revokeAllSessions.mockReset().mockResolvedValue(undefined)
  setPassword.mockReset().mockResolvedValue(undefined)
  markEmailVerified.mockReset().mockResolvedValue(undefined)
  getUserById.mockReset().mockResolvedValue(user)
  vi.mocked(sendAuthEmail).mockClear()
  setAccountRecoveryStoreForTests(undefined)
  setAuthAuditLogForTests(undefined)
})

describe("verified-phase routes", () => {
  it("rejects missing and bogus session tokens", async () => {
    expect((await call(statusPost, "status", { sessionToken: "nope" })).status).toBe(401)
    expect(
      (await call(passwordPost, "password", { sessionToken: "nope", password: "long-enough-1" }))
        .status,
    ).toBe(401)
    expect((await call(emailVerifiedPost, "email-verified", { sessionToken: "nope" })).status).toBe(
      401,
    )
    expect((await call(completePost, "complete", { sessionToken: "nope" })).status).toBe(401)
    expect(revokeAllSessions).not.toHaveBeenCalled()
  })

  it("sets the password and stamps the step", async () => {
    const sessionToken = await verifiedSession()
    const response = await call(passwordPost, "password", {
      sessionToken,
      password: "new-password-1",
    })
    expect(response.status).toBe(200)
    expect(setPassword).toHaveBeenCalledWith(user.id, "new-password-1")
    expect(getAccountRecoveryStore().getActive(user.id)?.actions.passwordResetAt).not.toBeNull()
  })

  it("rejects short passwords", async () => {
    const sessionToken = await verifiedSession()
    const response = await call(passwordPost, "password", {
      sessionToken,
      password: "short",
    })
    expect(response.status).toBe(400)
    expect(setPassword).not.toHaveBeenCalled()
  })

  it("marks the email verified", async () => {
    const sessionToken = await verifiedSession()
    const response = await call(emailVerifiedPost, "email-verified", { sessionToken })
    expect(response.status).toBe(200)
    expect(markEmailVerified).toHaveBeenCalledWith(user.id)
    expect(getAccountRecoveryStore().getActive(user.id)?.actions.emailVerifiedAt).not.toBeNull()
  })

  it("status returns phase, actions, and recent events", async () => {
    const sessionToken = await verifiedSession()
    await call(passwordPost, "password", { sessionToken, password: "new-password-1" })
    const response = await call(statusPost, "status", { sessionToken })
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.phase).toBe("verified")
    expect(payload.email).toBe(user.email)
    expect(payload.actions.passwordResetAt).not.toBeNull()
    expect(Array.isArray(payload.events)).toBe(true)
  })

  it("complete revokes all sessions, burns tokens, and emails a notice", async () => {
    const sessionToken = await verifiedSession()
    const response = await call(completePost, "complete", { sessionToken })
    expect(response.status).toBe(200)
    expect(revokeAllSessions).toHaveBeenCalledWith(user.id)
    expect(sendAuthEmail).toHaveBeenCalledTimes(1)

    const store = getAccountRecoveryStore()
    expect(store.getActive(user.id)).toBeNull()
    // Both tokens are dead after completion.
    expect(store.getBySessionToken(sessionToken)).toBeNull()
    const replay = await call(statusPost, "status", { sessionToken })
    expect(replay.status).toBe(401)
  })
})
