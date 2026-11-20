import { beforeEach, describe, expect, it } from "vitest"

import {
  EMAIL_DELIVERY_MAX_EVENTS,
  EMAIL_DELIVERY_MAX_RECORDS,
  getDelivery,
  listDeliveries,
  recordEvent,
  resetEmailDeliveryForTests,
  stats,
  trackEmailSend,
} from "./email-delivery"

beforeEach(() => {
  resetEmailDeliveryForTests()
})

describe("trackEmailSend / recordEvent", () => {
  it("creates a queued record and returns emailId + record", () => {
    const { emailId, record } = trackEmailSend({
      to: "Ada@Example.com",
      templateKey: "welcome",
    })
    expect(emailId).toMatch(/^del_/)
    expect(record).toMatchObject({
      emailId,
      to: "ada@example.com",
      templateKey: "welcome",
      status: "queued",
    })
    expect(record.events).toHaveLength(1)
    expect(record.events[0].type).toBe("queued")
    expect(getDelivery(emailId)?.status).toBe("queued")
  })

  it("appends events and derives status from the latest event", () => {
    const { emailId } = trackEmailSend({ to: "a@x.io" })
    recordEvent(emailId, { type: "sent", at: "2026-01-01T00:00:01.000Z" })
    recordEvent(emailId, { type: "delivered", at: "2026-01-01T00:00:02.000Z" })
    const record = getDelivery(emailId)
    expect(record?.status).toBe("delivered")
    expect(record?.events.map((e) => e.type)).toEqual(["queued", "sent", "delivered"])
    recordEvent(emailId, { type: "opened", meta: { client: "gmail" } })
    expect(getDelivery(emailId)?.status).toBe("opened")
    expect(getDelivery(emailId)?.events.at(-1)?.meta).toEqual({ client: "gmail" })
  })

  it("creates a record for an unknown emailId with to/templateKey seeding", () => {
    const record = recordEvent("del_manual", {
      type: "sent",
      to: "User@X.io",
      templateKey: "receipt",
      at: "2026-02-01T00:00:00.000Z",
    })
    expect(record).toMatchObject({
      emailId: "del_manual",
      to: "user@x.io",
      templateKey: "receipt",
      status: "sent",
    })
    expect(getDelivery("del_missing")).toBeNull()
  })

  it("treats bounced/complained as terminal-ish status", () => {
    const bounced = trackEmailSend({ to: "bad@x.io" }).emailId
    recordEvent(bounced, { type: "sent" })
    recordEvent(bounced, { type: "bounced", meta: { reason: "550" } })
    // A stray later event does not un-bounce the record.
    recordEvent(bounced, { type: "opened" })
    const record = getDelivery(bounced)
    expect(record?.status).toBe("bounced")
    expect(record?.events.map((e) => e.type)).toEqual(["queued", "sent", "bounced", "opened"])

    const complained = trackEmailSend({ to: "spam@x.io" }).emailId
    recordEvent(complained, { type: "sent" })
    recordEvent(complained, { type: "complained" })
    expect(getDelivery(complained)?.status).toBe("complained")
  })

  it("caps events per record, preserving the first and the newest", () => {
    const { emailId } = trackEmailSend({ to: "cap@x.io" })
    for (let i = 0; i < EMAIL_DELIVERY_MAX_EVENTS + 10; i += 1) {
      recordEvent(emailId, { type: "delivered" })
    }
    const record = getDelivery(emailId)
    expect(record?.events).toHaveLength(EMAIL_DELIVERY_MAX_EVENTS)
    expect(record?.events[0].type).toBe("queued")
    expect(record?.events.at(-1)?.type).toBe("delivered")
  })

  it("bounds the record store, evicting the oldest first", () => {
    for (let i = 0; i < EMAIL_DELIVERY_MAX_RECORDS; i += 1) {
      trackEmailSend({ to: `u${i}@x.io` })
    }
    const extra = trackEmailSend({ to: "extra@x.io" })
    expect(listDeliveries().total).toBe(EMAIL_DELIVERY_MAX_RECORDS)
    // Oldest record evicted; newest survives.
    expect(getDelivery(extra.emailId)).not.toBeNull()
    const all = listDeliveries({ limit: EMAIL_DELIVERY_MAX_RECORDS })
    expect(all.items.some((r) => r.to === "u0@x.io")).toBe(false)
    expect(all.items.some((r) => r.to === "extra@x.io")).toBe(true)
  })
})

describe("listDeliveries", () => {
  it("lists most-recently-active first and filters by status and recipient", () => {
    const a = trackEmailSend({ to: "ada@example.com" })
    const b = trackEmailSend({ to: "bob@example.com" })
    recordEvent(a.emailId, { type: "sent", at: "2026-01-01T00:00:00.000Z" })
    recordEvent(b.emailId, { type: "sent", at: "2026-01-02T00:00:00.000Z" })
    recordEvent(b.emailId, { type: "bounced", at: "2026-01-03T00:00:00.000Z" })

    const all = listDeliveries()
    expect(all.total).toBe(2)
    expect(all.items[0].emailId).toBe(b.emailId) // most recent activity first

    const bounced = listDeliveries({ status: "bounced" })
    expect(bounced.items.map((r) => r.emailId)).toEqual([b.emailId])

    const byTo = listDeliveries({ to: "ADA@" })
    expect(byTo.items.map((r) => r.emailId)).toEqual([a.emailId])
  })

  it("paginates with limit/offset", () => {
    trackEmailSend({ to: "a@x.io" })
    trackEmailSend({ to: "b@x.io" })
    trackEmailSend({ to: "c@x.io" })
    const page = listDeliveries({ limit: 2, offset: 1 })
    expect(page.total).toBe(3)
    expect(page.items).toHaveLength(2)
  })
})

describe("stats", () => {
  it("returns zeroed counts and null rates on an empty store", () => {
    const result = stats()
    expect(result.total).toBe(0)
    expect(result.byStatus.queued).toBe(0)
    expect(result.rates).toEqual({
      deliveryRate: null,
      bounceRate: null,
      openRate: null,
      complaintRate: null,
    })
  })

  it("computes event-based counts and rate approximations", () => {
    // Two sent records: one delivered+opened, one bounced.
    const ok = trackEmailSend({ to: "ok@x.io" }).emailId
    recordEvent(ok, { type: "sent" })
    recordEvent(ok, { type: "delivered" })
    recordEvent(ok, { type: "opened" })

    const bad = trackEmailSend({ to: "bad@x.io" }).emailId
    recordEvent(bad, { type: "sent" })
    recordEvent(bad, { type: "bounced" })

    // One still queued — excluded from rate denominators.
    trackEmailSend({ to: "pending@x.io" })

    const result = stats()
    expect(result.total).toBe(3)
    expect(result.byStatus).toMatchObject({ opened: 1, bounced: 1, queued: 1 })
    expect(result.rates.deliveryRate).toBeCloseTo(0.5)
    expect(result.rates.bounceRate).toBeCloseTo(0.5)
    expect(result.rates.openRate).toBeCloseTo(1)
    expect(result.rates.complaintRate).toBe(0)
  })
})
