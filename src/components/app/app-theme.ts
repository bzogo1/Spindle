export const APP_THEME_KEY = "spindle-app-theme"
export const APP_THEME_EVENT = "spindle-app-theme-change"

/**
 * Theme modes for the app shell. Values are stored verbatim in
 * `spindle-app-theme`; a missing or unrecognized value resolves to "dark",
 * matching the pre-paint default. Only an explicit "system" follows
 * `prefers-color-scheme` (and live OS changes via useAppTheme).
 */
export type AppThemeMode = "light" | "dark" | "system"

export const APP_THEME_MODES: AppThemeMode[] = ["light", "dark", "system"]

const DARK_QUERY = "(prefers-color-scheme: dark)"

export function isAppDarkTheme(): boolean {
  return document.documentElement.classList.contains("dark")
}

/** Reads the stored mode; anything missing/invalid means "dark". */
export function readAppThemeMode(): AppThemeMode {
  try {
    const saved = window.localStorage.getItem(APP_THEME_KEY)
    if (saved === "light" || saved === "dark" || saved === "system") return saved
  } catch {
    // Storage can be unavailable (private mode); fall through to dark.
  }
  return "dark"
}

export function appSystemDark(): boolean {
  return window.matchMedia(DARK_QUERY).matches
}

/** Resolves a mode to the effective dark flag (`system` follows the OS). */
export function appThemeDark(mode: AppThemeMode): boolean {
  return mode === "system" ? appSystemDark() : mode === "dark"
}

/**
 * Applies a theme mode: toggles `.dark` on <html>, persists the choice, and
 * notifies every mounted `useAppTheme` instance via APP_THEME_EVENT.
 */
export function applyAppTheme(mode: AppThemeMode) {
  document.documentElement.classList.toggle("dark", appThemeDark(mode))
  try {
    localStorage.setItem(APP_THEME_KEY, mode)
  } catch {
    // Storage can be unavailable (private mode); the class still applies.
  }
  window.dispatchEvent(new Event(APP_THEME_EVENT))
}

export function setAppDarkTheme(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark)
  try {
    localStorage.setItem(APP_THEME_KEY, dark ? "dark" : "light")
  } catch {
    // Storage can be unavailable (private mode); the class still applies.
  }
}
