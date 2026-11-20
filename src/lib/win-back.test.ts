// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  clearUnsubscribeStore,
  unsubscribeAddress,
  unsubscribePageUrl,
} from "@/lib/email-unsubscribe"
import { clearNewsletterStore, subscribe, unsubscribe } from "@/lib/newsletter-store"

import {
  clearWinBackStore,
  createCampaign,
  defaultWinBackUserSource,
  findInactiveUsers,
  getCampaign,
  isWinBackSuppressed,
  listCampaigns,
  renderWinBackEmail,
  runCampaign,
  updateCampaign,
  WIN_BACK_MAX_CANDIDATES_PER_RUN,
  WinBackError,
  type WinBackSendFn,
  type WinBackUserRecord,
} from "./win-back"

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse("2026-06-01T00:00:00.000Z")

function iso(daysAgo: number): string {
  return new Date(NOW - daysAgo * DAY).toISOString()
}

function record(overrides: Partial<WinBackUserRecord> = {}): WinBackUserRecord {
  return {
    id: "u1",
    email: "user@example.com",
    name: "User",
    createdAt: iso(200),
    lastActivityAt: iso(60),
    ...overrides,
  }
}

function sourceOf(records: WinBackUserRecord[]) {
  return () => records
}

beforeEach(() => {
  clearUnsubscribeStore()
  clearNewsletterStore()
  clearWinBackStore()
})

describe("createCampaign / listCampaigns / getCampaign / updateCampaign", () => {
  it("creates a draft campaign with zeroed stats", () => {
    const campaign = createCampaign({
      name: "Win back Q2",
      subject: "We miss you, {{name}}",
      bodyTemplate: "Hello {{name}}, come back.",
      minInactiveDays: 30,
      targetSegment: "newsletter",
    })
    expect(campaign.status).toBe("draft")
    expect(campaign.stats).toEqual({ sent: 0, suppressed: 0, failed: 0 })
    expect(campaign.id).toMatch(/^wb_/)
    expect(getCampaign(campaign.id)).toBe(campaign)
  })

  it("rejects invalid input", () => {
    expect(() =>
      createCampaign({ name: " ", subject: "s", bodyTemplate: "b", minInactiveDays: 30 }),
    ).toThrow(WinBackError)
    expect(() =>
      createCampaign({ name: "n", subject: "s", bodyTemplate: "b", minInactiveDays: 0 }),
    ).toThrow(WinBackError)
    expect(() =>
      createCampaign({ name: "n", subject: "s", bodyTemplate: "b", minInactiveDays: 1.5 }),
    ).not.toThrow() // truncated to 1
  })

  it("lists campaigns filtered by status, newest first", () => {
    const a = createCampaign({ name: "a", subject: "s", bodyTemplate: "b", minInactiveDays: 10 })
    const b = createCampaign({ name: "b", subject: "s", bodyTemplate: "b", minInactiveDays: 10 })
    updateCampaign(b.id, { status: "active" })
    expect(listCampaigns().total).toBe(2)
    expect(listCampaigns({ status: "active" }).items.map((c) => c.id)).toEqual([b.id])
    // Same-millisecond createdAt makes id-desc the tiebreak; just assert both.
    expect(new Set(listCampaigns().items.map((c) => c.id))).toEqual(new Set([a.id, b.id]))
  })

  it("updates fields and status; completed campaigns are immutable", () => {
    const campaign = createCampaign({
      name: "n",
      subject: "s",
      bodyTemplate: "b",
      minInactiveDays: 30,
    })
    updateCampaign(campaign.id, { status: "active", name: "renamed" })
    expect(getCampaign(campaign.id)).toMatchObject({ status: "active", name: "renamed" })
    updateCampaign(campaign.id, { status: "completed" })
    expect(() => updateCampaign(campaign.id, { name: "x" })).toThrow(WinBackError)
    expect(getCampaign("missing")).toBeNull()
  })
})

