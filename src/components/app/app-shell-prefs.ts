"use client"

import { useEffect, useRef, useState } from "react"

/**
 * localStorage-backed boolean flags for the app shell — the collapsed
 * sidebar and compact mode. Stored as "1"/"0" under versioned keys so they
 * survive reloads and sync across tabs via the `storage` event (same
 * pattern as `dashboard-layout.ts`). The stored value is applied in a mount
 * effect — reading localStorage in the state initializer would mismatch
 * server HTML — and the first persist is skipped so the restore is not
 * overwritten by the default before it applies.
 */
export const APP_SHELL_SIDEBAR_KEY = "spindle.app.sidebar-collapsed:v1"
export const APP_SHELL_COMPACT_KEY = "spindle.app.compact:v1"

function readFlag(key: string): boolean | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === "1" || raw === "true") return true
    if (raw === "0" || raw === "false") return false
    return null
  } catch {
    // Storage can be unavailable (private mode).
    return null
  }
}

function writeFlag(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, value ? "1" : "0")
  } catch {
    // Storage can be unavailable (private mode); the flag still applies
    // for this session via React state.
  }
}

/**
 * Persisted boolean flag. Starts at `defaultValue` on both server and
 * client so the first render hydrates cleanly; the stored value is applied
 * in a mount effect. Cross-tab writes arrive through the `storage` event.
 */
export function usePersistedFlag(storageKey: string, defaultValue = false) {
  const [value, setValue] = useState(defaultValue)
  // Skip the first persist so the mount-time restore is not clobbered.
  const mounted = useRef(false)

  // Restore the persisted flag after mount.
  useEffect(() => {
    const stored = readFlag(storageKey)
    if (stored !== null) setValue(stored)
  }, [storageKey])

  // Persist on change. Runs again after the restore effect applies the
  // stored value, writing it back unchanged.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    writeFlag(storageKey, value)
  }, [storageKey, value])

  // Sync writes from other tabs; `key === null` means localStorage.clear()
  // ran elsewhere, which resets the flag to its default.
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key !== null && event.key !== storageKey) return
      setValue(event.key === null ? defaultValue : (readFlag(storageKey) ?? defaultValue))
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [storageKey, defaultValue])

  return [value, setValue] as const
}
