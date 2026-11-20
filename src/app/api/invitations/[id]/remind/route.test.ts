// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  encodeMockSession,
  MOCK_SESSION_COOKIE,
  type MockSessionData,
} from "@/lib/auth/mock-session"
import {
  invitationResendCooldown,
  invitationStore,
  INVITATION_REMINDER_MIN_INTERVAL_MS,
  INVITATION_TTL_MS,
  type InvitationRecord,
} from "@/lib/invitations"
import type { WorkspaceRole } from "@/lib/members/permissions"

import { POST as remindPOST } from "./route"
import { POST as tickPOST } from "../../tick/route"

const sendInvitationReminderEmail = vi.fn()
const getServerEnv = vi.fn()

vi.mock("@/lib/env.server", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/env.server")>()
  return { ...mod, getServerEnv: () => getServerEnv() }
})

vi.mock("@/lib/auth/mailer", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/auth/mailer")>()
  return {
    ...mod,
    sendInvitationReminderEmail: (...args: unknown[]) => sendInvitationReminderEmail(...args),
  }
})

vi.mock("@/lib/auth/mock-session", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/auth/mock-session")>()
  return { ...mod, mockAuthEnabled: true }
})

const OWNER_EMAIL = "owner@acme.dev"

function mockCookie(role: WorkspaceRole = "owner", email = OWNER_EMAIL): string {
  const session: MockSessionData = {
    user: { name: "Olivia Owner", email },
    workspace: { name: "Acme Research", slug: "acme", role },
    signedInAt: "2026-11-19T12:00:00.000Z",
  }
  return `${MOCK_SESSION_COOKIE}=${encodeMockSession(session)}`
}

let seedCounter = 0
function seedInvite(
  overrides: { inviterId?: string; nearExpiry?: boolean } = {},
): InvitationRecord {
  seedCounter += 1
  const result = invitationStore.create({
    email: `invitee${seedCounter}@acme.dev`,
    role: "member",
    inviter: {
      id: overrides.inviterId ?? `mock:${OWNER_EMAIL}`,
      email: OWNER_EMAIL,
      name: "Olivia Owner",
    },
    workspaceName: "Acme Research",
  })
  if (!result.ok) throw new Error("seed failed")
  const record = result.invitation
  if (overrides.nearExpiry) {
    // Inside the automated reminder window (last 24h before expiry).
    record.expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
  }
  return record
}

let ipCounter = 0
function remind(id: string, options: { cookie?: string; ip?: string; origin?: string } = {}) {
  ipCounter += 1
  const headers: Record<string, string> = {
    "x-forwarded-for": options.ip ?? `198.51.100.${ipCounter}`,
    "content-type": "application/json",
  }
  if (options.cookie) headers.cookie = options.cookie
  if (options.origin) headers.origin = options.origin
  return remindPOST(
    new Request(`http://localhost/api/invitations/${id}/remind`, {
      method: "POST",
      headers,
      body: "{}",
    }),
    { params: Promise.resolve({ id }) },
  )
}

let tickIpCounter = 0
function tick(headers: Record<string, string> = {}) {
  tickIpCounter += 1
  return tickPOST(
    new Request("http://localhost/api/invitations/tick", {
      method: "POST",
      headers: { "x-forwarded-for": `203.0.113.${tickIpCounter}`, ...headers },
    }),
  )
}

beforeEach(() => {
  vi.useRealTimers()
  getServerEnv.mockReturnValue({ NODE_ENV: "test", SESSION_SECRET: undefined })
  invitationStore.reset()
  invitationResendCooldown.reset()
  sendInvitationReminderEmail.mockReset().mockResolvedValue("sent")
})

afterEach(() => {
  vi.useRealTimers()
})

