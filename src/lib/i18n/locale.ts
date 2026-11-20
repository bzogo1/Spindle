/**
 * Locale detection and persistence.
 *
 * Precedence: an explicit stored override (localStorage, then the
 * `spindle_locale` cookie) wins over the browser's `navigator.language`,
 * which is matched against the supported locales by primary subtag
 * (`uk-UA` → `uk`). Anything unrecognized falls back to `en`.
 *
 * `detectLocale()` is client-only and SSR-safe (returns `en` without a
 * `window`); `resolveLocale()` is the pure core and takes its inputs so it
 * can be unit-tested without stubbing globals.
 */

export const LOCALE_STORAGE_KEY = "spindle_locale"
export const LOCALE_COOKIE = "spindle_locale"
/** 1 year, in seconds. */
export const LOCALE_MAX_AGE = 60 * 60 * 24 * 365
export const LOCALE_CHANGE_EVENT = "spindle:locale-change"

export const SUPPORTED_LOCALES = ["en", "uk"] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]

export const DEFAULT_LOCALE: Locale = "en"

/** Native-language names shown in the switcher. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  uk: "Українська",
}

/**
 * Pre-paint boot script, inlined into <head> by the route-group layouts
 * (same pattern as SITE_THEME_SCRIPT). Resolves the locale from
 * localStorage → cookie → navigator.language and sets
 * `document.documentElement.lang` before first paint, so uk users never
 * see `lang="en"` and the browser doesn't mispronounce the page.
 *
 * Self-contained on purpose: only constant key names and the supported-
 * locale list are interpolated — no user data reaches the script, so it
 * is XSS-safe. Unknown/missing values leave `en`.
 */
export const LOCALE_BOOT_SCRIPT = `(function () {
  try {
    var stored = null;
    try { stored = localStorage.getItem('${LOCALE_STORAGE_KEY}'); } catch (e) {}
    if (!stored) {
      var match = document.cookie.match(/(?:^|; )${LOCALE_COOKIE}=([^;]*)/);
      if (match) {
        try { stored = decodeURIComponent(match[1]); } catch (e) { stored = match[1]; }
      }
    }
    var tag = stored || (typeof navigator !== 'undefined' ? navigator.language : '') || '';
    var primary = String(tag).toLowerCase().split(/[-_]/)[0];
    var supported = ${JSON.stringify(SUPPORTED_LOCALES)};
    document.documentElement.lang = supported.indexOf(primary) !== -1 ? primary : '${DEFAULT_LOCALE}';
  } catch (e) {
    // Storage/cookie/navigator can be unavailable; keep the server-rendered lang.
  }
})();`

/** Maps a BCP-47-ish tag (`uk-UA`, `en`) to a supported locale, or null. */
export function matchLocale(value: string | null | undefined): Locale | null {
  if (!value) return null
  const primary = value.trim().toLowerCase().split(/[-_]/)[0]
  return (SUPPORTED_LOCALES as readonly string[]).includes(primary) ? (primary as Locale) : null
}

/**
 * Pure resolution: stored override → navigator language → default.
 * Pass `stored: null`/`navigatorLanguage: null` to model "absent".
 */
export function resolveLocale(options?: {
  stored?: string | null
  navigatorLanguage?: string | null
}): Locale {
  return matchLocale(options?.stored) ?? matchLocale(options?.navigatorLanguage) ?? DEFAULT_LOCALE
}

function readCookieLocale(): string | null {
  if (typeof document === "undefined") return null
  const entry = document.cookie.split("; ").find((row) => row.startsWith(`${LOCALE_COOKIE}=`))
  if (!entry) return null
  try {
    return decodeURIComponent(entry.slice(LOCALE_COOKIE.length + 1))
  } catch {
    return entry.slice(LOCALE_COOKIE.length + 1)
  }
}

/** Reads the stored override: localStorage first, then the cookie. */
export function readStoredLocale(): string | null {
  if (typeof window === "undefined") return null
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY)
    if (stored) return stored
  } catch {
    // Storage can be unavailable (private mode); fall through to the cookie.
  }
  return readCookieLocale()
}

/** Client-side detection; safe to call during SSR (returns `en`). */
export function detectLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE
  const navigatorLanguage = typeof navigator !== "undefined" ? navigator.language : null
  return resolveLocale({ stored: readStoredLocale(), navigatorLanguage })
}

/** Persists the choice to localStorage + cookie and notifies listeners. */
export function persistLocale(locale: Locale) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // Storage can be unavailable; the cookie below still carries the choice.
  }
  const secure = window.location.protocol === "https:" ? "; Secure" : ""
  document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(locale)}; Path=/; Max-Age=${LOCALE_MAX_AGE}; SameSite=Lax${secure}`
  window.dispatchEvent(new Event(LOCALE_CHANGE_EVENT))
}
