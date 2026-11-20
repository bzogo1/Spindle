// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  encodeMockSession,
  MOCK_SESSION_COOKIE,
  type MockSessionData,
} from "@/lib/auth/mock-session"
import { invitationResendCooldown, invitationStore } from "@/lib/invitations"
import type { WorkspaceRole } from "@/lib/members/permissions"

import { DELETE } from "./route"
import { POST as resendPOST } from "./resend/route"

const sendInvitationEmail = vi.fn()

vi.mock("@/lib/auth/mailer", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/auth/mailer")>()
  return { ...mod, sendInvitationEmail: (...args: unknown[]) => sendInvitationEmail(...args) }
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
  overrides: { inviterId?: string; status?: "pending" | "accepted" | "revoked" } = {},
) {
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
  if (overrides.status === "accepted") invitationStore.accept(record.id, "user:x")
  if (overrides.status === "revoked") invitationStore.revoke(`mock:${OWNER_EMAIL}`, record.id)
  return record
}

let ipCounter = 0
function del(id: string, options: { cookie?: string; ip?: string; origin?: string } = {}) {
  ipCounter += 1
  const headers: Record<string, string> = {
    "x-forwarded-for": options.ip ?? `198.51.100.${ipCounter}`,
  }
  if (options.cookie) headers.cookie = options.cookie
  if (options.origin) headers.origin = options.origin
  return DELETE(
    new Request(`http://localhost/api/invitations/${id}`, { method: "DELETE", headers }),
    { params: Promise.resolve({ id }) },
  )
}

function resend(id: string, options: { cookie?: string; ip?: string } = {}) {
  ipCounter += 1
  const headers: Record<string, string> = {
    "x-forwarded-for": options.ip ?? `198.51.100.${ipCounter}`,
    "content-type": "application/json",
  }
  if (options.cookie) headers.cookie = options.cookie
  return resendPOST(
    new Request(`http://localhost/api/invitations/${id}/resend`, {
      method: "POST",
      headers,
      body: "{}",
    }),
    { params: Promise.resolve({ id }) },
  )
}

beforeEach(() => {
  vi.useRealTimers()
  invitationStore.reset()
  invitationResendCooldown.reset()
  sendInvitationEmail.mockReset().mockResolvedValue(undefined)
})

describe("DELETE /api/invitations/[id]", () => {
  it("revokes a pending invite owned by the caller", async () => {
    const record = seedInvite()
    const response = await del(record.id, { cookie: mockCookie() })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.invitation.status).toBe("revoked")
    expect(invitationStore.getById(record.id)?.status).toBe("revoked")
  })

  it("404s for foreign, missing, and terminal invites", async () => {
    const foreign = seedInvite({ inviterId: "mock:other@acme.dev" })
    expect((await del(foreign.id, { cookie: mockCookie() })).status).toBe(404)
    expect((await del("inv_missing", { cookie: mockCookie() })).status).toBe(404)

    const accepted = seedInvite({ status: "accepted" })
    expect((await del(accepted.id, { cookie: mockCookie() })).status).toBe(404)
  })

  it("requires auth and manage permission", async () => {
    const record = seedInvite()
    expect((await del(record.id)).status).toBe(401)
    expect((await del(record.id, { cookie: mockCookie("member", "m@acme.dev") })).status).toBe(403)
  })

  it("blocks cross-origin deletes", async () => {
    const record = seedInvite()
    const response = await del(record.id, {
      cookie: mockCookie(),
      origin: "https://evil.example",
    })
    expect(response.status).toBe(403)
  })
})

describe("POST /api/invitations/[id]/resend", () => {
  it("extends expiry, rotates the link, and emails again", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
    const record = seedInvite()
    // Snapshot the string — the store mutates the record in place on resend.
    const beforeExpiresAt = record.expiresAt
    vi.setSystemTime(new Date(Date.now() + 60_000))

    const response = await resend(record.id, { cookie: mockCookie() })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.invitation.status).toBe("pending")
    expect(Date.parse(body.invitation.expiresAt)).toBeGreaterThan(Date.parse(beforeExpiresAt))
    expect(sendInvitationEmail).toHaveBeenCalledTimes(1)
    expect(sendInvitationEmail.mock.calls[0][0].to).toMatch(/^invitee\d+@acme\.dev$/)
    expect(body.retryAfter).toBeGreaterThan(0)
  })

  it("404s for foreign, missing, and terminal invites", async () => {
    const foreign = seedInvite({ inviterId: "mock:other@acme.dev" })
    expect((await resend(foreign.id, { cookie: mockCookie() })).status).toBe(404)
    expect((await resend("inv_missing", { cookie: mockCookie() })).status).toBe(404)

    const revoked = seedInvite({ status: "revoked" })
    expect((await resend(revoked.id, { cookie: mockCookie() })).status).toBe(404)
  })

  it("requires auth and manage permission", async () => {
    const record = seedInvite()
    expect((await resend(record.id)).status).toBe(401)
    expect((await resend(record.id, { cookie: mockCookie("member", "m@acme.dev") })).status).toBe(
      403,
    )
  })

  it("rate-limits resends inside the per-email cooldown", async () => {
    const record = seedInvite()
    const ip = "203.0.113.77"
    expect((await resend(record.id, { cookie: mockCookie(), ip })).status).toBe(200)
    const second = await resend(record.id, { cookie: mockCookie(), ip })
    expect(second.status).toBe(429)
    expect(second.headers.get("retry-after")).toBeTruthy()
  })
})