describe("POST /api/invitations/[id]/remind", () => {
  it("emails a reminder with the existing link and stamps tracking", async () => {
    const record = seedInvite()
    const response = await remind(record.id, { cookie: mockCookie() })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.invitation.status).toBe("pending")

    expect(sendInvitationReminderEmail).toHaveBeenCalledTimes(1)
    const mail = sendInvitationReminderEmail.mock.calls[0][0]
    expect(mail.to).toBe(record.email)
    expect(mail.url).toContain("/invite?token=")
    expect(mail.expiresIn).toBeTruthy()

    const updated = invitationStore.getById(record.id)!
    expect(updated.reminderCount).toBe(1)
    expect(updated.lastReminderAt).not.toBeNull()
    // No rotation, no extension.
    expect(updated.lastSentAt).toBe(record.lastSentAt)
    expect(updated.expiresAt).toBe(record.expiresAt)
    // Reminder budget is visible in the view payload.
    expect(body.invitation).toMatchObject({
      reminderCount: 1,
      reminderLimit: 3,
      lastReminderAt: updated.lastReminderAt,
    })
  })

  it("503s without burning budget when the email provider is unconfigured", async () => {
    const record = seedInvite()
    sendInvitationReminderEmail.mockResolvedValueOnce("unconfigured")
    const response = await remind(record.id, { cookie: mockCookie() })
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: "email_unconfigured" })
    // Phantom budget fix: no reminder slot was consumed.
    const updated = invitationStore.getById(record.id)!
    expect(updated.reminderCount).toBe(0)
    expect(updated.lastReminderAt).toBeNull()
    // And the invite can be reminded again once the provider is configured.
    sendInvitationReminderEmail.mockResolvedValueOnce("sent")
    expect((await remind(record.id, { cookie: mockCookie() })).status).toBe(200)
    expect(invitationStore.getById(record.id)!.reminderCount).toBe(1)
  })

  it("502s without burning budget when the provider throws", async () => {
    const record = seedInvite()
    sendInvitationReminderEmail.mockRejectedValueOnce(new Error("resend down"))
    const response = await remind(record.id, { cookie: mockCookie() })
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ code: "email_send_failed" })
    const updated = invitationStore.getById(record.id)!
    expect(updated.reminderCount).toBe(0)
    expect(updated.lastReminderAt).toBeNull()
  })

  it("404s for foreign, missing, and terminal invites", async () => {
    const foreign = seedInvite({ inviterId: "mock:other@acme.dev" })
    expect((await remind(foreign.id, { cookie: mockCookie() })).status).toBe(404)
    expect((await remind("inv_missing", { cookie: mockCookie() })).status).toBe(404)

    const accepted = seedInvite()
    invitationStore.accept(accepted.id, "user:x")
    expect((await remind(accepted.id, { cookie: mockCookie() })).status).toBe(404)
  })

  it("410s for expired invites and points at resend", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
    const record = seedInvite()
    vi.setSystemTime(new Date(Date.now() + INVITATION_TTL_MS + 1))
    const response = await remind(record.id, { cookie: mockCookie() })
    expect(response.status).toBe(410)
    expect(await response.json()).toMatchObject({ code: "invite_expired" })
    expect(sendInvitationReminderEmail).not.toHaveBeenCalled()
  })

  it("requires auth, manage permission, and same-origin", async () => {
    const record = seedInvite()
    expect((await remind(record.id)).status).toBe(401)
    expect((await remind(record.id, { cookie: mockCookie("member", "m@acme.dev") })).status).toBe(
      403,
    )
    expect(
      (await remind(record.id, { cookie: mockCookie(), origin: "https://evil.example" })).status,
    ).toBe(403)
  })

  it("429s inside the per-invite reminder cooldown", async () => {
    const record = seedInvite()
    expect((await remind(record.id, { cookie: mockCookie() })).status).toBe(200)
    const second = await remind(record.id, { cookie: mockCookie() })
    expect(second.status).toBe(429)
    expect(second.headers.get("retry-after")).toBeTruthy()
    expect(sendInvitationReminderEmail).toHaveBeenCalledTimes(1)
  })

  it("409s once the reminder cap is reached", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
    const record = seedInvite()
    for (let i = 0; i < 3; i += 1) {
      vi.setSystemTime(Date.now() + INVITATION_REMINDER_MIN_INTERVAL_MS + 1)
      const response = await remind(record.id, { cookie: mockCookie() })
      expect(response.status).toBe(200)
    }
    vi.setSystemTime(Date.now() + INVITATION_REMINDER_MIN_INTERVAL_MS + 1)
    const capped = await remind(record.id, { cookie: mockCookie() })
    expect(capped.status).toBe(409)
    expect(await capped.json()).toMatchObject({ code: "reminder_limit" })
  })
})

