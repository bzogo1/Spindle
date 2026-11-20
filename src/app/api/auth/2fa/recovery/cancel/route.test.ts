// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { listAuthEvents, setAuthAuditLogForTests } from "@/lib/auth/audit"
import { getTotpRecoveryStore, setTotpRecoveryStoreForTests } from "@/lib/auth/totp-recovery"
import { POST } from "./route"

const getUserById = vi.fn()

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return { ...actual, getAuthBackend: () => ({ getUserById }) }
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
function post(cookie?: string, headers: Record<string, string> = {}) {
  ipCounter += 1
  return POST(
    new Request("http://localhost/api/auth/2fa/recovery/cancel", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `10.3.0.${ipCounter}`,
        ...(cookie ? { cookie: `${ACCESS_COOKIE}=${cookie}` } : {}),
        ...headers,
      },
      body: "{}",
    }),
  )
}

beforeEach(() => {
  getUserById.mockReset().mockResolvedValue(user)
  setTotpRecoveryStoreForTests(undefined)
  setAuthAuditLogForTests(undefined)
})

describe("POST /api/auth/2fa/recovery/cancel", () => {
  it("rejects unauthenticated and cross-origin requests", async () => {
    expect((await post()).status).toBe(401)
    expect((await post(accessCookie(), { origin: "https://evil.example" })).status).toBe(403)
  })

  it("404s when no recovery is in progress", async () => {
    const response = await post(accessCookie())
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ ok: false, code: "no_active_recovery" })
  })

  it("cancels an awaiting_token recovery and audits it", async () => {
    getTotpRecoveryStore().create({ userId: user.id, email: user.email })
    const response = await post(accessCookie())
    expect(await response.json()).toMatchObject({ ok: true, state: "cancelled" })
    expect(getTotpRecoveryStore().getActive(user.id)).toBeNull()
    expect(listAuthEvents({ userId: user.id }).map((e) => e.type)).toContain(
      "totp.recovery.cancelled",
    )
  })

  it("cancels a cooldown recovery — the safety hatch for abuse", async () => {
    const store = getTotpRecoveryStore()
    store.create({ userId: user.id, email: user.email })
    store.consumeToken(user.id)

    const response = await post(accessCookie())
    expect(await response.json()).toMatchObject({ ok: true, state: "cancelled" })
    expect(store.getActive(user.id)).toBeNull()
  })
})