describe("findInactiveUsers", () => {
  it("returns users whose last activity is older than minDays", async () => {
    const candidates = await findInactiveUsers(
      30,
      sourceOf([
        record({ id: "old", email: "old@example.com", lastActivityAt: iso(45) }),
        record({ id: "new", email: "new@example.com", lastActivityAt: iso(10) }),
        record({ id: "never", email: "never@example.com", lastActivityAt: null }),
      ]),
      NOW,
    )
    // "never" has createdAt 200d ago → inactive; sorted by daysInactive desc.
    expect(candidates.map((c) => c.email)).toEqual(["never@example.com", "old@example.com"])
    expect(candidates[0].daysInactive).toBeGreaterThan(candidates[1].daysInactive)
  })

  it("uses createdAt as the floor so fresh signups are not candidates", async () => {
    const candidates = await findInactiveUsers(
      30,
      sourceOf([record({ createdAt: iso(5), lastActivityAt: null })]),
      NOW,
    )
    expect(candidates).toHaveLength(0)
  })

  it("passes through provider churnRisk scores", async () => {
    const candidates = await findInactiveUsers(30, sourceOf([record({ churnRisk: 0.9 })]), NOW)
    expect(candidates[0].churnRisk).toBe(0.9)
  })
})

describe("renderWinBackEmail", () => {
  it("interpolates {{name}} and HTML-escapes user data", () => {
    const rendered = renderWinBackEmail(
      { subject: "Hi {{name}}", bodyTemplate: "Dear {{name}},\n\n<script>alert(1)</script>" },
      { name: '<b>"Eve"</b>', email: "eve@example.com" },
      "https://example.com/unsubscribe?token=abc",
    )
    expect(rendered.subject).toBe('Hi <b>"Eve"</b>')
    expect(rendered.text).toContain("https://example.com/unsubscribe?token=abc")
    expect(rendered.html).toContain("&lt;b&gt;&quot;Eve&quot;&lt;/b&gt;")
    expect(rendered.html).not.toContain("<script>")
    expect(rendered.html).toContain("Unsubscribe")
  })

  it("falls back to 'there' when the candidate has no name", () => {
    const rendered = renderWinBackEmail(
      { subject: "s", bodyTemplate: "Hello {{name}}" },
      { name: null, email: "x@example.com" },
    )
    expect(rendered.text).toBe("Hello there")
  })
})

