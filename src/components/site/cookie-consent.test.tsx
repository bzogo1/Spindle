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

function stubPrivacySignal(value: boolean) {
  Object.defineProperty(window.navigator, "globalPrivacyControl", {
    value,
    configurable: true,
  })
}

beforeEach(() => {
  resetConsentCookie()
  stubPrivacySignal(false)
})

afterEach(() => {
  resetConsentCookie()
  stubPrivacySignal(false)
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

    await user.click(await screen.findByRole("button", { name: "Customize" }))

    expect(await screen.findByRole("dialog")).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: /^Essential/ })).toBeDisabled()

    const analytics = screen.getByRole("switch", { name: /^Analytics/ })
    expect(analytics).not.toBeChecked()
    await user.click(analytics)

    expect(screen.getByRole("switch", { name: /^Session replay/ })).not.toBeChecked()
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

  it("lists every registry key in the dialog's policy table", async () => {
    const user = userEvent.setup()
    render(<CookieConsent />)

    await user.click(await screen.findByRole("button", { name: "Customize" }))

    const table = await screen.findByRole("table")
    expect(table).toHaveTextContent("spindle_consent")
    expect(table).toHaveTextContent("spindle-site-theme")
    expect(table).toHaveTextContent("sentryReplaySession")
    expect(table).toHaveTextContent("Lifetime")
  })

  it("opens the settings dialog for a returning visitor without a banner", async () => {
    const user = userEvent.setup()
    render(<CookieConsent />)

    await user.click(await screen.findByRole("button", { name: "Accept all" }))
    expect(screen.queryByRole("region", { name: "Cookies on Spindle" })).not.toBeInTheDocument()

    window.dispatchEvent(new Event("spindle:open-cookie-settings"))

    expect(await screen.findByRole("dialog")).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: /^Analytics/ })).toBeChecked()
  })

  it("records essential-only consent when the browser sends Global Privacy Control", async () => {
    stubPrivacySignal(true)
    render(<CookieConsent />)

    await waitFor(() => {
      expect(readConsent()).toMatchObject({
        decided: true,
        analytics: false,
        replay: false,
      })
    })
    expect(screen.queryByRole("region", { name: "Cookies on Spindle" })).not.toBeInTheDocument()
  })
})
