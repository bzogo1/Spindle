// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { listAuthEvents, setAuthAuditLogForTests } from "@/lib/auth/audit"
import {
  getBackupCodeStatus,
  issueBackupCodes,
  setBackupCodeStoreForTests,
} from "@/lib/auth/backup-codes"
import {
  getTotpRecoveryStore,
  MemoryTotpRecoveryStore,
  setTotpRecoveryStoreForTests,
} from "@/lib/auth/totp-recovery"
import { sendAuthEmail } from "@/lib/auth/mailer"
import { GET } from "./route"

const getUserById = vi.fn()
const startTotpEnrollment = vi.fn()

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ getUserById, startTotpEnrollment }),
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

function accessCookie(uid = user.id) {
  return createAccessToken({ sid: "s1", uid, email: user.email, name: user.name }).token
}

function get(cookie?: string) {
  return GET(
    new Request("http://localhost/api/auth/2fa/recovery/status", {
      headers: cookie ? { cookie: `${ACCESS_COOKIE}=${cookie}` } : {},
    }),
  )
}

beforeEach(() => {
  getUserById.mockReset().mockResolvedValue(user)
  startTotpEnrollment
    .mockReset()
    .mockResolvedValue({ secret: "s", otpauthUrl: "u", backupCodes: [] })
  vi.mocked(sendAuthEmail).mockClear()
  setTotpRecoveryStoreForTests(undefined)
  setBackupCodeStoreForTests(undefined)
  setAuthAuditLogForTests(undefined)
})

describe("GET /api/auth/2fa/recovery/status", () => {
  it("requires authentication", async () => {
    expect((await get()).status).toBe(401)
  })

  it("returns none when no recovery exists", async () => {
    const response = await get(accessCookie())
    expect(await response.json()).toMatchObject({ ok: true, state: "none" })
  })

  it("reports awaiting_token while the email link is outstanding", async () => {
    getTotpRecoveryStore().create({ userId: user.id, email: user.email })
    const response = await get(accessCookie())
    expect(await response.json()).toMatchObject({ ok: true, state: "awaiting_token" })
    expect(startTotpEnrollment).not.toHaveBeenCalled()
  })

  it("reports cooldown with a countdown before executeAt", async () => {
    // Real clock + full 72h cooldown: executeAt is ~3 days out, not due.
    const store = new MemoryTotpRecoveryStore()
    setTotpRecoveryStoreForTests(store)
    store.create({ userId: user.id, email: user.email })
    store.consumeToken(user.id)

    const response = await get(accessCookie())
    const body = await response.json()
    expect(body.state).toBe("cooldown")
    expect(body.secondsRemaining).toBeGreaterThan(70 * 60 * 60)
    expect(body.executeAt).toBeTruthy()
    expect(startTotpEnrollment).not.toHaveBeenCalled()
  })

  it("finalizes a due recovery: clears 2FA, drops backup codes, emails, audits", async () => {
    // Negative cooldown puts executeAt in the past so the GET finalizes.
    const store = new MemoryTotpRecoveryStore(-1, () => Date.now())
    setTotpRecoveryStoreForTests(store)
    await issueBackupCodes(user.id)
    store.create({ userId: user.id, email: user.email })
    store.consumeToken(user.id)

    const response = await get(accessCookie())
    expect(await response.json()).toMatchObject({ ok: true, state: "completed" })

    expect(startTotpEnrollment).toHaveBeenCalledWith(user.id)
    expect(getBackupCodeStatus(user.id)).toEqual({ managed: false, remaining: null })
    expect(store.getActive(user.id)).toBeNull()
    expect(sendAuthEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: user.email, subject: expect.stringContaining("disabled") }),
    )
    const types = listAuthEvents({ userId: user.id }).map((e) => e.type)
    expect(types).toContain("totp.recovery.completed")
  })

  it("concurrent GETs finalize exactly once — one wipe, one email, one audit", async () => {
    const store = new MemoryTotpRecoveryStore(-1, () => Date.now())
    setTotpRecoveryStoreForTests(store)
    store.create({ userId: user.id, email: user.email })
    store.consumeToken(user.id)

    const [a, b] = await Promise.all([get(accessCookie()), get(accessCookie())])
    const states = [await a.json(), await b.json()].map((r) => r.state).sort()
    // Exactly one caller observes the transition; the loser sees "none".
    expect(states).toEqual(["completed", "none"])
    expect(startTotpEnrollment).toHaveBeenCalledTimes(1)
    expect(sendAuthEmail).toHaveBeenCalledTimes(1)
    expect(
      listAuthEvents({ userId: user.id }).filter(
        (e) => (e.type as string) === "totp.recovery.completed",
      ),
    ).toHaveLength(1)
  })

  it("finalization is idempotent — a second GET reports none", async () => {
    const store = new MemoryTotpRecoveryStore(-1, () => Date.now())
    setTotpRecoveryStoreForTests(store)
    store.create({ userId: user.id, email: user.email })
    store.consumeToken(user.id)

    expect((await (await get(accessCookie())).json()).state).toBe("completed")
    expect((await (await get(accessCookie())).json()).state).toBe("none")
    expect(startTotpEnrollment).toHaveBeenCalledTimes(1)
  })
})
