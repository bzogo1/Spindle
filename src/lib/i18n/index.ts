import { en, type MessageKey } from "./en"
import { uk } from "./uk"
import type { Locale } from "./locale"

export type { Locale, MessageKey }

/**
 * Registered dictionaries. `en` is the fallback locale: every lookup tries
 * the active locale first and falls back to English so a missing key in a
 * partial locale never renders a raw key to the user.
 */
export const dictionaries: Record<Locale, Record<MessageKey, string>> = {
  en,
  uk,
}

/**
 * Interpolation parameters. Values are coerced with `String()`; missing or
 * undefined params leave the `{placeholder}` untouched so the gap stays
 * visible instead of rendering "undefined".
 */
export type InterpolationParams = Record<string, string | number | undefined>

const PARAM_PATTERN = /\{(\w+)\}/g

/**
 * Looks up `key` in `locale`'s dictionary, falling back to English, then to
 * the key itself. `params` substitutes `{name}`-style placeholders.
 */
export function t(
  locale: Locale | string,
  key: MessageKey | (string & {}),
  params?: InterpolationParams,
): string {
  const dictionary = Object.prototype.hasOwnProperty.call(dictionaries, locale)
    ? dictionaries[locale as Locale]
    : undefined
  // `||` (not `??`) so an empty-string translation counts as missing and
  // falls back to English — the dictionary contract is "no blank chrome".
  const template = (dictionary?.[key as MessageKey] || en[key as MessageKey] || key) as string
  if (!params) return template
  return template.replace(PARAM_PATTERN, (match: string, name: string) => {
    const value = params[name]
    return value === undefined || value === null ? match : String(value)
  })
}

/** Convenience wrapper: `translate(locale)` returns a bound `t()`. */
export function translate(locale: Locale) {
  return (key: MessageKey | (string & {}), params?: InterpolationParams) => t(locale, key, params)
}
