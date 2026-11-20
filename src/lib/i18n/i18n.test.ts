import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { dictionaries, t, translate } from "./index"
import {
  DEFAULT_LOCALE,
  LOCALE_BOOT_SCRIPT,
  LOCALE_COOKIE,
  LOCALE_STORAGE_KEY,
  detectLocale,
  matchLocale,
  persistLocale,
  readStoredLocale,
  resolveLocale,
} from "./locale"

function clearStorage() {
  window.localStorage.clear()
  document.cookie = `${LOCALE_COOKIE}=; Path=/; Max-Age=0`
  document.cookie = `${LOCALE_STORAGE_KEY}=; Path=/; Max-Age=0`
}

function stubNavigatorLanguage(value: string) {
  Object.defineProperty(window.navigator, "language", {
    value,
    configurable: true,
  })
}

beforeEach(() => {
  clearStorage()
  document.documentElement.lang = "en"
})

afterEach(() => {
  clearStorage()
})

describe("t()", () => {
  it("returns the active locale's translation", () => {
    expect(t("uk", "nav.product")).toBe("Продукт")
    expect(t("en", "nav.product")).toBe("Product")
  })

  it("falls back to English for an unsupported locale", () => {
    expect(t("de", "nav.product")).toBe("Product")
  })

  it("returns the key itself for unknown keys", () => {
    expect(t("en", "does.not.exist")).toBe("does.not.exist")
  })

  it("interpolates {name} params", () => {
    expect(t("en", "auth.welcomeBack", { name: "Ada" })).toBe("Welcome back, Ada")
    expect(t("uk", "auth.welcomeBack", { name: "Ada" })).toBe("З поверненням, Ada")
  })

  it("leaves placeholders untouched when params are missing", () => {
    expect(t("en", "auth.welcomeBack")).toBe("Welcome back, {name}")
    expect(t("en", "auth.welcomeBack", {})).toBe("Welcome back, {name}")
  })

  it("falls back to English when a translation is an empty string", () => {
    const ukDict = dictionaries.uk as Record<string, string>
    const original = ukDict["nav.blog"]
    ukDict["nav.blog"] = ""
    try {
      expect(t("uk", "nav.blog")).toBe("Blog")
    } finally {
      ukDict["nav.blog"] = original
    }
  })

  it("translate() binds the locale", () => {
    const ukT = translate("uk")
    expect(ukT("common.save")).toBe("Зберегти")
  })
})

describe("matchLocale / resolveLocale", () => {
  it("matches primary subtags case-insensitively", () => {
    expect(matchLocale("uk-UA")).toBe("uk")
    expect(matchLocale("EN-gb")).toBe("en")
    expect(matchLocale("uk_UA")).toBe("uk")
  })

  it("returns null for unsupported or empty input", () => {
    expect(matchLocale("de-DE")).toBeNull()
    expect(matchLocale("")).toBeNull()
    expect(matchLocale(null)).toBeNull()
    expect(matchLocale(undefined)).toBeNull()
  })

  it("prefers a stored override over navigator.language", () => {
    expect(resolveLocale({ stored: "uk", navigatorLanguage: "en-US" })).toBe("uk")
  })

  it("matches navigator.language when nothing is stored", () => {
    expect(resolveLocale({ navigatorLanguage: "uk-UA" })).toBe("uk")
    expect(resolveLocale({ navigatorLanguage: "pl-PL" })).toBe(DEFAULT_LOCALE)
  })

  it("falls back to the default locale", () => {
    expect(resolveLocale({})).toBe("en")
    expect(resolveLocale({ stored: "xx", navigatorLanguage: "yy" })).toBe("en")
  })
})

describe("detectLocale / persistence", () => {
  it("detects from localStorage before the cookie", () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "uk")
    document.cookie = `${LOCALE_COOKIE}=en; Path=/`
    expect(detectLocale()).toBe("uk")
    expect(readStoredLocale()).toBe("uk")
  })

  it("reads the cookie when localStorage is empty", () => {
    document.cookie = `${LOCALE_COOKIE}=uk; Path=/`
    expect(readStoredLocale()).toBe("uk")
    expect(detectLocale()).toBe("uk")
  })

  it("uses navigator.language when nothing is stored", () => {
    stubNavigatorLanguage("uk-UA")
    expect(detectLocale()).toBe("uk")
  })

  it("stored override beats navigator.language", () => {
    stubNavigatorLanguage("en-US")
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "uk")
    expect(detectLocale()).toBe("uk")
  })

  it("persistLocale writes localStorage and the cookie", () => {
    persistLocale("uk")
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("uk")
    expect(document.cookie).toContain(`${LOCALE_COOKIE}=uk`)
    expect(readStoredLocale()).toBe("uk")
  })
})

describe("LOCALE_BOOT_SCRIPT", () => {
  it("sets <html lang> from localStorage before paint", () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "uk")
    // The script is a self-contained IIFE string inlined into <head>.
    window.eval(LOCALE_BOOT_SCRIPT)
    expect(document.documentElement.lang).toBe("uk")
  })

  it("sets <html lang> from the cookie when localStorage is empty", () => {
    document.cookie = `${LOCALE_COOKIE}=uk; Path=/`
    window.eval(LOCALE_BOOT_SCRIPT)
    expect(document.documentElement.lang).toBe("uk")
  })

  it("keeps en for unsupported stored values", () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "de")
    window.eval(LOCALE_BOOT_SCRIPT)
    expect(document.documentElement.lang).toBe("en")
  })
})
