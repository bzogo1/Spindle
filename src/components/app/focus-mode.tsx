"use client"

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react"
import { Maximize2, Minimize2 } from "lucide-react"

import styles from "./app-shell-features.module.css"

type FocusModeContextValue = {
  focusMode: boolean
  setFocusMode: (value: boolean) => void
  toggleFocusMode: () => void
}

const FocusModeContext = createContext<FocusModeContextValue | null>(null)

/**
 * Focus mode state for the app shell. When active, AppShell hides the sidebar
 * and top bar so the page content gets the full viewport; a floating exit
 * button and the Escape shortcut (handled by KeyboardShortcuts) turn it off.
 */
export function FocusModeProvider({ children }: { children: ReactNode }) {
  const [focusMode, setFocusMode] = useState(false)

  const toggleFocusMode = useCallback(() => setFocusMode((current) => !current), [])

  const value = useMemo(
    () => ({ focusMode, setFocusMode, toggleFocusMode }),
    [focusMode, toggleFocusMode],
  )

  return <FocusModeContext.Provider value={value}>{children}</FocusModeContext.Provider>
}

export function useFocusMode() {
  const context = useContext(FocusModeContext)
  if (!context) throw new Error("useFocusMode must be used inside FocusModeProvider")
  return context
}

/** Top-bar icon button that toggles focus mode. */
export function FocusModeToggle() {
  const { focusMode, toggleFocusMode } = useFocusMode()

  return (
    <button
      type="button"
      className="app-icon-button"
      onClick={toggleFocusMode}
      aria-pressed={focusMode}
      aria-label={focusMode ? "Exit focus mode" : "Enter focus mode"}
      title={focusMode ? "Exit focus mode (Esc)" : "Focus mode (Shift+F)"}
    >
      {focusMode ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
    </button>
  )
}

/**
 * Floating "Exit focus mode" pill rendered only while focus mode is on —
 * the top bar that normally hosts the toggle is hidden in that state.
 */
export function FocusModeExit() {
  const { focusMode, setFocusMode } = useFocusMode()

  if (!focusMode) return null

  return (
    <button type="button" className={styles.focusExit} onClick={() => setFocusMode(false)}>
      <Minimize2 aria-hidden="true" />
      Exit focus mode
      <kbd className="app-search-kbd" aria-hidden="true">
        Esc
      </kbd>
    </button>
  )
}
