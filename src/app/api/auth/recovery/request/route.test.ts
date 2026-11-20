// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { getAccountRecoveryStore, setAccountRecoveryStoreForTests } from "@/lib/auth/recovery-store"
import { setAuthAuditLogForTests } from "@/lib/auth/audit"
import { sendAuthEmail } from "@/lib/auth/mailer"
import { POST } from "./route"

const getUserByEmail = vi.fn()

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ getUserByEmail }),
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
  emailVerified: true,
  createdAt: new Date().toISOString(),
}

let ipCounter = 0
function post(body: unknown, headers: Record<string, string> = {}) {
  ipCounter += 1
  return POST(
    new Request("http://localhost/api/auth/recovery/request", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `10.9.0.${ipCounter}`,
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  getUserByEmail.mockReset()
  vi.mocked(sendAuthEmail).mockClear()
  setAccountRecoveryStoreForTests(undefined)
  setAuthAuditLogForTests(undefined)
})

describe("POST /api/auth/recovery/request", () => {
  it("rejects cross-origin requests and invalid bodies", async () => {
    expect((await post({ email: user.email }, { origin: "https://evil.example" })).status).toBe(403)
    expect((await post({ email: "not-an-email" })).status).toBe(400)
    expect(getUserByEmail).not.toHaveBeenCalled()
  })

  it("returns an identical ok for unknown and registered emails", async () => {
    getUserByEmail.mockResolvedValue(null)
    const unknown = await post({ email: "ghost@lab.edu" })
    expect(unknown.status).toBe(200)
    expect(await unknown.json()).toMatchObject({ ok: true, sent: true })
    expect(sendAuthEmail).not.toHaveBeenCalled()
    expect(getAccountRecoveryStore().getActive("ghost")).toBeNull()

    getUserByEmail.mockResolvedValue(user)
    const known = await post({ email: user.email })
    expect(known.status).toBe(200)
    expect(await known.json()).toMatchObject({ ok: true, sent: true })
  })

  it("emails a single-use recovery link for a registered user", async () => {
    getUserByEmail.mockResolvedValue(user)
    const response = await post({ email: "ADA@lab.edu" })
    expect(response.status).toBe(200)

    expect(sendAuthEmail).toHaveBeenCalledTimes(1)
    const email = vi.mocked(sendAuthEmail).mock.calls[0][0]
    expect(email.to).toBe(user.email)
    expect(email.linkPath).toMatch(/^\/account-recovery\?token=.+/)

    const record = getAccountRecoveryStore().getActive(user.id)
    expect(record?.phase).toBe("pending")
    expect(record?.email).toBe(user.email)
  })

  it("stays ok but skips the email inside the resend window", async () => {
    getUserByEmail.mockResolvedValue(user)
    await post({ email: user.email })
    const second = await post({ email: user.email })
    expect(second.status).toBe(200)
    expect(await second.json()).toMatchObject({ ok: true, sent: true })
    expect(sendAuthEmail).toHaveBeenCalledTimes(1)
  })
})
