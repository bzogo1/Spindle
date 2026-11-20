import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { LanguageProvider, useLanguage } from "./language-provider"
import { LOCALE_COOKIE, LOCALE_STORAGE_KEY } from "@/lib/i18n/locale"

function Probe() {
  const { locale, setLocale, t } = useLanguage()
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="label">{t("nav.product")}</span>
      <span data-testid="welcome">{t("auth.welcomeBack", { name: "Ada" })}</span>
      <button type="button" onClick={() => setLocale("uk")}>
        switch-to-uk
      </button>
    </div>
  )
}

function clearStorage() {
  window.localStorage.clear()
  document.cookie = `${LOCALE_COOKIE}=; Path=/; Max-Age=0`
  document.documentElement.lang = "en"
}

beforeEach(clearStorage)
afterEach(clearStorage)

describe("LanguageProvider", () => {
  it("defaults to English and renders translations", async () => {
    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    )

    await waitFor(() => expect(screen.getByTestId("locale")).toHaveTextContent("en"))
    expect(screen.getByTestId("label")).toHaveTextContent("Product")
  })

  it("detects a stored locale on mount and syncs <html lang>", async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "uk")

    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    )

    await waitFor(() => expect(screen.getByTestId("locale")).toHaveTextContent("uk"))
    expect(screen.getByTestId("label")).toHaveTextContent("Продукт")
    expect(screen.getByTestId("welcome")).toHaveTextContent("З поверненням, Ada")
    expect(document.documentElement.lang).toBe("uk")
  })

  it("setLocale switches the locale, persists it, and updates <html lang>", async () => {
    const user = userEvent.setup()
    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    )

    await user.click(screen.getByRole("button", { name: "switch-to-uk" }))

    expect(screen.getByTestId("locale")).toHaveTextContent("uk")
    expect(screen.getByTestId("label")).toHaveTextContent("Продукт")
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("uk")
    expect(document.cookie).toContain(`${LOCALE_COOKIE}=uk`)
    expect(document.documentElement.lang).toBe("uk")
  })

  it("useLanguage throws outside the provider", () => {
    function Orphan() {
      useLanguage()
      return null
    }
    // Silence the expected React error boundary noise.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(() => render(<Orphan />)).toThrow("useLanguage must be used within LanguageProvider")
    spy.mockRestore()
  })
})
