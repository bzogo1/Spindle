import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { LanguageProvider } from "./language-provider"
import { LanguageSwitcher } from "./language-switcher"
import { LOCALE_COOKIE, LOCALE_STORAGE_KEY } from "@/lib/i18n/locale"

function clearStorage() {
  window.localStorage.clear()
  document.cookie = `${LOCALE_COOKIE}=; Path=/; Max-Age=0`
  document.documentElement.lang = "en"
}

beforeEach(clearStorage)
afterEach(clearStorage)

function renderSwitcher() {
  return render(
    <LanguageProvider>
      <LanguageSwitcher />
    </LanguageProvider>,
  )
}

describe("LanguageSwitcher", () => {
  it("renders an accessible select with all supported locales", async () => {
    renderSwitcher()

    const select = await screen.findByRole("combobox", { name: "Language" })
    expect(select).toHaveValue("en")
    expect(screen.getByRole("option", { name: "English" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Українська" })).toBeInTheDocument()
  })

  it("switches locale and persists the choice", async () => {
    const user = userEvent.setup()
    renderSwitcher()

    const select = await screen.findByRole("combobox", { name: "Language" })
    await user.selectOptions(select, "uk")

    await waitFor(() => expect(select).toHaveValue("uk"))
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("uk")
    expect(document.cookie).toContain(`${LOCALE_COOKIE}=uk`)
    expect(document.documentElement.lang).toBe("uk")
  })

  it("reflects a stored locale on mount", async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "uk")
    renderSwitcher()

    const select = await screen.findByRole("combobox", { name: "Мова" })
    await waitFor(() => expect(select).toHaveValue("uk"))
  })
})
