import { beforeEach, describe, expect, it, vi } from "vitest"

import { clearNewsletterStore, listSubscribers, stats } from "@/lib/newsletter-store"

import { POST } from "./route"

const sendEmail = vi.fn()

vi.mock("@/lib/email", () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}))

let ipCounter = 0

function post(body: unknown, ip?: string) {
  return POST(
    new Request("http://localhost/api/newsletter", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": ip ?? `10.8.8.${++ipCounter}`,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  sendEmail.mockReset()
  sendEmail.mockResolvedValue("sent")
  clearNewsletterStore()
})

describe("POST /api/newsletter", () => {
  it("rejects malformed JSON", async () => {
    const response = await post("{oops")
    expect(response.status).toBe(400)
  })

  it("rejects invalid emails with field errors", async () => {
    const response = await post({ email: "not-an-email" })
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.ok).toBe(false)
    expect(data.errors.email).toBeTruthy()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("rejects submissions without consent", async () => {
    const response = await post({ email: "reader@lab.edu" })
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.errors.consent).toBeTruthy()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("silently accepts honeypot submissions without emailing", async () => {
    const response = await post({
      email: "bot@spam.example",
      website: "filled",
      consent: true,
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("sends a confirmation email to the subscriber", async () => {
    const response = await post({
      email: "reader@lab.edu",
      source: "site-footer",
      consent: true,
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true })

    expect(sendEmail).toHaveBeenCalledTimes(1)
    const message = sendEmail.mock.calls[0][0]
    expect(message.to).toBe("reader@lab.edu")
    expect(message.subject).toContain("Spindle")
  })

  it("records the subscriber in the newsletter store", async () => {
    const response = await post({
      email: "Reader@Lab.EDU",
      source: "site-footer",
      consent: true,
    })
    expect(response.status).toBe(200)

    const { items, total } = listSubscribers()
    expect(total).toBe(1)
    expect(items[0]).toMatchObject({
      email: "reader@lab.edu",
      source: "site-footer",
      status: "active",
    })
    expect(stats().subscribers.active).toBe(1)
  })

  it("records the subscriber even when email is unconfigured", async () => {
    sendEmail.mockResolvedValue("unconfigured")
    const response = await post({ email: "reader@lab.edu", consent: true })
    expect(response.status).toBe(200)
    expect(listSubscribers().total).toBe(1)
  })

  it("does not record honeypot or failed submissions", async () => {
    await post({ email: "bot@spam.example", website: "filled", consent: true })
    sendEmail.mockRejectedValueOnce(new Error("resend down"))
    await post({ email: "fail@lab.edu", consent: true })
    expect(listSubscribers().total).toBe(0)
  })

  it("acknowledges when email is unconfigured", async () => {
    sendEmail.mockResolvedValue("unconfigured")
    const response = await post({ email: "reader@lab.edu", consent: true })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true })
  })

  it("returns a retryable failure when delivery throws", async () => {
    sendEmail.mockRejectedValue(new Error("resend down"))
    const response = await post({ email: "reader@lab.edu", consent: true })
    expect(response.status).toBe(502)
  })

  it("rate limits repeated attempts from one IP", async () => {
    const ip = "198.51.100.9"
    for (let i = 0; i < 10; i++) {
      const response = await post({ email: `reader${i}@lab.edu`, consent: true }, ip)
      expect(response.status).toBe(200)
    }
    const blocked = await post({ email: "reader10@lab.edu", consent: true }, ip)
    expect(blocked.status).toBe(429)
  })
})
