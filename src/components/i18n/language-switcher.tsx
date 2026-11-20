"use client"

import { LOCALE_LABELS, SUPPORTED_LOCALES, type Locale } from "@/lib/i18n/locale"

import { useLanguage } from "./language-provider"

/**
 * Header language picker — a native <select> so it stays keyboard- and
 * screen-reader-accessible without extra JS. Styled with the shared
 * `.btn .btn--ghost .btn--sm` chrome; the `site-language-switcher` class is
 * a styling hook for header rules.
 */
export function LanguageSwitcher() {
  const { locale, setLocale, t } = useLanguage()

  return (
    <select
      className="site-language-switcher btn btn--ghost btn--sm"
      aria-label={t("common.language")}
      value={locale}
      onChange={(event) => setLocale(event.target.value as Locale)}
    >
      {SUPPORTED_LOCALES.map((option) => (
        <option key={option} value={option}>
          {LOCALE_LABELS[option]}
        </option>
      ))}
    </select>
  )
}
