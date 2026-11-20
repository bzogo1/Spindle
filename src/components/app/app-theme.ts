export const APP_THEME_KEY = "spindle-app-theme"

export function isAppDarkTheme(): boolean {
  return document.documentElement.classList.contains("dark")
}

export function setAppDarkTheme(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark)
  try {
    localStorage.setItem(APP_THEME_KEY, dark ? "dark" : "light")
  } catch {
    // Storage can be unavailable (private mode); the class still applies.
  }
}
