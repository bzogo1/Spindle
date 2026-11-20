import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ReferralShare } from "./referral-share"

const SITE_URL = "https://spindle.example"
const STORAGE_KEY = "spindle.referral-code"

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
})

describe("ReferralShare", () => {
  it("generates and persists a referral code, then builds the invite link", async () => {
    render(<ReferralShare siteUrl={SITE_URL} />)

    const input = screen.getByLabelText("Your referral link") as HTMLInputElement
    await waitFor(() => expect(input.value).not.toBe(""))

    expect(input.value).toMatch(/^https:\/\/spindle\.example\/r\/SPN-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    const code = input.value.split("/r/")[1]!
    expect(localStorage.getItem(STORAGE_KEY)).toBe(code)
  })

  it("reuses the stored code on remount", async () => {
    localStorage.setItem(STORAGE_KEY, "SPN-ABCD-EFGH")
    render(<ReferralShare siteUrl={SITE_URL} />)

    const input = screen.getByLabelText("Your referral link") as HTMLInputElement
    await waitFor(() => expect(input.value).toContain("/r/SPN-ABCD-EFGH"))
  })

  it("copies the link with the Clipboard API and announces it", async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })
    render(<ReferralShare siteUrl={SITE_URL} />)

    const input = screen.getByLabelText("Your referral link") as HTMLInputElement
    await waitFor(() => expect(input.value).not.toBe(""))

    await user.click(screen.getByRole("button", { name: "Copy link" }))

    await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument())
    expect(writeText).toHaveBeenCalledWith(input.value)
    expect(screen.getByRole("status")).toHaveTextContent("copied to clipboard")
  })

  it("falls back to execCommand when the Clipboard API is unavailable", async () => {
    const user = userEvent.setup()
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    })
    const execCommand = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, "execCommand", {
      value: execCommand,
      configurable: true,
    })
    render(<ReferralShare siteUrl={SITE_URL} />)

    const input = screen.getByLabelText("Your referral link") as HTMLInputElement
    await waitFor(() => expect(input.value).not.toBe(""))

    await user.click(screen.getByRole("button", { name: "Copy link" }))

    await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument())
    expect(execCommand).toHaveBeenCalledWith("copy")
  })

  it("reports a copy failure when every path fails", async () => {
    const user = userEvent.setup()
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    })
    // jsdom has no execCommand; an explicit stub keeps the fallback honest.
    const execCommand = vi.fn().mockReturnValue(false)
    Object.defineProperty(document, "execCommand", {
      value: execCommand,
      configurable: true,
    })
    render(<ReferralShare siteUrl={SITE_URL} />)

    const input = screen.getByLabelText("Your referral link") as HTMLInputElement
    await waitFor(() => expect(input.value).not.toBe(""))

    await user.click(screen.getByRole("button", { name: "Copy link" }))

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Copy failed" })).toBeInTheDocument(),
    )
    expect(screen.getByRole("status")).toHaveTextContent("copy it manually")
  })

  it("builds share intents carrying the referral link", async () => {
    render(<ReferralShare siteUrl={SITE_URL} />)

    const input = screen.getByLabelText("Your referral link") as HTMLInputElement
    await waitFor(() => expect(input.value).not.toBe(""))

    const x = screen.getByRole("link", { name: /Post on X/ })
    expect(x).toHaveAttribute("href", expect.stringContaining("twitter.com/intent/tweet"))
    expect(decodeURIComponent(x.getAttribute("href")!)).toContain(input.value)

    const linkedin = screen.getByRole("link", { name: /Share on LinkedIn/ })
    expect(linkedin.getAttribute("href")).toContain(encodeURIComponent(input.value))

    const email = screen.getByRole("link", { name: /Send by email/ })
    expect(email.getAttribute("href")).toContain("mailto:")
    expect(decodeURIComponent(email.getAttribute("href")!)).toContain(input.value)
  })

  it("builds WhatsApp, Telegram, and Facebook share intents", async () => {
    render(<ReferralShare siteUrl={SITE_URL} />)

    const input = screen.getByLabelText("Your referral link") as HTMLInputElement
    await waitFor(() => expect(input.value).not.toBe(""))

    const whatsapp = screen.getByRole("link", { name: /Share on WhatsApp/ })
    expect(whatsapp.getAttribute("href")).toContain("https://wa.me/?")
    expect(decodeURIComponent(whatsapp.getAttribute("href")!)).toContain(input.value)

    const telegram = screen.getByRole("link", { name: /Share on Telegram/ })
    expect(telegram.getAttribute("href")).toContain("https://t.me/share/url?")
    expect(decodeURIComponent(telegram.getAttribute("href")!)).toContain(input.value)

    const facebook = screen.getByRole("link", { name: /Share on Facebook/ })
    expect(facebook.getAttribute("href")).toContain("https://www.facebook.com/sharer/sharer.php?")
    expect(decodeURIComponent(facebook.getAttribute("href")!)).toContain(input.value)
  })

  it("reports share clicks to /api/share/track", async () => {
    const user = userEvent.setup()
    const fetchMock = vi.mocked(fetch)
    render(<ReferralShare siteUrl={SITE_URL} />)

    const input = screen.getByLabelText("Your referral link") as HTMLInputElement
    await waitFor(() => expect(input.value).not.toBe(""))
    const code = input.value.split("/r/")[1]!

    await user.click(screen.getByRole("link", { name: /Post on X/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [endpoint, init] = fetchMock.mock.calls[0]!
    expect(endpoint).toBe("/api/share/track")
    expect(init?.method).toBe("POST")
    expect(JSON.parse(String(init?.body))).toEqual({ platform: "x", code })
  })

  it("reports copy clicks to /api/share/track", async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })
    const fetchMock = vi.mocked(fetch)
    render(<ReferralShare siteUrl={SITE_URL} />)

    const input = screen.getByLabelText("Your referral link") as HTMLInputElement
    await waitFor(() => expect(input.value).not.toBe(""))

    await user.click(screen.getByRole("button", { name: "Copy link" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [, init] = fetchMock.mock.calls[0]!
    expect(JSON.parse(String(init?.body)).platform).toBe("copy")
  })

  it("hides the native share button when navigator.share is unavailable", async () => {
    render(<ReferralShare siteUrl={SITE_URL} />)
    await waitFor(() => expect(screen.getByLabelText("Your referral link")).not.toHaveValue(""))
    expect(screen.queryByRole("button", { name: /Share…/ })).not.toBeInTheDocument()
  })
})