describe("POST /api/invitations/tick", () => {
  it("sweeps expired invites and sends reminders for near-expiry ones", async () => {
    const nearExpiry = seedInvite({ nearExpiry: true })
    const fresh = seedInvite() // 7d left — outside the reminder window
    const lapsed = seedInvite()
    // Force one invite past expiry.
    lapsed.expiresAt = new Date(Date.now() - 1000).toISOString()

    const response = await tick()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ ok: true, swept: 1, eligible: 1, sent: 1, failed: 0 })

    expect(sendInvitationReminderEmail).toHaveBeenCalledTimes(1)
    expect(sendInvitationReminderEmail.mock.calls[0][0].to).toBe(nearExpiry.email)
    expect(invitationStore.getById(lapsed.id)?.status).toBe("expired")
    expect(invitationStore.getById(nearExpiry.id)?.reminderCount).toBe(1)
    expect(invitationStore.getById(fresh.id)?.reminderCount).toBe(0)
  })

  it("does not re-remind inside the cooldown on the next tick", async () => {
    seedInvite({ nearExpiry: true })
    await tick()
    const second = await tick()
    const body = await second.json()
    expect(body).toMatchObject({ ok: true, eligible: 0, sent: 0 })
    expect(sendInvitationReminderEmail).toHaveBeenCalledTimes(1)
  })

  it("does not stamp the reminder when the provider throws", async () => {
    seedInvite({ nearExpiry: true })
    sendInvitationReminderEmail.mockRejectedValueOnce(new Error("resend down"))
    const response = await tick()
    const body = await response.json()
    expect(body).toMatchObject({ ok: true, sent: 0, failed: 1, unconfigured: 0 })
    // Failed sends are NOT stamped — the next tick retries.
    const [record] = invitationStore.listForInviter(`mock:${OWNER_EMAIL}`)
    expect(record.reminderCount).toBe(0)
  })

  it("does not stamp the reminder when the provider is unconfigured", async () => {
    seedInvite({ nearExpiry: true })
    sendInvitationReminderEmail.mockResolvedValueOnce("unconfigured")
    const response = await tick()
    const body = await response.json()
    expect(body).toMatchObject({ ok: true, sent: 0, failed: 0, unconfigured: 1 })
    const [record] = invitationStore.listForInviter(`mock:${OWNER_EMAIL}`)
    expect(record.reminderCount).toBe(0)
    expect(record.lastReminderAt).toBeNull()
    // Still eligible — a later tick with a configured provider will send.
    sendInvitationReminderEmail.mockResolvedValueOnce("sent")
    const retry = await tick()
    expect(await retry.json()).toMatchObject({ ok: true, sent: 1 })
    expect(invitationStore.getById(record.id)!.reminderCount).toBe(1)
  })

  it("requires the bearer secret when SESSION_SECRET is set", async () => {
    getServerEnv.mockReturnValue({
      NODE_ENV: "production",
      SESSION_SECRET: "tick-secret",
    })
    seedInvite({ nearExpiry: true })

    // No / wrong token → 401, no reminders sent.
    expect((await tick()).status).toBe(401)
    expect((await tick({ authorization: "Bearer wrong" })).status).toBe(401)
    expect(sendInvitationReminderEmail).not.toHaveBeenCalled()

    // Correct bearer → tick runs.
    const okResponse = await tick({ authorization: "Bearer tick-secret" })
    expect(okResponse.status).toBe(200)
    expect(await okResponse.json()).toMatchObject({ ok: true, sent: 1 })
    expect(sendInvitationReminderEmail).toHaveBeenCalledTimes(1)
  })
})
