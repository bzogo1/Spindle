"use client"

import { useEffect, useState } from "react"

import { APP_THEME_KEY } from "./app-theme"

const THEME_EVENT = "spindle-app-theme-change"

function readDark() {
  return document.documentElement.classList.contains("dark")
}

function readStoredTheme(): string | null {
  try {
    return window.localStorage.getItem(APP_THEME_KEY)
  } catch {
    // Storage can be unavailable (private mode).
    return null
  }
}

/**
 * Light/dark theme for the app shell. The `(app)` layout applies the saved
 * theme before paint; this hook tracks the current state so every control
 * (topbar button, account menu item) flips the same theme. Instances sync
 * through a window event because each component owns its own hook state.
 */
export function useAppTheme() {
  const [dark, setDark] = useState(true)

  useEffect(() => {
    setDark(readDark())
    const sync = () => setDark(readDark())
    // Cross-tab sync: a `storage` event fires in this tab when another tab
    // writes the theme key, but it does not touch this document's `.dark`
    // class — so the stored value must be applied here, not re-read from the
    // DOM. Every mounted hook instance has its own listener, so each one
    // updates independently; no THEME_EVENT dispatch is needed.
    const onStorage = (event: StorageEvent) => {
      // Ignore writes to unrelated keys; `key === null` means localStorage
      // was cleared, which resets to the default (dark) like the pre-paint
      // script. Synthetic events without a `key` (tests) still sync.
      if (event.key !== undefined && event.key !== null && event.key !== APP_THEME_KEY) return
      // `newValue` is only present on real StorageEvents; fall back to
      // localStorage for synthetic events. Match the pre-paint script:
      // only an explicit "light" opts out of dark.
      const saved = event.newValue !== undefined ? event.newValue : readStoredTheme()
      const darkTheme = saved !== "light"
      if (readDark() !== darkTheme) {
        document.documentElement.classList.toggle("dark", darkTheme)
      }
      setDark(darkTheme)
    }
    window.addEventListener(THEME_EVENT, sync)
    window.addEventListener("storage", onStorage)
    return () => {
      window.removeEventListener(THEME_EVENT, sync)
      window.removeEventListener("storage", onStorage)
    }
  }, [])

  function set(darkTheme: boolean) {
    if (readDark() === darkTheme) return
    document.documentElement.classList.toggle("dark", darkTheme)
    try {
      localStorage.setItem(APP_THEME_KEY, darkTheme ? "dark" : "light")
    } catch {
      // Storage can be unavailable (private mode); the class still applies.
    }
    window.dispatchEvent(new Event(THEME_EVENT))
  }

  function toggle() {
    set(!readDark())
  }

  return { dark, toggle, set }
}
