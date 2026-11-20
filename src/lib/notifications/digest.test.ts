import { beforeEach, describe, expect, it, vi } from "vitest"

const sendEmail = vi.fn()

vi.mock("@/lib/email", () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}))

import {
  DIGEST_MAX_ITEMS,
  isDigestDue,
  sanitizeDigestPreferences,
  selectDigestNotifications,
  sendNotificationDigest,
  type DigestNotification,
} from "./digest"

const DAY = 24 * 60 * 60 * 1000

function prefs(overrides: Record<string, unknown> = {}) {
  return sanitizeDigestPreferences({
    email: true,
    categories: {
      activity: { email: true },
      agent: { email: false },
      lab: { email: false },
      product: { email: false },
      security: { email: true },
    },
    ...overrides,
  })
}

beforeEach(() => {
  sendEmail.mockReset()
  sendEmail.mockResolvedValue("sent")
})

describe("sanitizeDigestPreferences", () => {
  it("defaults the email master switch to off for missing or malformed input", () => {
    expect(sanitizeDigestPreferences(undefined).email).toBe(false)
    expect(sanitizeDigestPreferences(null).email).toBe(false)
    expect(sanitizeDigestPreferences("junk").email).toBe(false)
    expect(sanitizeDigestPreferences({ email: "yes" }).email).toBe(false)
  })

  it("keeps valid toggles and ignores malformed category entries", () => {
    const result = sanitizeDigestPreferences({
      email: true,
      categories: { agent: { email: true }, security: "bad", bogus: { email: true } },
    })
    expect(result.email).toBe(true)
    expect(result.categories.agent.email).toBe(true)
    // Unknown keys are dropped; known categories keep safe defaults.
    expect(result.categories.security.email).toBe(true) // provider default
    expect("bogus" in result.categories).toBe(false)
  })
})

describe("isDigestDue", () => {
  const now = Date.parse("2025-01-08T12:00:00Z")

  it("is never due when frequency is off", () => {
    expect(isDigestDue({ frequency: "off", lastSentAt: null, now })).toBe(false)
  })

  it("is due immediately when no digest was ever sent", () => {
    expect(isDigestDue({ frequency: "daily", lastSentAt: null, now })).toBe(true)
    expect(isDigestDue({ frequency: "weekly" })).toBe(true)
  })

  it("respects the daily and weekly intervals", () => {
    const justSent = new Date(now - DAY / 2).toISOString()
    expect(isDigestDue({ frequency: "daily", lastSentAt: justSent, now })).toBe(false)
    expect(isDigestDue({ frequency: "weekly", lastSentAt: justSent, now })).toBe(false)

    const yesterday = new Date(now - DAY - 1).toISOString()
    expect(isDigestDue({ frequency: "daily", lastSentAt: yesterday, now })).toBe(true)

    const sixDays = new Date(now - 6 * DAY).toISOString()
    expect(isDigestDue({ frequency: "weekly", lastSentAt: sixDays, now })).toBe(false)

    const eightDays = new Date(now - 8 * DAY).toISOString()
    expect(isDigestDue({ frequency: "weekly", lastSentAt: eightDays, now })).toBe(true)
  })

  it("treats an unparseable timestamp as due", () => {
    expect(isDigestDue({ frequency: "daily", lastSentAt: "not-a-date", now })).toBe(true)
  })
})

describe("selectDigestNotifications", () => {
  const feed: DigestNotification[] = [
    { title: "old", category: "activity", createdAt: "2025-01-01T00:00:00Z" },
    { title: "agent-off", category: "agent", createdAt: "2025-01-07T00:00:00Z" },
    { title: "security", category: "security", createdAt: "2025-01-06T00:00:00Z" },
    { title: "untagged", createdAt: "2025-01-05T00:00:00Z" },
    { title: "unknown-cat", category: "mystery", createdAt: "2025-01-04T00:00:00Z" },
  ]

  it("returns nothing when the email master switch is off", () => {
    const result = selectDigestNotifications(feed, prefs({ email: false }))
    expect(result.items).toEqual([])
    expect(result.overflowCount).toBe(0)
  })

  it("applies per-category email toggles and keeps untagged/unknown items", () => {
    const { items } = selectDigestNotifications(feed, prefs())
    const titles = items.map((item) => item.title)
    expect(titles).not.toContain("agent-off") // category email disabled
    expect(titles).toContain("security")
    expect(titles).toContain("old") // activity category email enabled
    expect(titles).toContain("untagged")
    expect(titles).toContain("unknown-cat")
  })

  it("sorts newest-first and reports overflow beyond the cap", () => {
    const many = Array.from({ length: DIGEST_MAX_ITEMS + 5 }, (_, i) => ({
      title: `n${i}`,
      createdAt: new Date(2025, 0, i + 1).toISOString(),
    }))
    const { items, overflowCount } = selectDigestNotifications(many, prefs())
    expect(items).toHaveLength(DIGEST_MAX_ITEMS)
    expect(overflowCount).toBe(5)
    expect(items[0].title).toBe(`n${DIGEST_MAX_ITEMS + 4}`)
  })
})

describe("sendNotificationDigest", () => {
  const feed: DigestNotification[] = [
    { title: "Run finished", body: "3 matches", href: "/app/runs/1", category: "agent" },
    { title: "New sign-in", category: "security" },
  ]

  it("reports disabled without sending when the email master switch is off", async () => {
    const result = await sendNotificationDigest({
      to: "user@example.com",
      frequency: "daily",
      notifications: feed,
      preferences: { email: false },
    })
    expect(result).toEqual({ delivery: "disabled", itemCount: 0, overflowCount: 0 })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("reports empty when no notifications survive filtering", async () => {
    const result = await sendNotificationDigest({
      to: "user@example.com",
      frequency: "weekly",
      notifications: [{ title: "x", category: "agent" }],
      // agent email defaults off in the sanitized prefs when unspecified
      preferences: { email: true, categories: { agent: { email: false } } },
    })
    expect(result.delivery).toBe("empty")
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("renders and sends the digest through sendEmail", async () => {
    const result = await sendNotificationDigest({
      to: "user@example.com",
      frequency: "daily",
      notifications: feed,
      preferences: { email: true, categories: { agent: { email: true } } },
    })
    expect(result.delivery).toBe("sent")
    expect(result.itemCount).toBe(2)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const message = sendEmail.mock.calls[0][0] as {
      to: string
      subject: string
      html: string
      text: string
    }
    expect(message.to).toBe("user@example.com")
    expect(message.subject).toContain("daily digest")
    expect(message.html).toContain("Run finished")
    expect(message.text).toContain("New sign-in")
  })

  it("passes through the unconfigured delivery outcome", async () => {
    sendEmail.mockResolvedValue("unconfigured")
    const result = await sendNotificationDigest({
      to: "user@example.com",
      frequency: "weekly",
      notifications: feed,
      preferences: { email: true },
    })
    expect(result.delivery).toBe("unconfigured")
  })
})
