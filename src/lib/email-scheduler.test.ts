import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  cancelScheduled,
  EMAIL_SCHEDULE_MAX_ENTRIES,
  EmailScheduleError,
  getScheduledEmail,
  listScheduled,
  processDue,
  resetEmailScheduleForTests,
  scheduleEmail,
  type ScheduledEmailSendFn,
} from "./email-scheduler"

const FUTURE = "2999-01-01T00:00:00.000Z"
const PAST = "2000-01-01T00:00:00.000Z"

function schedule(overrides: Record<string, unknown> = {}) {
  return scheduleEmail({
    to: "Ada@Example.com",
    subject: "Hello",
    sendAt: FUTURE,
    textBody: "Body",
    ...overrides,
  })
}

beforeEach(() => {
  resetEmailScheduleForTests()
})

describe("scheduleEmail", () => {
  it("creates a scheduled record with a normalized recipient and ISO sendAt", () => {
    const email = schedule({ sendAt: "2999-01-01T00:00:00+02:00" })
    expect(email.id).toMatch(/^eml_/)
    expect(email.to).toBe("ada@example.com")
    expect(email.sendAt).toBe("2998-12-31T22:00:00.000Z")
    expect(email.status).toBe("scheduled")
    expect(email.createdAt).toBeTruthy()
  })

  it("rejects an invalid email, empty subject, and missing body/template", () => {
    expect(() => schedule({ to: "nope" })).toThrow(EmailScheduleError)
    expect(() => schedule({ subject: "   " })).toThrow(EmailScheduleError)
    expect(() => schedule({ textBody: undefined })).toThrow(
      /text body, an HTML body, or a template key/,
    )
  })

  it("rejects a sendAt in the past or unparseable", () => {
    expect(() => schedule({ sendAt: PAST })).toThrow(/future/)
    expect(() => schedule({ sendAt: "not-a-date" })).toThrow(EmailScheduleError)
  })

  it("caps the queue and evicts oldest non-scheduled records first", () => {
    // Fill with terminal records, then confirm a new schedule still succeeds.
    for (let i = 0; i < EMAIL_SCHEDULE_MAX_ENTRIES; i += 1) {
      const email = schedule({ subject: `m${i}` })
      cancelScheduled(email.id)
    }
    expect(() => schedule()).not.toThrow()

    // Fill entirely with scheduled records → queue_full.
    resetEmailScheduleForTests()
    for (let i = 0; i < EMAIL_SCHEDULE_MAX_ENTRIES; i += 1) schedule({ subject: `m${i}` })
    expect(() => schedule()).toThrowError(
      expect.objectContaining({ code: "queue_full" }) as EmailScheduleError,
    )
  })
})

describe("listScheduled / getScheduledEmail / cancelScheduled", () => {
  it("lists soonest-send first and filters by status", () => {
    const later = schedule({ subject: "later", sendAt: "2999-06-01T00:00:00.000Z" })
    const sooner = schedule({ subject: "sooner", sendAt: FUTURE })
    void later
    void sooner

    const all = listScheduled()
    expect(all.total).toBe(2)
    expect(all.items[0].subject).toBe("sooner")

    expect(listScheduled({ status: "sent" }).total).toBe(0)
    cancelScheduled(sooner.id)
    expect(listScheduled({ status: "canceled" }).items.map((e) => e.id)).toEqual([sooner.id])
  })

  it("paginates with limit/offset", () => {
    schedule({ subject: "a" })
    schedule({ subject: "b" })
    schedule({ subject: "c" })
    const page = listScheduled({ limit: 2, offset: 1 })
    expect(page.total).toBe(3)
    expect(page.items).toHaveLength(2)
  })

  it("cancels only scheduled records", () => {
    const email = schedule()
    expect(cancelScheduled("missing")).toEqual({ ok: false, reason: "not_found" })
    const result = cancelScheduled(email.id)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.email.status).toBe("canceled")
    expect(cancelScheduled(email.id)).toEqual({ ok: false, reason: "not_scheduled" })
    expect(getScheduledEmail(email.id)?.status).toBe("canceled")
    expect(getScheduledEmail("missing")).toBeNull()
  })
})

describe("processDue", () => {
  const now = Date.parse("3000-01-01T00:00:00.000Z")

  it("sends due emails and records sent/sentAt", async () => {
    const due = schedule({ sendAt: "2999-06-01T00:00:00.000Z", subject: "due" })
    const future = schedule({ sendAt: "3001-06-01T00:00:00.000Z", subject: "future" })
    const send = vi.fn<ScheduledEmailSendFn>().mockResolvedValue("sent")

    const summary = await processDue(now, { send })
    expect(summary).toEqual({ processed: 1, sent: 1, failed: 0 })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toMatchObject({ to: "ada@example.com", subject: "due" })
    expect(getScheduledEmail(due.id)).toMatchObject({ status: "sent" })
    expect(getScheduledEmail(due.id)?.sentAt).toBeTruthy()
    expect(getScheduledEmail(future.id)?.status).toBe("scheduled")
  })

  it("records failures without throwing and continues the queue", async () => {
    schedule({ subject: "bad", sendAt: "2999-01-02T00:00:00.000Z" })
    schedule({ subject: "good", sendAt: "2999-01-02T00:00:00.000Z" })
    const send = vi
      .fn<ScheduledEmailSendFn>()
      .mockRejectedValueOnce(new Error("provider down"))
      .mockResolvedValueOnce("sent")

    const summary = await processDue(now, { send })
    expect(summary).toEqual({ processed: 2, sent: 1, failed: 1 })
    const records = listScheduled().items
    const failed = records.find((r) => r.subject === "bad")
    const sent = records.find((r) => r.subject === "good")
    expect(failed).toMatchObject({ status: "failed", lastError: "provider down" })
    expect(sent?.status).toBe("sent")
  })

  it("records 'unconfigured' deliveries as failed, not sent", async () => {
    schedule({ sendAt: "2999-01-02T00:00:00.000Z" })
    const summary = await processDue(now, { send: async () => "unconfigured" })
    expect(summary).toEqual({ processed: 1, sent: 0, failed: 1 })
    const [record] = listScheduled().items
    expect(record.status).toBe("failed")
    expect(record.lastError).toMatch(/not configured/)
  })

  it("falls back to htmlBody/subject for the required text field", async () => {
    schedule({ sendAt: "2999-01-02T00:00:00.000Z", textBody: undefined, htmlBody: "<p>hi</p>" })
    const send = vi.fn<ScheduledEmailSendFn>().mockResolvedValue("sent")
    await processDue(now, { send })
    expect(send.mock.calls[0][0]).toMatchObject({ text: "<p>hi</p>", html: "<p>hi</p>" })
  })
})
