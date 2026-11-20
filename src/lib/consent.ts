/**
 * Cookie and storage consent.
 *
 * One registry drives everything: the first-visit banner, the settings dialog,
 * and the table on /cookies. Runtime code (Sentry Replay, and analytics when it
 * lands) checks `hasConsent()` before it initialises anything, so nothing
 * non-essential starts before an affirmative choice.
 *
 * The choice lives in a first-party cookie (`spindle_consent`) that records the
 * policy version and the decision time. A version bump invalidates older
 * choices and asks again, because the categories may have changed.
 */

export const CONSENT_COOKIE = "spindle_consent"
export const CONSENT_VERSION = "1.0"
/** 180 days, in seconds. */
export const CONSENT_MAX_AGE = 60 * 60 * 24 * 180
export const CONSENT_CHANGED_EVENT = "spindle:consent-change"
export const COOKIE_SETTINGS_EVENT = "spindle:open-cookie-settings"
export const COOKIE_POLICY_PATH = "/cookies"

export type ConsentCategory = "essential" | "analytics" | "replay"
/** Categories the visitor can turn off; essential storage is always on. */
export type OptionalConsentCategory = Exclude<ConsentCategory, "essential">

export type ConsentCategoryInfo = {
  id: ConsentCategory
  label: string
  description: string
  /** Required categories render as a disabled, always-checked toggle. */
  required: boolean
}

export const consentCategories: readonly ConsentCategoryInfo[] = [
  {
    id: "essential",
    label: "Essential",
    description:
      "Keeps the site working: it remembers your cookie choice and your theme preference. These cannot be turned off.",
    required: true,
  },
  {
    id: "analytics",
    label: "Analytics",
    description:
      "Aggregate page and feature usage, so we can tell which pages and CTAs are useful. Off in this build, and off until you allow it.",
    required: false,
  },
  {
    id: "replay",
    label: "Session replay",
    description:
      "Masked session replay in Sentry — all text and media are hidden and search, chat, invite, and sign-in fields are blocked. Error reports and performance traces run without it.",
    required: false,
  },
]

/** A cookie or storage key the site can set, as shown on /cookies. */
export type CookieRecord = {
  key: string
  storage: "Cookie" | "Local storage" | "Session storage"
  purpose: string
  provider: string
  category: ConsentCategory
  lifetime: string
}

/** Must stay in step with the keys the site actually writes. */
export const cookieRegistry: readonly CookieRecord[] = [
  {
    key: CONSENT_COOKIE,
    storage: "Cookie",
    purpose:
      "Records which optional categories you allowed, the policy version you agreed to, and when you decided.",
    provider: "Spindle",
    category: "essential",
    lifetime: "180 days",
  },
  {
    key: "spindle-site-theme",
    storage: "Local storage",
    purpose:
      "Remembers whether the site (including the changelog) is drawn in the light or dark theme.",
    provider: "Spindle",
    category: "essential",
    lifetime: "Until you clear site data",
  },
  {
    key: "sentryReplaySession",
    storage: "Session storage",
    purpose:
      "Holds the current masked session replay, so a recording survives a page navigation. Written only after you allow session replay.",
    provider: "Sentry",
    category: "replay",
    lifetime: "Until the tab closes",
  },
]

export function consentCategoryLabel(category: ConsentCategory): string {
  return consentCategories.find((entry) => entry.id === category)?.label ?? category
}

export type ConsentChoices = Record<OptionalConsentCategory, boolean>

export type ConsentState = ConsentChoices & {
  version: string
  /** ISO timestamp of the decision, or null while undecided. */
  timestamp: string | null
  decided: boolean
}

export function essentialOnlyChoices(): ConsentChoices {
  return { analytics: false, replay: false }
}

export function acceptAllChoices(): ConsentChoices {
  return { analytics: true, replay: true }
}

export function undecidedConsent(): ConsentState {
  return {
    ...essentialOnlyChoices(),
    version: CONSENT_VERSION,
    timestamp: null,
    decided: false,
  }
}

