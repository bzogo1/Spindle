import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  CONSENT_CHANGED_EVENT,
  CONSENT_COOKIE,
  CONSENT_VERSION,
  acceptAllChoices,
  clearConsent,
  consentCategories,
  consentCategoryLabel,
  cookieRegistry,
  essentialOnlyChoices,
  hasConsent,
  hasPrivacySignal,
  onConsentChange,
  onOpenCookieSettings,
  openCookieSettings,
  readConsent,
  undecidedConsent,
  writeConsent,
} from "@/lib/consent"

function resetConsentCookie() {
  document.cookie = `${CONSENT_COOKIE}=; Path=/; Max-Age=0`
}

function setConsentCookie(value: string) {
  document.cookie = `${CONSENT_COOKIE}=${value}; Path=/`
}

beforeEach(() => {
  resetConsentCookie()
})

afterEach(() => {
  resetConsentCookie()
})

describe("cookie registry", () => {
  it("assigns every documented key to a category the banner offers", () => {
    const ids = consentCategories.map((category) => category.id)

    expect(new Set(ids).size).toBe(ids.length)

    for (const record of cookieRegistry) {
      expect(ids).toContain(record.category)
      expect(consentCategoryLabel(record.category)).not.toBe(record.category)
    }
  })

  it("lists each key once and keeps the consent cookie essential", () => {
    const keys = cookieRegistry.map((record) => record.key)

    expect(new Set(keys).size).toBe(keys.length)
    expect(cookieRegistry.find((record) => record.key === CONSENT_COOKIE)).toMatchObject({
      storage: "Cookie",
      category: "essential",
    })
  })

  it("marks only essential storage as required and keeps replay optional", () => {
    expect(
      consentCategories.filter((category) => category.required).map((category) => category.id),
    ).toEqual(["essential"])

    expect(cookieRegistry.find((record) => record.key === "sentryReplaySession")?.category).toBe(
      "replay",
    )
    expect(cookieRegistry.filter((record) => record.category === "analytics")).toEqual([])
  })
})

describe("consent store", () => {
  it("reads as undecided with only essential consent before a choice", () => {
    expect(readConsent()).toEqual(undecidedConsent())
    expect(readConsent().decided).toBe(false)
    expect(hasConsent("essential")).toBe(true)
    expect(hasConsent("analytics")).toBe(false)
    expect(hasConsent("replay")).toBe(false)
  })

  it("round-trips an accepted choice through the consent cookie", () => {
    const state = writeConsent(acceptAllChoices())

    expect(state.decided).toBe(true)
    expect(state.version).toBe(CONSENT_VERSION)
    expect(state.timestamp).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/))
    expect(document.cookie).toContain(`${CONSENT_COOKIE}=`)

    expect(readConsent()).toMatchObject({
      decided: true,
      version: CONSENT_VERSION,
      analytics: true,
      replay: true,
    })
    expect(hasConsent("analytics")).toBe(true)
    expect(hasConsent("replay")).toBe(true)
  })

  it("stores a rejection as essential-only storage", () => {
    writeConsent(essentialOnlyChoices())

    expect(readConsent()).toMatchObject({
      decided: true,
      analytics: false,
      replay: false,
    })
    expect(hasConsent("analytics")).toBe(false)
  })

  it("ignores a choice recorded under an older policy version", () => {
    setConsentCookie(
      encodeURIComponent(
        JSON.stringify({
          version: "0.9",
          timestamp: "2026-01-01T00:00:00.000Z",
          analytics: true,
          replay: true,
        }),
      ),
    )

    expect(readConsent().decided).toBe(false)
    expect(hasConsent("analytics")).toBe(false)
  })

  it("ignores malformed cookies instead of assuming consent", () => {
    setConsentCookie("not-json")
    expect(readConsent().decided).toBe(false)

    setConsentCookie(encodeURIComponent(JSON.stringify({ version: CONSENT_VERSION })))
    expect(readConsent().decided).toBe(false)

    setConsentCookie("%E0%A4%A")
    expect(readConsent().decided).toBe(false)
  })

  it("finds the consent cookie among other cookies", () => {
    document.cookie = "other_cookie=1; Path=/"
    document.cookie = "theme=dark; Path=/"
    writeConsent(acceptAllChoices())

    expect(readConsent()).toMatchObject({ decided: true, analytics: true, replay: true })
    expect(hasConsent("replay")).toBe(true)
  })

  it("decodes percent-encoded cookie payloads", () => {
    const payload = JSON.stringify({
      version: CONSENT_VERSION,
      timestamp: "2026-11-19T12:00:00.000Z",
      analytics: true,
      replay: false,
    })
    setConsentCookie(encodeURIComponent(payload))

    expect(readConsent()).toMatchObject({
      decided: true,
      analytics: true,
      replay: false,
    })
  })

  it("treats non-boolean flags and non-string timestamps as undecided-safe", () => {
    setConsentCookie(
      encodeURIComponent(
        JSON.stringify({
          version: CONSENT_VERSION,
          timestamp: "2026-11-19T12:00:00.000Z",
          analytics: "yes",
          replay: 1,
        }),
      ),
    )

    // Decided, but only strict `true` counts as consent.
    expect(readConsent()).toMatchObject({ decided: true, analytics: false, replay: false })
    expect(hasConsent("analytics")).toBe(false)

    setConsentCookie(
      encodeURIComponent(
        JSON.stringify({
          version: CONSENT_VERSION,
          timestamp: 1732012800000,
          analytics: true,
          replay: true,
        }),
      ),
    )
    expect(readConsent().decided).toBe(false)
  })

  it("clears the stored choice", () => {
    writeConsent(acceptAllChoices())
    clearConsent()

    expect(readConsent().decided).toBe(false)
    expect(hasConsent("analytics")).toBe(false)
  })
})

describe("privacy signals", () => {
  function stubSignal(key: "globalPrivacyControl" | "doNotTrack", value: unknown) {
    Object.defineProperty(window.navigator, key, { value, configurable: true })
  }

  afterEach(() => {
    stubSignal("globalPrivacyControl", undefined)
    stubSignal("doNotTrack", undefined)
  })

  it("is false without Global Privacy Control or Do Not Track", () => {
    stubSignal("globalPrivacyControl", false)
    stubSignal("doNotTrack", "0")
    expect(hasPrivacySignal()).toBe(false)
  })

  it("is true for Global Privacy Control or Do Not Track", () => {
    stubSignal("globalPrivacyControl", true)
    expect(hasPrivacySignal()).toBe(true)

    stubSignal("globalPrivacyControl", false)
    stubSignal("doNotTrack", "1")
    expect(hasPrivacySignal()).toBe(true)
  })
})

describe("consent events", () => {
  it("notifies subscribers when a choice is written", () => {
    const listener = vi.fn()
    const unsubscribe = onConsentChange(listener)

    const state = writeConsent(acceptAllChoices())
    expect(listener).toHaveBeenCalledWith(state)

    unsubscribe()
    writeConsent(essentialOnlyChoices())
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("falls back to the stored choice when an event carries no detail", () => {
    writeConsent(acceptAllChoices())

    const listener = vi.fn()
    const unsubscribe = onConsentChange(listener)

    window.dispatchEvent(new CustomEvent(CONSENT_CHANGED_EVENT))

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ decided: true, analytics: true }),
    )
    unsubscribe()
  })

  it("opens the settings dialog through a window event", () => {
    const listener = vi.fn()
    const unsubscribe = onOpenCookieSettings(listener)

    openCookieSettings()
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    openCookieSettings()
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
