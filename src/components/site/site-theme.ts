/* Site theme — shared by the (site) and (auth) layouts.
 *
 * Storage key: `spindle-site-theme`. Values: "light" | "dark" | "system".
 * A missing or unrecognized value means "dark" — the site's historical
 * appearance — so users with no stored preference see no change. Only an
 * explicit "system" choice follows prefers-color-scheme (and live OS
 * changes). This is deliberately separate from
 * `spindle-app-theme` (app shell). The (changelog) layout and its theme
 * toggle share this key so the preference survives navigation between the
 * changelog and the rest of the site (its legacy `changelog-theme` key is
 * only read as a one-time fallback).
 *
 * SITE_THEME_SCRIPT is inlined into <head> by both layouts so the `.dark`
 * class lands on <html> before first paint — no flash of the wrong theme.
 */

export const SITE_THEME_KEY = "spindle-site-theme"
export const SITE_THEME_EVENT = "spindle-site-theme-change"

export type SiteThemeMode = "light" | "dark" | "system"

export const SITE_THEME_MODES: SiteThemeMode[] = ["light", "dark", "system"]

export const SITE_THEME_SCRIPT = `(function () {
  try {
    var saved = localStorage.getItem('${SITE_THEME_KEY}');
    // No stored preference keeps today's dark appearance; only an explicit
    // "system" follows the OS, and "light"/"dark" are absolute.
    var dark = true;
    if (saved === 'light') {
      dark = false;
    } else if (saved === 'system') {
      dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    document.documentElement.classList.toggle('dark', dark);
  } catch (e) {
    // Storage/matchMedia can be unavailable; stay on the default (dark).
  }
})();`

export function readSiteThemeMode(): SiteThemeMode {
  try {
    const saved = localStorage.getItem(SITE_THEME_KEY)
    if (saved === "light" || saved === "dark" || saved === "system") return saved
  } catch {
    // Storage can be unavailable (private mode); fall through to dark.
  }
  return "dark"
}

export function siteSystemDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
}

export function siteThemeDark(mode: SiteThemeMode): boolean {
  return mode === "system" ? siteSystemDark() : mode === "dark"
}

export function applySiteTheme(mode: SiteThemeMode) {
  document.documentElement.classList.toggle("dark", siteThemeDark(mode))
  try {
    localStorage.setItem(SITE_THEME_KEY, mode)
  } catch {
    // Storage can be unavailable (private mode); the class still applies.
  }
  window.dispatchEvent(new Event(SITE_THEME_EVENT))
}
