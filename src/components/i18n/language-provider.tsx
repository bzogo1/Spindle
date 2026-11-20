"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"

import {
  DEFAULT_LOCALE,
  LOCALE_CHANGE_EVENT,
  LOCALE_STORAGE_KEY,
  detectLocale,
  persistLocale,
  type Locale,
} from "@/lib/i18n/locale"
import { t as translateKey, type InterpolationParams, type MessageKey } from "@/lib/i18n"

export type LanguageContextValue = {
  locale: Locale
  setLocale: (locale: Locale) => void
  /** Bound `t()` for the active locale; see `src/lib/i18n`. */
  t: (key: MessageKey | (string & {}), params?: InterpolationParams) => string
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

type LanguageProviderProps = {
  children: React.ReactNode
  /**
   * Locale resolved on the server from the `spindle_locale` cookie, so the
   * first client render matches the SSR markup. Client detection in the
   * mount effect can still refine it (localStorage-only or navigator-based
   * choices the cookie doesn't know about).
   */
  initialLocale?: Locale
}

/**
 * Client-side i18n provider. Starts on `initialLocale` (or `en`) so the
 * markup matches the server, then resolves the real locale in an effect
 * (stored override → navigator.language → `en`) and keeps
 * `<html lang>` in sync. `LOCALE_BOOT_SCRIPT` (inlined by the layouts)
 * already set `<html lang>` pre-paint.
 *
 * Cross-tab sync: `setLocale` writes localStorage + cookie and dispatches
 * `LOCALE_CHANGE_EVENT`; other tabs pick it up via the `storage` event.
 * Cookie-only changes made outside `persistLocale` (e.g. by the server or
 * another tab that only touched the cookie) are not observable without
 * polling, so they are not synced live — the next full load picks them up.
 */
export function LanguageProvider({ children, initialLocale }: LanguageProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale ?? DEFAULT_LOCALE)

  useEffect(() => {
    setLocaleState(detectLocale())

    const onStorage = (event: StorageEvent) => {
      // `key === null` means storage.clear() — re-detect either way.
      if (event.key === null || event.key === LOCALE_STORAGE_KEY) {
        setLocaleState(detectLocale())
      }
    }
    const onChange = () => setLocaleState(detectLocale())
    window.addEventListener("storage", onStorage)
    window.addEventListener(LOCALE_CHANGE_EVENT, onChange)
    return () => {
      window.removeEventListener("storage", onStorage)
      window.removeEventListener(LOCALE_CHANGE_EVENT, onChange)
    }
  }, [])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    persistLocale(next)
  }, [])

  const value = useMemo<LanguageContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key, params) => translateKey(locale, key, params),
    }),
    [locale, setLocale],
  )

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext)
  if (!context) {
    throw new Error("useLanguage must be used within LanguageProvider")
  }
  return context
}
