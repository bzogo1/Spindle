"use client"

import { useEffect, useState } from "react"

import {
  APP_THEME_EVENT,
  APP_THEME_KEY,
  appThemeDark,
  applyAppTheme,
  readAppThemeMode,
  type AppThemeMode,
} from "./app-theme"

const DARK_QUERY = "(prefers-color-scheme: dark)"

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

function modeFromStored(saved: string | null): AppThemeMode {
  return saved === "light" || saved === "dark" || saved === "system" ? saved : "dark"
}

/**
 * Light/dark/system theme for the app shell. The `(app)` layout applies the
 * saved mode before paint; this hook tracks the current mode so every
 * control (topbar toggle, account menu picker) stays in sync. Instances
 * sync through a window event because each component owns its own hook
 * state. With mode "system" a matchMedia listener keeps the `.dark` class
 * following live OS changes; explicit light/dark ignores them.
 */
export function useAppTheme() {
  // Fixed initial state (not readAppThemeMode()) so the server-rendered
  // control matches the client's first render; the effect below syncs to
  // the real stored mode. "dark" matches the no-preference default applied
  // by the pre-paint script.
  const [mode, setModeState] = useState<AppThemeMode>("dark")
  const [dark, setDark] = useState(true)

  useEffect(() => {
    const sync = () => {
      const next = readAppThemeMode()
      const resolved = appThemeDark(next)
      const domDark = readDark()
      if (domDark !== resolved) {
        // The DOM and the stored mode disagree — the theme was changed
        // outside the app's controls (another script, a test, a browser
        // extension). Trust the DOM and surface it as an explicit mode so
        // the picker never shows a checked option that doesn't match.
        setModeState(domDark ? "dark" : "light")
        setDark(domDark)
        return
      }
      setModeState(next)
      setDark(resolved)
    }
    sync()

    const media = window.matchMedia(DARK_QUERY)
    const onMediaChange = () => {
      const next = readAppThemeMode()
      const resolved = appThemeDark(next)
      // While in system mode the OS is the source of truth, so the class
      // follows it live; explicit light/dark ignores OS changes.
      if (next === "system") {
        document.documentElement.classList.toggle("dark", resolved)
      }
      setModeState(next)
      setDark(resolved)
    }
    media.addEventListener("change", onMediaChange)

    // Cross-tab sync: a `storage` event fires in this tab when another tab
    // writes the theme key, but it does not touch this document's `.dark`
    // class — so the stored mode must be applied here, not re-read from the
    // DOM. Every mounted hook instance has its own listener, so each one
    // updates independently; no APP_THEME_EVENT dispatch is needed.
    const onStorage = (event: StorageEvent) => {
      // Ignore writes to unrelated keys; `key === null` means localStorage
      // was cleared, which resets to the default (dark) like the pre-paint
      // script. Synthetic events without a `key` (tests) still sync.
      if (event.key !== undefined && event.key !== null && event.key !== APP_THEME_KEY) return
      // `newValue` is only present on real StorageEvents; fall back to
      // localStorage for synthetic events.
      const next = modeFromStored(event.newValue !== undefined ? event.newValue : readStoredTheme())
      const resolved = appThemeDark(next)
      if (readDark() !== resolved) {
        document.documentElement.classList.toggle("dark", resolved)
      }
      setModeState(next)
      setDark(resolved)
    }
    window.addEventListener(APP_THEME_EVENT, sync)
    window.addEventListener("storage", onStorage)
    return () => {
      media.removeEventListener("change", onMediaChange)
      window.removeEventListener(APP_THEME_EVENT, sync)
      window.removeEventListener("storage", onStorage)
    }
  }, [])

  /** Sets an explicit light/dark theme (legacy boolean API). */
  function set(darkTheme: boolean) {
    const next: AppThemeMode = darkTheme ? "dark" : "light"
    // No-op when the effective state is already what was asked for, so a
    // tampered/invalid stored value is not rewritten by a redundant call.
    if (readAppThemeMode() === next && appThemeDark(next) === readDark()) return
    applyTheme(next)
  }

  /** Sets any theme mode, including "system". */
  function setMode(next: AppThemeMode) {
    applyTheme(next)
  }

  function applyTheme(next: AppThemeMode) {
    // applyAppTheme persists, toggles `.dark`, and dispatches
    // APP_THEME_EVENT so every mounted instance syncs; set local state
    // directly too so this instance updates synchronously.
    applyAppTheme(next)
    setModeState(next)
    setDark(appThemeDark(next))
  }

  function toggle() {
    set(!readDark())
  }

  return { mode, dark, toggle, set, setMode }
}
