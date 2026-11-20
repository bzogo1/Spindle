// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest"

import { isUnsubscribed, unsubscribeAddress } from "@/lib/email-unsubscribe"
import {
  clearNewsletterStore,
  listCampaigns,
  listSubscribers,
  NEWSLETTER_STORE_MAX_CAMPAIGNS,
  NEWSLETTER_STORE_MAX_SUBSCRIBERS,
  recordCampaign,
  stats,
  subscribe,
  unsubscribe,
} from "@/lib/newsletter-store"

beforeEach(() => {
  clearNewsletterStore()
})

describe("subscribe", () => {
  it("records a normalized subscriber as active", () => {
    const subscriber = subscribe("  Reader@Lab.EDU ", "site-footer")
    expect(subscriber.email).toBe("reader@lab.edu")
    expect(subscriber.source).toBe("site-footer")
    expect(subscriber.status).toBe("active")
    expect(subscriber.consentedAt).toBeTruthy()
    expect(subscriber.id).toMatch(/^sub_/)
  })

  it("dedupes by normalized email and refreshes consent", () => {
    subscribe("a@b.c", "first")
    const again = subscribe("A@B.C", "second")
    expect(listSubscribers().total).toBe(1)
    expect(again.source).toBe("second")
    expect(again.status).toBe("active")
  })

  it("reactivates an unsubscribed address on explicit re-consent", () => {
    subscribe("a@b.c")
    unsubscribe("a@b.c")
    const resubscribed = subscribe("a@b.c")
    expect(resubscribed.status).toBe("active")
    expect(resubscribed.unsubscribedAt).toBeUndefined()
  })

  it("clears the newsletter opt-out when re-subscribing", () => {
    subscribe("a@b.c")
    unsubscribe("a@b.c")
    expect(isUnsubscribed("a@b.c", "newsletter")).toBe(true)
    subscribe("a@b.c")
    expect(isUnsubscribed("a@b.c", "newsletter")).toBe(false)
  })

  it("clears a newsletter opt-out recorded outside the store on first subscribe", () => {
    unsubscribeAddress("a@b.c", "newsletter")
    subscribe("a@b.c")
    expect(isUnsubscribed("a@b.c", "newsletter")).toBe(false)
  })

  it("does not clear opt-outs in other scopes", () => {
    unsubscribeAddress("a@b.c", "marketing")
    unsubscribeAddress("a@b.c", "all")
    subscribe("a@b.c")
    expect(isUnsubscribed("a@b.c", "marketing")).toBe(true)
    expect(isUnsubscribed("a@b.c", "all")).toBe(true)
    // "all" still covers the newsletter scope.
    expect(isUnsubscribed("a@b.c", "newsletter")).toBe(true)
  })
})

describe("unsubscribe", () => {
  it("marks the subscriber unsubscribed and records a newsletter opt-out", () => {
    subscribe("a@b.c")
    const result = unsubscribe("A@B.C")
    expect(result?.status).toBe("unsubscribed")
    expect(result?.unsubscribedAt).toBeTruthy()
    expect(isUnsubscribed("a@b.c", "newsletter")).toBe(true)
  })

  it("returns null for an unknown address", () => {
    expect(unsubscribe("nobody@example.com")).toBeNull()
  })
})

describe("listSubscribers", () => {
  it("filters by status and query, newest first", () => {
    subscribe("one@x.io", "site-footer")
    subscribe("two@x.io", "blog")
    subscribe("three@y.io")
    unsubscribe("two@x.io")

    const active = listSubscribers({ status: "active" })
    expect(active.total).toBe(2)
    expect(active.items.map((s) => s.email).sort()).toEqual(["one@x.io", "three@y.io"])

    const blog = listSubscribers({ query: "BLOG" })
    expect(blog.items.map((s) => s.email)).toEqual(["two@x.io"])

    const page = listSubscribers({ limit: 1, offset: 1 })
    expect(page.total).toBe(3)
    expect(page.items).toHaveLength(1)
  })
})

describe("recordCampaign / listCampaigns", () => {
  it("stores a draft campaign with a truncated body preview", () => {
    const campaign = recordCampaign({
      subject: "Spring launch",
      body: "x".repeat(500),
    })
    expect(campaign.status).toBe("draft")
    expect(campaign.subject).toBe("Spring launch")
    expect(campaign.bodyPreview).toHaveLength(160)
    expect(campaign.id).toMatch(/^cmp_/)

    const listed = listCampaigns()
    expect(listed.total).toBe(1)
    expect(listed.items[0].id).toBe(campaign.id)
  })

  it("honours explicit status and recipientCount", () => {
    const campaign = recordCampaign({ subject: "S", status: "sent", recipientCount: 42 })
    expect(campaign.status).toBe("sent")
    expect(campaign.recipientCount).toBe(42)
  })

  it("paginates campaigns", () => {
    recordCampaign({ subject: "one" })
    recordCampaign({ subject: "two" })
    recordCampaign({ subject: "three" })
    const page = listCampaigns({ limit: 2, offset: 2 })
    expect(page.total).toBe(3)
    expect(page.items).toHaveLength(1)
  })
})

describe("stats", () => {
  it("counts subscribers and campaigns by status", () => {
    subscribe("a@x.io")
    subscribe("b@x.io")
    subscribe("c@x.io")
    unsubscribe("c@x.io")
    recordCampaign({ subject: "d1" })
    recordCampaign({ subject: "d2", status: "sent" })

    expect(stats()).toEqual({
      subscribers: { total: 3, pending: 0, active: 2, unsubscribed: 1 },
      campaigns: { total: 2, draft: 1, scheduled: 0, sent: 1 },
    })
  })
})

describe("capacity", () => {
  it("evicts the oldest subscriber at the cap", () => {
    for (let i = 0; i < NEWSLETTER_STORE_MAX_SUBSCRIBERS; i++) {
      subscribe(`u${i}@x.io`)
    }
    subscribe("overflow@x.io")
    expect(listSubscribers().total).toBe(NEWSLETTER_STORE_MAX_SUBSCRIBERS)
    expect(listSubscribers({ query: "u0@x.io" }).total).toBe(0)
    expect(listSubscribers({ query: "overflow@x.io" }).total).toBe(1)
  })

  it("evicts the oldest campaign at the cap", () => {
    for (let i = 0; i < NEWSLETTER_STORE_MAX_CAMPAIGNS; i++) {
      recordCampaign({ subject: `c${i}` })
    }
    recordCampaign({ subject: "overflow" })
    expect(listCampaigns().total).toBe(NEWSLETTER_STORE_MAX_CAMPAIGNS)
    expect(
      listCampaigns({ limit: NEWSLETTER_STORE_MAX_CAMPAIGNS }).items.some(
        (c) => c.subject === "c0",
      ),
    ).toBe(false)
  })
})
