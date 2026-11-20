import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ReferralShareButtons } from "./referral-share-buttons"

const CODE = "SPN-ABCD-EFGH"

beforeEach(() => {
  vi.unstubAllGlobals()
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
})

describe("ReferralShareButtons", () => {
  it("renders platform share links carrying the referral code", async () => {
    render(<ReferralShareButtons code={CODE} />)

    const x = screen.getByRole("link", { name: /Post on X/ })
    expect(x).toHaveAttribute("target", "_blank")
    expect(decodeURIComponent(x.getAttribute("href")!)).toContain(`/r/${CODE}`)

    expect(screen.getByRole("link", { name: /Share on LinkedIn/ })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Share on Facebook/ })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Share on WhatsApp/ })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Share on Telegram/ })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Send by email/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument()
  })

  it("uses a provided shareUrl verbatim", () => {
    const shareUrl = "https://spindle.app/r/SPN-CUSTOM-1234?utm_source=referral"
    render(<ReferralShareButtons code={CODE} shareUrl={shareUrl} />)

    const x = screen.getByRole("link", { name: /Post on X/ })
    expect(decodeURIComponent(x.getAttribute("href")!)).toContain(shareUrl)
  })

  it("tracks share clicks against the referral code", async () => {
    const user = userEvent.setup()
    const fetchMock = vi.mocked(fetch)
    render(<ReferralShareButtons code={CODE} />)

    await user.click(screen.getByRole("link", { name: /Share on WhatsApp/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [endpoint, init] = fetchMock.mock.calls[0]!
    expect(endpoint).toBe("/api/share/track")
    expect(JSON.parse(String(init?.body))).toEqual({ platform: "whatsapp", code: CODE })
  })
})
