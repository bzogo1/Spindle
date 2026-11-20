import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { POST } from "./route"
import { logger } from "@/lib/logger"
import {
  clearContactSubmissions,
  listSubmissions,
  type ContactSubmission,
  type RouteSubmissionInput,
} from "@/lib/contact-routing"

const sendEmail = vi.fn()

vi.mock("@/lib/email", () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
  contactRecipient: () => "hello@spindle.example",
}))

// Wrap routeSubmission so tests can observe calls and force failures while
// still exercising the real store by default.
const routing = vi.hoisted(() => ({
  routeSubmission: vi.fn<(input: RouteSubmissionInput) => ContactSubmission>(),
  actual: undefined as typeof import("@/lib/contact-routing") | undefined,
}))

vi.mock("@/lib/contact-routing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/contact-routing")>()
  routing.actual = actual
  return {
    ...actual,
    routeSubmission: (...args: Parameters<typeof actual.routeSubmission>) =>
      routing.routeSubmission(...args),
  }
})

let ipCounter = 0

function post(body: unknown, ip?: string) {
  return POST(
    new Request("http://localhost/api/contact", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": ip ?? `10.9.9.${++ipCounter}`,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  )
}

const validBody = {
  name: "Ada Lovelace",
  email: "ada@lab.edu",
  topic: "product",
  subject: "Export question",
  message: "How do I export a lab session to CSV?",
  // Comfortably past the time-trap minimum so clean submissions stay "pass".
  renderedAt: new Date(Date.now() - 30_000).toISOString(),
}

beforeEach(() => {
  sendEmail.mockReset()
  sendEmail.mockResolvedValue("sent")
  clearContactSubmissions()
  routing.routeSubmission.mockReset()
  routing.routeSubmission.mockImplementation((input) => routing.actual!.routeSubmission(input))
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("POST /api/contact", () => {
  it("rejects malformed JSON", async () => {
    const response = await post("{not json")
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false })
  })

  it("rejects invalid payloads with field errors", async () => {
    const response = await post({ name: "", email: "bad" })
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.ok).toBe(false)
    expect(data.errors.email).toBeTruthy()
    expect(data.errors.topic).toBeTruthy()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("rejects an unknown topic", async () => {
    const response = await post({ ...validBody, topic: "sales-ish" })
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.errors.topic).toBe("Please choose a topic.")
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("silently accepts honeypot submissions without emailing", async () => {
    const response = await post({ ...validBody, website: "http://spam.example" })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("emails the submission and acknowledges it with a reference id", async () => {
    const response = await post({ ...validBody, reference: "ORD-778" })
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(data.reference).toMatch(/^CT-[0-9A-F]{8}$/)

    expect(sendEmail).toHaveBeenCalledTimes(2)
    const message = sendEmail.mock.calls[0][0]
    expect(message.to).toBe("hello@spindle.example")
    expect(message.replyTo).toBe("ada@lab.edu")
    expect(message.subject).toBe("[Contact] Export question")
    expect(message.text).toContain("ada@lab.edu")
    expect(message.text).toContain("Topic: Product or technical question")
    expect(message.text).toContain("Reference: ORD-778")
    expect(message.text).toContain(`Ticket: ${data.reference}`)
  })

  it("sends an auto-reply to the submitter with html and text", async () => {
    const response = await post(validBody)
    expect(response.status).toBe(200)

    const autoReply = sendEmail.mock.calls[1][0]
    expect(autoReply.to).toBe("ada@lab.edu")
    expect(autoReply.subject).toBe("We received your message — Spindle")
    expect(autoReply.html).toContain("Ada Lovelace")
    expect(autoReply.text).toContain("Ada Lovelace")
    expect(autoReply.text).toContain("two business days")
  })

  it("still acknowledges when the auto-reply fails", async () => {
    sendEmail.mockImplementation((message: { to: string }) =>
      message.to === "ada@lab.edu"
        ? Promise.reject(new Error("auto-reply down"))
        : Promise.resolve("sent"),
    )
    const response = await post(validBody)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true })
    expect(sendEmail).toHaveBeenCalledTimes(2)
  })

  it("still acknowledges when email is unconfigured", async () => {
    sendEmail.mockResolvedValue("unconfigured")
    const response = await post(validBody)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true })
  })

  it("returns a retryable failure when delivery throws", async () => {
    sendEmail.mockRejectedValue(new Error("resend down"))
    const response = await post(validBody)
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ ok: false })
  })

  it("rate limits repeated submissions from one IP", async () => {
    const ip = "203.0.113.7"
    for (let i = 0; i < 5; i++) {
      const response = await post(validBody, ip)
      expect(response.status).toBe(200)
    }
    const blocked = await post(validBody, ip)
    expect(blocked.status).toBe(429)
  })

  describe("spam protection", () => {
    function spamWarnCalls(warn: ReturnType<typeof vi.spyOn>) {
      return (warn.mock.calls as unknown[][]).filter((call) => {
        const context = call[0] as { event?: unknown } | null | undefined
        return typeof context?.event === "string" && context.event.startsWith("contact.spam")
      })
    }

    it("delivers a clean submission without spam warnings", async () => {
      const warn = vi.spyOn(logger, "warn")
      const response = await post({
        ...validBody,
        email: "clean-pass@example.com",
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ ok: true })
      expect(sendEmail).toHaveBeenCalledTimes(2)
      expect(spamWarnCalls(warn)).toHaveLength(0)
    })

    it("flags a too-fast submission as suspicious but still delivers", async () => {
      const warn = vi.spyOn(logger, "warn")
      const response = await post({
        ...validBody,
        email: "too-fast@example.com",
        renderedAt: new Date().toISOString(),
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ ok: true })
      expect(sendEmail).toHaveBeenCalledTimes(2)

      const calls = spamWarnCalls(warn)
      expect(calls).toHaveLength(1)
      expect(calls[0][0]).toMatchObject({
        event: "contact.spam_suspicious",
        signals: expect.arrayContaining(["trap-too-fast"]),
      })
    })

    it("flags a missing renderedAt as suspicious but still delivers", async () => {
      const warn = vi.spyOn(logger, "warn")
      const { renderedAt: _omit, ...body } = { ...validBody, email: "no-trap@example.com" }
      const response = await post(body)
      expect(response.status).toBe(200)
      expect(sendEmail).toHaveBeenCalledTimes(2)
      expect(spamWarnCalls(warn)[0]?.[0]).toMatchObject({
        event: "contact.spam_suspicious",
        signals: expect.arrayContaining(["trap-missing"]),
      })
    })

    it("silently drops obvious spam without emailing", async () => {
      const warn = vi.spyOn(logger, "warn")
      const response = await post({
        ...validBody,
        email: "obvious-spam@example.com",
        message: `Buy now ${"x".repeat(20)} cheap`,
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ ok: true })
      expect(sendEmail).not.toHaveBeenCalled()

      const calls = spamWarnCalls(warn)
      expect(calls).toHaveLength(1)
      expect(calls[0][0]).toMatchObject({
        event: "contact.spam_dropped",
        signals: expect.arrayContaining(["repeated-chars"]),
      })
    })

    it("flags submissions beyond the daily email velocity but still delivers", async () => {
      const warn = vi.spyOn(logger, "warn")
      const email = "velocity@example.com"
      for (let i = 0; i < 3; i++) {
        const response = await post({ ...validBody, email }, `198.51.100.${i + 1}`)
        expect(response.status).toBe(200)
      }
      warn.mockClear()

      const fourth = await post({ ...validBody, email }, "198.51.100.99")
      expect(fourth.status).toBe(200)
      expect(await fourth.json()).toMatchObject({ ok: true })
      // Suspicious ≠ blocked: the message is still delivered.
      expect(sendEmail).toHaveBeenCalled()
      expect(spamWarnCalls(warn)[0]?.[0]).toMatchObject({
        event: "contact.spam_suspicious",
        signals: expect.arrayContaining(["velocity"]),
      })
    })
  })

  describe("inbox recording", () => {
    it("records a clean submission under the ticket reference id", async () => {
      // Unique email: the per-email daily velocity limiter is module-level and
      // shared across tests, so reusing validBody's address would flag this
      // submission as suspicious.
      const response = await post({
        ...validBody,
        email: "clean-inbox@example.com",
        reference: "ORD-9",
      })
      expect(response.status).toBe(200)
      const data = await response.json()

      const { items } = listSubmissions()
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({
        id: data.reference,
        name: "Ada Lovelace",
        email: "clean-inbox@example.com",
        topic: "product",
        subject: "Export question",
        reference: "ORD-9",
        routedTo: "support",
        status: "new",
      })
    })

    it("records suspicious submissions with status spam and signal codes", async () => {
      const response = await post({
        ...validBody,
        email: "flagged@example.com",
        renderedAt: new Date().toISOString(), // too fast → suspicious
      })
      expect(response.status).toBe(200)

      const { items } = listSubmissions()
      expect(items).toHaveLength(1)
      expect(items[0].status).toBe("spam")
      expect(items[0].spamSignals).toContain("trap-too-fast")
      // Still delivered: the inbox record must not change email behavior.
      expect(sendEmail).toHaveBeenCalledTimes(2)
    })

    it("records dropped spam submissions without emailing", async () => {
      const response = await post({
        ...validBody,
        email: "drop-me@example.com",
        message: `Buy now ${"x".repeat(20)} cheap`,
      })
      expect(response.status).toBe(200)
      expect(sendEmail).not.toHaveBeenCalled()

      const { items } = listSubmissions()
      expect(items).toHaveLength(1)
      expect(items[0].status).toBe("spam")
      expect(items[0].spamSignals).toContain("repeated-chars")
    })

    it("does not record honeypot or invalid submissions", async () => {
      await post({ ...validBody, website: "http://spam.example" })
      await post({ name: "" })
      expect(listSubmissions().total).toBe(0)
    })

    it("still returns success when the store throws", async () => {
      routing.routeSubmission.mockImplementation(() => {
        throw new Error("store down")
      })
      const response = await post(validBody)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ ok: true })
      expect(sendEmail).toHaveBeenCalledTimes(2)
    })
  })
})