function isBrowser() {
  return typeof document !== "undefined" && typeof window !== "undefined"
}

function readConsentCookie(): string | null {
  if (!isBrowser()) return null

  const prefix = `${CONSENT_COOKIE}=`
  const entry = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))

  if (!entry) return null

  try {
    return decodeURIComponent(entry.slice(prefix.length))
  } catch {
    return null
  }
}

/**
 * Reads the stored choice. Missing, malformed, or stale-version cookies read as
 * undecided, so the banner asks again rather than assuming consent.
 */
export function readConsent(): ConsentState {
  const raw = readConsentCookie()
  if (!raw) return undecidedConsent()

  try {
    const parsed = JSON.parse(raw) as Partial<ConsentState>
    if (parsed.version !== CONSENT_VERSION || typeof parsed.timestamp !== "string") {
      return undecidedConsent()
    }

    return {
      version: CONSENT_VERSION,
      timestamp: parsed.timestamp,
      decided: true,
      analytics: parsed.analytics === true,
      replay: parsed.replay === true,
    }
  } catch {
    return undecidedConsent()
  }
}

export function hasConsent(category: ConsentCategory): boolean {
  if (category === "essential") return true
  return readConsent()[category]
}

/** Stores the choice and notifies listeners in this tab. */
export function writeConsent(choices: ConsentChoices): ConsentState {
  const state: ConsentState = {
    analytics: choices.analytics === true,
    replay: choices.replay === true,
    version: CONSENT_VERSION,
    timestamp: new Date().toISOString(),
    decided: true,
  }

  if (isBrowser()) {
    const payload = JSON.stringify({
      version: state.version,
      timestamp: state.timestamp,
      analytics: state.analytics,
      replay: state.replay,
    })
    const secure = window.location.protocol === "https:" ? "; Secure" : ""

    document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(payload)}; Path=/; Max-Age=${CONSENT_MAX_AGE}; SameSite=Lax${secure}`
    window.dispatchEvent(new CustomEvent<ConsentState>(CONSENT_CHANGED_EVENT, { detail: state }))
  }

  return state
}

/** Removes the stored choice, as if the visitor had never decided. */
export function clearConsent(): void {
  if (!isBrowser()) return

  document.cookie = `${CONSENT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
  window.dispatchEvent(
    new CustomEvent<ConsentState>(CONSENT_CHANGED_EVENT, { detail: undecidedConsent() }),
  )
}

/** Subscribes to consent changes written in this tab. Returns an unsubscribe. */
export function onConsentChange(listener: (state: ConsentState) => void): () => void {
  if (!isBrowser()) return () => {}

  const handler = (event: Event) => {
    const detail = (event as CustomEvent<ConsentState>).detail
    listener(detail ?? readConsent())
  }

  window.addEventListener(CONSENT_CHANGED_EVENT, handler)
  return () => window.removeEventListener(CONSENT_CHANGED_EVENT, handler)
}

/**
 * True when the browser sends an opt-out privacy signal — Global Privacy
 * Control (`navigator.globalPrivacyControl`) or Do Not Track
 * (`navigator.doNotTrack`). Callers should treat this as a rejection of every
 * optional category, the same as the banner's "Reject non-essential".
 */
export function hasPrivacySignal(): boolean {
  if (!isBrowser()) return false

  const nav = window.navigator as Navigator & { globalPrivacyControl?: boolean }
  return nav.globalPrivacyControl === true || nav.doNotTrack === "1"
}

/** Asks the mounted consent UI to open its settings dialog. */
export function openCookieSettings(): void {
  if (!isBrowser()) return
  window.dispatchEvent(new Event(COOKIE_SETTINGS_EVENT))
}

export function onOpenCookieSettings(listener: () => void): () => void {
  if (!isBrowser()) return () => {}

  window.addEventListener(COOKIE_SETTINGS_EVENT, listener)
  return () => window.removeEventListener(COOKIE_SETTINGS_EVENT, listener)
}
