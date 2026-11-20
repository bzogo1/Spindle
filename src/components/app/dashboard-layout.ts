"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Dashboard layout persistence. The dashboard currently exposes one piece of
 * layout configuration — the project sort order — stored as a versioned blob
 * in localStorage so it survives reloads and syncs across tabs via the
 * `storage` event (same pattern as the notification preferences provider).
 * The blob shape is intentionally flat and sanitized on read so a corrupt or
 * future payload can never produce an invalid layout.
 */

/** localStorage key for the persisted layout blob (versioned). */
export const DASHBOARD_LAYOUT_STORAGE_KEY = "spindle.dashboard.layout:v1"

/** Schema version stored inside the blob; must match the key suffix. */
export const DASHBOARD_LAYOUT_VERSION = 1

export const DASHBOARD_PROJECT_SORTS = ["updated", "name", "created", "files"] as const
export type DashboardProjectSort = (typeof DASHBOARD_PROJECT_SORTS)[number]

export const DEFAULT_DASHBOARD_PROJECT_SORT: DashboardProjectSort = "updated"

export interface DashboardLayout {
  version: number
  /** Project list sort order on the dashboard. */
  sort: DashboardProjectSort
}

export function defaultDashboardLayout(): DashboardLayout {
  return { version: DASHBOARD_LAYOUT_VERSION, sort: DEFAULT_DASHBOARD_PROJECT_SORT }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/**
 * Merge an untrusted value (localStorage blob, cross-tab storage event) over
 * the defaults. A blob whose `version` does not match the current schema is
 * treated as absent — the versioned key means stale payloads are simply
 * ignored rather than migrated.
 */
export function sanitizeDashboardLayout(value: unknown): DashboardLayout {
  const defaults = defaultDashboardLayout()
  if (!isRecord(value)) return defaults
  if (typeof value.version === "number" && value.version !== DASHBOARD_LAYOUT_VERSION) {
    return defaults
  }

  const layout: DashboardLayout = { ...defaults }
  if (
    typeof value.sort === "string" &&
    (DASHBOARD_PROJECT_SORTS as readonly string[]).includes(value.sort)
  ) {
    layout.sort = value.sort as DashboardProjectSort
  }
  return layout
}

export function readDashboardLayout(): DashboardLayout {
  if (typeof window === "undefined") return defaultDashboardLayout()
  try {
    const raw = window.localStorage.getItem(DASHBOARD_LAYOUT_STORAGE_KEY)
    if (!raw) return defaultDashboardLayout()
    return sanitizeDashboardLayout(JSON.parse(raw))
  } catch {
    return defaultDashboardLayout()
  }
}

/**
 * Dashboard layout state persisted to localStorage. Starts at the defaults on
 * both server and client so the first render hydrates cleanly; the stored
 * blob is applied in a mount effect (reading localStorage in the initializer
 * would mismatch server HTML). Cross-tab writes arrive through the `storage`
 * event.
 *
 * `sharedSort` (decoded from shareable-link URL params by
 * `dashboard-share.ts`) takes precedence over the stored blob for the view.
 * Like the widget config, a shared view is ephemeral: it is never persisted
 * and ignores cross-tab `storage` events.
 */
export function useDashboardLayout(sharedSort?: DashboardProjectSort) {
  const [layout, setLayout] = useState<DashboardLayout>(defaultDashboardLayout)
  // Mirror for the once-subscribed storage listener (kept out of its deps).
  const sharedRef = useRef<DashboardProjectSort | undefined>(sharedSort)

  useEffect(() => {
    sharedRef.current = sharedSort
  }, [sharedSort])

  // Restore persisted layout after mount — or apply the shared-link override.
  // This effect must run BEFORE the persist effect below: on the first commit
  // both see the default state, so the persist effect briefly rewrites
  // defaults — harmless because this effect already captured the stored
  // value, and the next render persists the restored layout back.
  useEffect(() => {
    setLayout(
      sharedSort ? { version: DASHBOARD_LAYOUT_VERSION, sort: sharedSort } : readDashboardLayout(),
    )
  }, [sharedSort])

  // Persist the layout whenever it changes, and pick up writes from other
  // tabs (same pattern as the notification preferences provider).
  useEffect(() => {
    // Shared-link views are read-only with respect to storage.
    if (sharedSort) return
    try {
      window.localStorage.setItem(DASHBOARD_LAYOUT_STORAGE_KEY, JSON.stringify(layout))
    } catch {
      // Storage can be unavailable (private mode); the layout still applies
      // for this session via React state.
    }
  }, [layout, sharedSort])

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      // A shared view stays pinned to the link's params.
      if (sharedRef.current) return
      // `key === null` means localStorage.clear() ran in another tab — treat
      // it as a reset to defaults.
      if (event.key === null) {
        setLayout(defaultDashboardLayout())
        return
      }
      if (event.key !== DASHBOARD_LAYOUT_STORAGE_KEY) return
      if (event.newValue === null) {
        setLayout(defaultDashboardLayout())
        return
      }
      try {
        setLayout(sanitizeDashboardLayout(JSON.parse(event.newValue)))
      } catch {
        // Corrupt payload from another tab — keep the current layout.
      }
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  const setSort = useCallback((sort: DashboardProjectSort) => {
    setLayout((current) => ({ ...current, sort }))
  }, [])

  return { sort: layout.sort, setSort }
}
