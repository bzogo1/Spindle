import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CookieConsent } from "@/components/site/cookie-consent"
import { CONSENT_COOKIE, readConsent } from "@/lib/consent"

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}))

function resetConsentCookie() {
  document.cookie = `${CONSENT_COOKIE}=; Path=/; Max-Age=0`
}

beforeEach(() => {
  resetConsentCookie()
})

afterEach(() => {
  resetConsentCookie()
})

describe("CookieConsent", () => {
  it("rejects optional storage from the first-visit banner", async () => {
    const user = userEvent.setup()
    render(<CookieConsent />)

    await user.click(await screen.findByRole("button", { name: "Reject non-essential" }))

    expect(readConsent()).toMatchObject({
      decided: true,
      analytics: false,
      replay: false,
    })
    expect(screen.queryByRole("region", { name: "Cookies on Spindle" })).not.toBeInTheDocument()
  })

  it("saves individual categories from the settings dialog", async () => {
    const user = userEvent.setup()
    render(<CookieConsent />)

    await user.click(await screen.findByRole("button", { name: "Cookie settings" }))

    expect(await screen.findByRole("dialog")).toBeInTheDocument()
    expect(screen.getByRole("checkbox", { name: /^Essential/ })).toBeDisabled()

    const analytics = screen.getByRole("checkbox", { name: /^Analytics/ })
    expect(analytics).not.toBeChecked()
    await user.click(analytics)

    expect(screen.getByRole("checkbox", { name: /^Session replay/ })).not.toBeChecked()
    await user.click(screen.getByRole("button", { name: "Save choices" }))

    expect(readConsent()).toMatchObject({
      decided: true,
      analytics: true,
      replay: false,
    })
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    })
  })

  it("opens the settings dialog for a returning visitor without a banner", async () => {
    const user = userEvent.setup()
    render(<CookieConsent />)

    await user.click(await screen.findByRole("button", { name: "Accept all" }))
    expect(screen.queryByRole("region", { name: "Cookies on Spindle" })).not.toBeInTheDocument()

    window.dispatchEvent(new Event("spindle:open-cookie-settings"))

    expect(await screen.findByRole("dialog")).toBeInTheDocument()
    expect(screen.getByRole("checkbox", { name: /^Analytics/ })).toBeChecked()
  })
})
