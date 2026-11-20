import { describe, expect, it } from "vitest"

import type { InvitationRecord } from "@/lib/invitations"

import { computeInvitationAnalytics } from "./invitation-analytics"

const NOW = Date.parse("2026-11-20T12:00:00.000Z")
const DAY = 24 * 60 * 60 * 1000

function record(overrides: Partial<InvitationRecord> = {}): InvitationRecord {
  return {
    id: `inv_${Math.random().toString(36).slice(2)}`,
    email: "person@example.com",
    role: "member",
    inviterId: "mock:owner@acme.dev",
    inviterEmail: "owner@acme.dev",
    inviterName: "Olivia",
    workspaceName: "Acme",
    workspaceId: null,
    createdAt: new Date(NOW - 10 * DAY).toISOString(),
    lastSentAt: new Date(NOW - 10 * DAY).toISOString(),
    expiresAt: new Date(NOW - 3 * DAY).toISOString(),
    status: "pending",
    acceptedAt: null,
    acceptedUserId: null,
    lastReminderAt: null,
    reminderCount: 0,
    ...overrides,
  }
}

describe("computeInvitationAnalytics", () => {
  it("returns a zeroed payload for no records", () => {
    const analytics = computeInvitationAnalytics([], NOW)
    expect(analytics.total).toBe(0)
    expect(analytics.byStatus).toEqual({ pending: 0, accepted: 0, revoked: 0, expired: 0 })
    expect(analytics.acceptanceRate).toBeNull()
    expect(analytics.timeToAccept).toEqual({ averageMs: null, medianMs: null, sampleSize: 0 })
    expect(analytics.sent).toEqual({ last7Days: 0, last30Days: 0 })
    expect(analytics.roles).toEqual({ owner: 0, admin: 0, member: 0 })
    expect(analytics.topDomains).toEqual([])
  })

  it("counts statuses, deriving expired from past-due pending records", () => {
    const analytics = computeInvitationAnalytics(
      [
        // Live pending: expires in the future.
        record({ expiresAt: new Date(NOW + DAY).toISOString() }),
        // Lapsed pending → expired.
        record({ expiresAt: new Date(NOW - DAY).toISOString() }),
        record({ status: "accepted", acceptedAt: new Date(NOW - 2 * DAY).toISOString() }),
        record({ status: "revoked" }),
      ],
      NOW,
    )
    expect(analytics.byStatus).toEqual({ pending: 1, accepted: 1, revoked: 1, expired: 1 })
    expect(analytics.total).toBe(4)
    expect(analytics.acceptanceRate).toBeCloseTo(0.25)
  })

  it("computes median and average time-to-accept from lastSentAt → acceptedAt", () => {
    const base = NOW - 20 * DAY
    const analytics = computeInvitationAnalytics(
      [
        // accepted 1h after last send
        record({
          status: "accepted",
          lastSentAt: new Date(base).toISOString(),
          acceptedAt: new Date(base + 60 * 60 * 1000).toISOString(),
        }),
        // accepted 3h after last send
        record({
          status: "accepted",
          lastSentAt: new Date(base).toISOString(),
          acceptedAt: new Date(base + 3 * 60 * 60 * 1000).toISOString(),
        }),
        // accepted 5h after last send
        record({
          status: "accepted",
          lastSentAt: new Date(base).toISOString(),
          acceptedAt: new Date(base + 5 * 60 * 60 * 1000).toISOString(),
        }),
        // pending record must not contribute
        record({ status: "pending" }),
        // acceptedAt before lastSentAt (clock skew) is skipped
        record({
          status: "accepted",
          lastSentAt: new Date(base + 10 * 60 * 60 * 1000).toISOString(),
          acceptedAt: new Date(base).toISOString(),
        }),
      ],
      NOW,
    )
    expect(analytics.timeToAccept.sampleSize).toBe(3)
    expect(analytics.timeToAccept.medianMs).toBe(3 * 60 * 60 * 1000)
    expect(analytics.timeToAccept.averageMs).toBe(3 * 60 * 60 * 1000)
  })

  it("averages an even sample by rounding the two middle values", () => {
    const base = NOW - 20 * DAY
    const analytics = computeInvitationAnalytics(
      [1, 2, 3, 4].map((hours) =>
        record({
          status: "accepted",
          lastSentAt: new Date(base).toISOString(),
          acceptedAt: new Date(base + hours * 60 * 60 * 1000).toISOString(),
        }),
      ),
      NOW,
    )
    // Even sample: median averages the two middle values (2h and 3h).
    expect(analytics.timeToAccept.medianMs).toBe(2.5 * 60 * 60 * 1000)
    expect(analytics.timeToAccept.averageMs).toBe(2.5 * 60 * 60 * 1000)
  })

  it("counts invites created within the 7d/30d windows", () => {
    const analytics = computeInvitationAnalytics(
      [
        record({ createdAt: new Date(NOW - 2 * DAY).toISOString() }),
        record({ createdAt: new Date(NOW - 10 * DAY).toISOString() }),
        record({ createdAt: new Date(NOW - 20 * DAY).toISOString() }),
        record({ createdAt: new Date(NOW - 45 * DAY).toISOString() }),
      ],
      NOW,
    )
    expect(analytics.sent.last7Days).toBe(1)
    expect(analytics.sent.last30Days).toBe(3)
  })

  it("breaks down roles and top invited domains", () => {
    const analytics = computeInvitationAnalytics(
      [
        record({ email: "a@acme.com", role: "admin" }),
        record({ email: "b@acme.com", role: "member" }),
        record({ email: "c@beta.io", role: "member" }),
        record({ email: "d@beta.io", role: "owner" }),
        record({ email: "e@beta.io", role: "member" }),
      ],
      NOW,
    )
    expect(analytics.roles).toEqual({ owner: 1, admin: 1, member: 3 })
    expect(analytics.topDomains).toEqual([
      { domain: "beta.io", count: 3 },
      { domain: "acme.com", count: 2 },
    ])
  })

  it("caps topDomains at five entries", () => {
    const records = Array.from({ length: 7 }, (_, i) => record({ email: `user${i}@d${i}.dev` }))
    expect(computeInvitationAnalytics(records, NOW).topDomains).toHaveLength(5)
  })
})
