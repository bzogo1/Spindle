import { beforeEach, describe, expect, it, vi } from "vitest"

const sendEmail = vi.fn()

vi.mock("@/lib/email", () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}))

import {
  authLink,
  sendAuthEmail,
  sendInvitationEmail,
  sendInvitationReminderEmail,
  sendSeriesEmail,
} from "./mailer"

beforeEach(() => {
  sendEmail.mockReset()
})

describe("authLink", () => {
  it("builds an absolute URL from a site-relative path", () => {
    expect(authLink("/verify-email?token=abc")).toMatch(/^https?:\/\//)
    expect(authLink("/verify-email?token=abc")).toContain("/verify-email?token=abc")
  })
})

describe("sendSeriesEmail", () => {
  it("forwards the message to sendEmail and returns the delivery", async () => {
    sendEmail.mockResolvedValue("sent")
    const result = await sendSeriesEmail({
      to: "ada@example.com",
      subject: "Welcome to Spindle",
      text: "hello",
      html: "<p>hello</p>",
    })
    expect(result).toBe("sent")
    expect(sendEmail).toHaveBeenCalledWith({
      to: "ada@example.com",
      subject: "Welcome to Spindle",
      text: "hello",
      html: "<p>hello</p>",
    })
  })

  it("omits html when not provided", async () => {
    sendEmail.mockResolvedValue("sent")
    await sendSeriesEmail({ to: "a@b.c", subject: "s", text: "t" })
    expect(sendEmail.mock.calls[0][0]).not.toHaveProperty("html")
  })

  it("returns unconfigured without throwing when Resend is not set up", async () => {
    sendEmail.mockResolvedValue("unconfigured")
    const result = await sendSeriesEmail({ to: "a@b.c", subject: "s", text: "t" })
    expect(result).toBe("unconfigured")
  })

  it("propagates provider errors", async () => {
    sendEmail.mockRejectedValue(new Error("resend down"))
    await expect(sendSeriesEmail({ to: "a@b.c", subject: "s", text: "t" })).rejects.toThrow(
      "resend down",
    )
  })
})

describe("sendInvitationEmail", () => {
  it("renders the team-invite template and sends through sendEmail", async () => {
    sendEmail.mockResolvedValue("sent")
    await sendInvitationEmail({
      to: "new@acme.dev",
      workspaceName: "Acme Research",
      inviterName: "Olivia Owner",
      role: "Admin",
      url: "https://spindle.example/invite?token=tok123",
      linkPath: "/invite?token=tok123",
    })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const message = sendEmail.mock.calls[0][0]
    expect(message.to).toBe("new@acme.dev")
    expect(message.subject).toContain("Olivia Owner")
    expect(message.subject).toContain("Acme Research")
    expect(message.text).toContain("https://spindle.example/invite?token=tok123")
    expect(message.html).toContain("Accept invitation")
  })

  it("returns the EmailDelivery result so callers can detect unconfigured", async () => {
    sendEmail.mockResolvedValue("sent")
    await expect(
      sendInvitationEmail({
        to: "new@acme.dev",
        workspaceName: "Acme Research",
        inviterName: "Olivia Owner",
        role: "Admin",
        url: "https://spindle.example/invite?token=tok123",
        linkPath: "/invite?token=tok123",
      }),
    ).resolves.toBe("sent")

    sendEmail.mockResolvedValue("unconfigured")
    await expect(
      sendInvitationEmail({
        to: "new@acme.dev",
        workspaceName: "Acme Research",
        inviterName: "Olivia Owner",
        role: "Admin",
        url: "https://spindle.example/invite?token=tok123",
        linkPath: "/invite?token=tok123",
      }),
    ).resolves.toBe("unconfigured")
  })
})

describe("sendInvitationReminderEmail", () => {
  it("renders the reminder template and sends through sendEmail", async () => {
    sendEmail.mockResolvedValue("sent")
    await sendInvitationReminderEmail({
      to: "new@acme.dev",
      workspaceName: "Acme Research",
      inviterName: "Olivia Owner",
      role: "Member",
      url: "https://spindle.example/invite?token=tok123",
      linkPath: "/invite?token=tok123",
      expiresIn: "20 hours",
    })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const message = sendEmail.mock.calls[0][0]
    expect(message.to).toBe("new@acme.dev")
    expect(message.subject).toContain("Reminder")
    expect(message.subject).toContain("Acme Research")
    expect(message.text).toContain("https://spindle.example/invite?token=tok123")
    expect(message.text).toContain("20 hours")
    expect(message.html).toContain("Accept invitation")
  })

  it("returns the EmailDelivery result so callers can detect unconfigured", async () => {
    sendEmail.mockResolvedValue("unconfigured")
    await expect(
      sendInvitationReminderEmail({
        to: "new@acme.dev",
        workspaceName: "Acme Research",
        inviterName: "Olivia Owner",
        url: "https://spindle.example/invite?token=tok123",
        linkPath: "/invite?token=tok123",
        expiresIn: "20 hours",
      }),
    ).resolves.toBe("unconfigured")
  })
})

describe("sendAuthEmail (existing export preserved)", () => {
  it("still sends through sendEmail", async () => {
    sendEmail.mockResolvedValue("sent")
    await sendAuthEmail({
      to: "a@b.c",
      subject: "s",
      text: "t",
      linkPath: "/x",
    })
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })
})
