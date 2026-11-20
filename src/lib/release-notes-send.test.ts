import { afterEach, describe, expect, it, vi } from "vitest"

import type { ChangelogRelease } from "@/lib/changelog"
import type { EmailMessage } from "@/lib/email"
import { clearUnsubscribeStore, unsubscribeAddress } from "@/lib/email-unsubscribe"

import { RELEASE_NOTES_MAX_RECIPIENTS, sendReleaseNotes } from "./release-notes-send"

const entry: ChangelogRelease = {
  slug: "x-1",
  version: "1.0",
  date: "2026-01-01",
  title: "First release",
  summary: "Summary.",
  tags: [],
  body: [{ type: "paragraph", text: "Hello." }],
}

afterEach(() => {
  clearUnsubscribeStore()
})

describe("sendReleaseNotes", () => {
  it("sends one email per recipient and counts outcomes", async () => {
    const deliver = vi.fn(async (_message: EmailMessage) => "sent" as const)
    const result = await sendReleaseNotes({
      entries: [entry],
      recipients: [{ email: "a@example.com", userName: "Ada" }, { email: "b@example.com" }],
      deps: { sendEmail: deliver },
    })
    expect(result).toEqual({ attempted: 2, suppressed: 0, sent: 2, unconfigured: 0, failed: 0 })
    expect(deliver).toHaveBeenCalledTimes(2)
    const first = deliver.mock.calls[0]![0] as EmailMessage
    expect(first.to).toBe("a@example.com")
    expect(first.subject).toBe("First release")
    expect(first.html).toContain("Hi Ada,")
  })

  it("embeds a per-recipient unsubscribe link in the HTML and text", async () => {
    const deliver = vi.fn(async (_message: EmailMessage) => "sent" as const)
    await sendReleaseNotes({
      entries: [entry],
      recipients: [{ email: "a@example.com" }],
      deps: { sendEmail: deliver },
    })
    const message = deliver.mock.calls[0]![0] as EmailMessage
    expect(message.html).toContain(">Unsubscribe</a>")
    expect(message.html).toContain("/unsubscribe?token=")
    expect(message.html).toContain("email=a%40example.com")
    expect(message.text).toContain("Unsubscribe: http")
    expect(message.text).toContain("/unsubscribe?token=")
  })

  it("skips opted-out recipients and counts them as suppressed", async () => {
    unsubscribeAddress("gone@example.com", "newsletter")
    unsubscribeAddress("mktg@example.com", "marketing")
    unsubscribeAddress("all@example.com", "all")
    const deliver = vi.fn(async (_message: EmailMessage) => "sent" as const)
    const result = await sendReleaseNotes({
      entries: [entry],
      recipients: [
        { email: "gone@example.com" },
        { email: "mktg@example.com" },
        { email: "all@example.com" },
        { email: "ok@example.com" },
      ],
      deps: { sendEmail: deliver },
    })
    expect(result).toEqual({ attempted: 1, suppressed: 3, sent: 1, unconfigured: 0, failed: 0 })
    expect(deliver).toHaveBeenCalledTimes(1)
    expect((deliver.mock.calls[0]![0] as EmailMessage).to).toBe("ok@example.com")
  })

  it("does not let suppressed recipients consume cap slots", async () => {
    unsubscribeAddress("optout@example.com", "newsletter")
    const deliver = vi.fn(async (_message: EmailMessage) => "sent" as const)
    const recipients = [
      { email: "optout@example.com" },
      ...Array.from({ length: RELEASE_NOTES_MAX_RECIPIENTS }, (_, i) => ({
        email: `u${i}@example.com`,
      })),
    ]
    const result = await sendReleaseNotes({
      entries: [entry],
      recipients,
      deps: { sendEmail: deliver },
    })
    expect(result.suppressed).toBe(1)
    expect(result.attempted).toBe(RELEASE_NOTES_MAX_RECIPIENTS)
    expect(deliver).toHaveBeenCalledTimes(RELEASE_NOTES_MAX_RECIPIENTS)
  })

  it("counts unconfigured outcomes honestly", async () => {
    const result = await sendReleaseNotes({
      entries: [entry],
      recipients: [{ email: "a@example.com" }],
      deps: { sendEmail: async () => "unconfigured" },
    })
    expect(result).toEqual({
      attempted: 1,
      suppressed: 0,
      sent: 0,
      unconfigured: 1,
      failed: 0,
    })
  })

  it("counts provider errors as failed without aborting the batch", async () => {
    const deliver = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("sent" as const)
    const result = await sendReleaseNotes({
      entries: [entry],
      recipients: [{ email: "a@example.com" }, { email: "b@example.com" }],
      deps: { sendEmail: deliver },
    })
    expect(result).toEqual({
      attempted: 2,
      suppressed: 0,
      sent: 1,
      unconfigured: 0,
      failed: 1,
    })
  })

  it("dedupes addresses and caps the batch", async () => {
    const deliver = vi.fn(async (_message: EmailMessage) => "sent" as const)
    const recipients = [
      { email: "A@example.com" },
      { email: "a@example.com" },
      ...Array.from({ length: RELEASE_NOTES_MAX_RECIPIENTS + 10 }, (_, i) => ({
        email: `u${i}@example.com`,
      })),
    ]
    const result = await sendReleaseNotes({
      entries: [entry],
      recipients,
      deps: { sendEmail: deliver },
    })
    expect(result.attempted).toBe(RELEASE_NOTES_MAX_RECIPIENTS)
    expect(deliver).toHaveBeenCalledTimes(RELEASE_NOTES_MAX_RECIPIENTS)
  })
})