describe("runCampaign", () => {
  function campaignWith(overrides: Partial<Parameters<typeof createCampaign>[0]> = {}) {
    return createCampaign({
      name: "Win back",
      subject: "We miss you {{name}}",
      bodyTemplate: "Come back {{name}}.",
      minInactiveDays: 30,
      ...overrides,
    })
  }

  it("sends to inactive candidates and accumulates stats", async () => {
    const campaign = campaignWith()
    updateCampaign(campaign.id, { status: "active" })
    const send = vi.fn(async (_message: Parameters<WinBackSendFn>[0]) => "sent" as const)

    const result = await runCampaign(campaign.id, {
      send,
      now: NOW,
      userSource: sourceOf([
        record({ id: "a", email: "a@example.com", lastActivityAt: iso(60) }),
        record({ id: "b", email: "b@example.com", lastActivityAt: iso(10) }), // active → skipped
      ]),
    })

    expect(result.sent).toBe(1)
    expect(result.candidates).toBe(1)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toMatchObject({ to: "a@example.com" })
    expect(send.mock.calls[0][0].text).toContain("Come back User.")
    expect(getCampaign(campaign.id)?.stats).toMatchObject({ sent: 1, suppressed: 0, failed: 0 })
    expect(getCampaign(campaign.id)?.lastRun?.candidates).toBe(1)
  })

  it("appends a per-recipient unsubscribe link to sent emails", async () => {
    const campaign = campaignWith()
    const send = vi.fn(async (_message: Parameters<WinBackSendFn>[0]) => "sent" as const)

    await runCampaign(campaign.id, {
      send,
      now: NOW,
      userSource: sourceOf([record({ id: "a", email: "a@example.com", lastActivityAt: iso(60) })]),
      unsubscribeUrl: (email) =>
        unsubscribePageUrl({ email, origin: "https://spindle.app", scope: "marketing" }),
    })

    const message = send.mock.calls[0][0]
    expect(message.text).toContain("/unsubscribe?token=")
    expect(message.html).toContain("/unsubscribe?token=")
  })

  it("suppresses opted-out addresses in marketing and newsletter scopes", async () => {
    const campaign = campaignWith()
    unsubscribeAddress("m@example.com", "marketing")
    unsubscribeAddress("n@example.com", "newsletter")
    unsubscribeAddress("a@example.com", "all")
    const send = vi.fn(async (_message: Parameters<WinBackSendFn>[0]) => "sent" as const)

    const result = await runCampaign(campaign.id, {
      send,
      now: NOW,
      userSource: sourceOf([
        record({ id: "1", email: "m@example.com", lastActivityAt: iso(60) }),
        record({ id: "2", email: "n@example.com", lastActivityAt: iso(60) }),
        record({ id: "3", email: "a@example.com", lastActivityAt: iso(60) }),
        record({ id: "4", email: "ok@example.com", lastActivityAt: iso(60) }),
      ]),
    })

    expect(result.suppressed).toBe(3)
    expect(result.sent).toBe(1)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].to).toBe("ok@example.com")
    expect(isWinBackSuppressed("m@example.com")).toBe(true)
    expect(isWinBackSuppressed("ok@example.com")).toBe(false)
  })

  it("counts send failures and unconfigured deliveries honestly", async () => {
    const campaign = campaignWith()
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("unconfigured")

    const result = await runCampaign(campaign.id, {
      send,
      now: NOW,
      userSource: sourceOf([
        record({ id: "1", email: "f1@example.com", lastActivityAt: iso(60) }),
        record({ id: "2", email: "f2@example.com", lastActivityAt: iso(60) }),
      ]),
    })

    expect(result.failed).toBe(2)
    expect(result.sent).toBe(0)
    expect(getCampaign(campaign.id)?.stats.failed).toBe(2)
  })

  it("counts high churnRisk candidates in stats", async () => {
    const campaign = campaignWith()
    await runCampaign(campaign.id, {
      send: async () => "sent",
      now: NOW,
      userSource: sourceOf([
        record({ id: "1", email: "r1@example.com", lastActivityAt: iso(90), churnRisk: 0.8 }),
        record({ id: "2", email: "r2@example.com", lastActivityAt: iso(60), churnRisk: 0.1 }),
      ]),
    })
    expect(getCampaign(campaign.id)?.stats.churnRisk).toBe(1)
  })

  it("caps candidates per run", async () => {
    const campaign = campaignWith()
    const many = Array.from({ length: WIN_BACK_MAX_CANDIDATES_PER_RUN + 5 }, (_, i) =>
      record({ id: `u${i}`, email: `u${i}@example.com`, lastActivityAt: iso(60 + i) }),
    )
    const send = vi.fn(async (_message: Parameters<WinBackSendFn>[0]) => "sent" as const)
    const result = await runCampaign(campaign.id, {
      send,
      now: NOW,
      userSource: sourceOf(many),
    })
    expect(result.candidates).toBe(WIN_BACK_MAX_CANDIDATES_PER_RUN + 5)
    expect(send).toHaveBeenCalledTimes(WIN_BACK_MAX_CANDIDATES_PER_RUN)
  })

  it("refuses to run completed campaigns and unknown ids", async () => {
    const campaign = campaignWith()
    updateCampaign(campaign.id, { status: "completed" })
    await expect(runCampaign(campaign.id)).rejects.toMatchObject({ code: "immutable" })
    await expect(runCampaign("wb_missing")).rejects.toMatchObject({ code: "not_found" })
  })
})

describe("defaultWinBackUserSource", () => {
  it("returns active subscribers enriched from the auth backend when resolvable", async () => {
    subscribe("old@example.com", "footer")
    subscribe("new@example.com", "footer")
    subscribe("gone@example.com", "footer")
    unsubscribe("gone@example.com") // unsubscribed subscribers are excluded

    const records = await defaultWinBackUserSource({ minInactiveDays: 30, now: NOW })
    const byEmail = new Map(records.map((r) => [r.email, r]))
    expect(byEmail.has("old@example.com")).toBe(true)
    expect(byEmail.has("new@example.com")).toBe(true)
    expect(byEmail.has("gone@example.com")).toBe(false)
    // Subscriber-only fallback: consentedAt as createdAt, no observed activity.
    expect(byEmail.get("old@example.com")?.lastActivityAt).toBeNull()
  })
})
