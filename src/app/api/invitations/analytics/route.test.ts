// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  encodeMockSession,
  MOCK_SESSION_COOKIE,
  type MockSessionData,
} from "@/lib/auth/mock-session"
import type { WorkspaceRole } from "@/lib/members/permissions"
import { invitationStore, type InvitationRecord } from "@/lib/invitations"

import { GET } from "./route"

// Enable the mock-session branch of actor resolution.
vi.mock("@/lib/auth/mock-session", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/auth/mock-session")>()
  return { ...mod, mockAuthEnabled: true }
})

function mockCookie(role: WorkspaceRole = "owner", email = "owner@acme.dev"): string {
  const session: MockSessionData = {
    user: { name: "Olivia Owner", email },
    workspace: { name: "Acme Research", slug: "acme", role },
    signedInAt: "2026-11-19T12:00:00.000Z",
  }
  return `${MOCK_SESSION_COOKIE}=${encodeMockSession(session)}`
}

let ipCounter = 0
function request(options: { cookie?: string; ip?: string } = {}) {
  ipCounter += 1
  const headers: Record<string, string> = {
    "x-forwarded-for": options.ip ?? `198.51.100.${ipCounter}`,
  }
  if (options.cookie) headers.cookie = options.cookie
  return GET(new Request("http://localhost/api/invitations/analytics", { method: "GET", headers }))
}

function seedRecord(overrides: Partial<InvitationRecord>): InvitationRecord {
  const result = invitationStore.create({
    email: "seed@acme.dev",
    role: "member",
    inviter: { id: "mock:owner@acme.dev", email: "owner@acme.dev", name: "Olivia" },
    workspaceName: "Acme",
  })
  if (!result.ok) throw new Error("seed create failed")
  Object.assign(result.invitation, overrides)
  return result.invitation
}

beforeEach(() => {
  invitationStore.reset()
})

describe("GET /api/invitations/analytics", () => {
  it("rejects unauthenticated callers", async () => {
    const response = await request()
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthenticated" })
  })

  it("returns zeroed analytics for an authenticated caller with no invites", async () => {
    const response = await request({ cookie: mockCookie() })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.analytics.total).toBe(0)
    expect(body.analytics.acceptanceRate).toBeNull()
  })

  it("aggregates only the caller's invitations", async () => {
    // Two invites from the caller, one accepted after 2h.
    const sent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
    const accepted = seedRecord({ status: "accepted", acceptedAt: new Date().toISOString() })
    accepted.lastSentAt = sent
    accepted.acceptedAt = new Date(Date.parse(sent) + 2 * 60 * 60 * 1000).toISOString()
    seedRecord({ email: "pending@acme.dev", role: "admin" })

    // An invite from a DIFFERENT inviter must not leak into the metrics.
    invitationStore.create({
      email: "other@acme.dev",
      role: "member",
      inviter: { id: "mock:other@acme.dev", email: "other@acme.dev", name: "Other" },
      workspaceName: "Acme",
    })

    const response = await request({ cookie: mockCookie() })
    expect(response.status).toBe(200)
    const { analytics } = await response.json()
    expect(analytics.total).toBe(2)
    expect(analytics.byStatus.accepted).toBe(1)
    expect(analytics.byStatus.pending).toBe(1)
    expect(analytics.acceptanceRate).toBeCloseTo(0.5)
    expect(analytics.timeToAccept.sampleSize).toBe(1)
    expect(analytics.timeToAccept.averageMs).toBe(2 * 60 * 60 * 1000)
    expect(analytics.roles).toMatchObject({ admin: 1, member: 1 })
    expect(analytics.topDomains).toEqual([{ domain: "acme.dev", count: 2 }])
  })

  it("scopes analytics per caller — a second inviter sees only their own", async () => {
    seedRecord({ email: "mine@acme.dev" })
    invitationStore.create({
      email: "theirs@acme.dev",
      role: "member",
      inviter: { id: "mock:other@acme.dev", email: "other@acme.dev", name: "Other" },
      workspaceName: "Acme",
    })

    const response = await request({ cookie: mockCookie("member", "other@acme.dev") })
    expect(response.status).toBe(200)
    const { analytics } = await response.json()
    expect(analytics.total).toBe(1)
    expect(analytics.topDomains).toEqual([{ domain: "acme.dev", count: 1 }])
  })
})
