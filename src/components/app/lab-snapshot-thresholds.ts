"use client"

import { useCallback, useEffect, useState } from "react"

/**
 * Diff-threshold settings for lab snapshot comparisons.
 *
 * The pixel diff in `lab-snapshot-compare.tsx` reports a `diffRatio` (the
 * fraction of changed pixels). These settings decide when that ratio is a
 * pass, a warning, or a failure:
 *
 * - `warnPercent` / `failPercent` are global thresholds, stored as percents
 *   (0–100) of changed pixels — `0.5` means 0.5%.
 * - `overrides` carries optional per-snapshot thresholds keyed by snapshot
 *   id. When a pair is compared, the "B" (actual) snapshot's override wins;
 *   the "A" (baseline) snapshot's override applies when B has none. Either
 *   way the result falls back to the global values for unset fields.
 *
 * Persisted to localStorage as a versioned blob — same pattern as
 * `dashboard-layout.ts` — so thresholds survive reloads and sync across
 * tabs via the `storage` event.
 */

/** localStorage key for the persisted thresholds blob (versioned). */
export const LAB_SNAPSHOT_THRESHOLDS_STORAGE_KEY = "spindle.lab.snapshot-thresholds:v1"

/** Schema version stored inside the blob; must match the key suffix. */
export const LAB_SNAPSHOT_THRESHOLDS_VERSION = 1

/** Warn when the diff ratio is above this percent of pixels (default 0.1%). */
export const DEFAULT_SNAPSHOT_WARN_PERCENT = 0.1
/** Fail when the diff ratio is above this percent of pixels (default 0.5%). */
export const DEFAULT_SNAPSHOT_FAIL_PERCENT = 0.5

export type LabSnapshotDiffStatus = "pass" | "warn" | "fail"

/** Per-snapshot threshold override; unset fields inherit the global value. */
export interface LabSnapshotThresholdOverride {
  warnPercent?: number
  failPercent?: number
}

export interface LabSnapshotThresholds {
  version: number
  warnPercent: number
  failPercent: number
  /** Per-snapshot overrides keyed by snapshot id. */
  overrides: Record<string, LabSnapshotThresholdOverride>
}

/** Effective thresholds for one comparison, with provenance for the UI. */
export interface ResolvedSnapshotThresholds {
  warnPercent: number
  failPercent: number
  /** Snapshot id whose override supplied the values, or `null` for global. */
  overrideSnapshotId: string | null
}

export function defaultLabSnapshotThresholds(): LabSnapshotThresholds {
  return {
    version: LAB_SNAPSHOT_THRESHOLDS_VERSION,
    warnPercent: DEFAULT_SNAPSHOT_WARN_PERCENT,
    failPercent: DEFAULT_SNAPSHOT_FAIL_PERCENT,
    overrides: {},
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value))
}

function sanitizePercent(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? clampPercent(value) : undefined
}

function sanitizeOverride(value: unknown): LabSnapshotThresholdOverride | null {
  if (!isRecord(value)) return null
  const override: LabSnapshotThresholdOverride = {}
  const warnPercent = sanitizePercent(value.warnPercent)
  const failPercent = sanitizePercent(value.failPercent)
  if (warnPercent !== undefined) override.warnPercent = warnPercent
  if (failPercent !== undefined) override.failPercent = failPercent
  return Object.keys(override).length > 0 ? override : null
}

/**
 * Merge an untrusted value (localStorage blob, cross-tab storage event) over
 * the defaults. A blob whose `version` does not match the current schema is
 * treated as absent — the versioned key means stale payloads are simply
 * ignored rather than migrated. The warn threshold never exceeds the fail
 * threshold: a warn band above the fail line could never trigger.
 */
export function sanitizeLabSnapshotThresholds(value: unknown): LabSnapshotThresholds {
  const defaults = defaultLabSnapshotThresholds()
  if (!isRecord(value)) return defaults
  if (typeof value.version === "number" && value.version !== LAB_SNAPSHOT_THRESHOLDS_VERSION) {
    return defaults
  }

  const failPercent = sanitizePercent(value.failPercent) ?? defaults.failPercent
  const warnPercent = Math.min(
    sanitizePercent(value.warnPercent) ?? defaults.warnPercent,
    failPercent,
  )

  const overrides: Record<string, LabSnapshotThresholdOverride> = {}
  if (isRecord(value.overrides)) {
    for (const [id, raw] of Object.entries(value.overrides)) {
      const override = sanitizeOverride(raw)
      if (override) overrides[id] = override
    }
  }

  return { version: LAB_SNAPSHOT_THRESHOLDS_VERSION, warnPercent, failPercent, overrides }
}

export function readLabSnapshotThresholds(): LabSnapshotThresholds {
  if (typeof window === "undefined") return defaultLabSnapshotThresholds()
  try {
    const raw = window.localStorage.getItem(LAB_SNAPSHOT_THRESHOLDS_STORAGE_KEY)
    if (!raw) return defaultLabSnapshotThresholds()
    return sanitizeLabSnapshotThresholds(JSON.parse(raw))
  } catch {
    return defaultLabSnapshotThresholds()
  }
}

/**
 * Resolve the effective thresholds for a comparison pair. The "B" (actual)
 * snapshot's override wins over the "A" (baseline) snapshot's; unset fields
 * fall back to the global values. The warn threshold is clamped to the fail
 * threshold so a partial override cannot invert the band.
 */
export function resolvePairThresholds(
  thresholds: LabSnapshotThresholds,
  baseId: string,
  otherId: string,
): ResolvedSnapshotThresholds {
  const override = thresholds.overrides[otherId] ?? thresholds.overrides[baseId]
  const overrideSnapshotId = thresholds.overrides[otherId]
    ? otherId
    : thresholds.overrides[baseId]
      ? baseId
      : null
  const failPercent = override?.failPercent ?? thresholds.failPercent
  const warnPercent = Math.min(override?.warnPercent ?? thresholds.warnPercent, failPercent)
  return { warnPercent, failPercent, overrideSnapshotId }
}

/** Classify a `diffRatio` (0–1 fraction of changed pixels) against thresholds. */
export function labSnapshotDiffStatus(
  diffRatio: number,
  thresholds: ResolvedSnapshotThresholds,
): LabSnapshotDiffStatus {
  if (diffRatio > thresholds.failPercent / 100) return "fail"
  if (diffRatio > thresholds.warnPercent / 100) return "warn"
  return "pass"
}

export function snapshotDiffStatusLabel(status: LabSnapshotDiffStatus): string {
  if (status === "pass") return "Match"
  return status === "warn" ? "Warning" : "Failed"
}

export function snapshotDiffStatusBadgeClass(status: LabSnapshotDiffStatus): string {
  if (status === "pass") return "is-succeeded"
  return status === "warn" ? "is-warn" : "is-failed"
}

/** Format a 0–1 diff ratio as a percent, matching the compare panel's stats. */
export function formatDiffRatioPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(3)}%`
}

/**
 * Threshold settings state persisted to localStorage. Starts at the defaults
 * on both server and client so the first render hydrates cleanly; the stored
 * blob is applied in a mount effect (reading localStorage in the initializer
 * would mismatch server HTML). Cross-tab writes arrive through the `storage`
 * event — same pattern as `useDashboardLayout`.
 */
export function useLabSnapshotThresholds() {
  const [thresholds, setThresholds] = useState<LabSnapshotThresholds>(defaultLabSnapshotThresholds)

  // Restore persisted thresholds after mount.
  useEffect(() => {
    setThresholds(readLabSnapshotThresholds())
  }, [])

  // Persist whenever the settings change, and pick up writes from other tabs.
  useEffect(() => {
    try {
      window.localStorage.setItem(LAB_SNAPSHOT_THRESHOLDS_STORAGE_KEY, JSON.stringify(thresholds))
    } catch {
      // Storage can be unavailable (private mode); the settings still apply
      // for this session via React state.
    }
  }, [thresholds])

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      // `key === null` means localStorage.clear() ran in another tab — treat
      // it as a reset to defaults.
      if (event.key === null) {
        setThresholds(defaultLabSnapshotThresholds())
        return
      }
      if (event.key !== LAB_SNAPSHOT_THRESHOLDS_STORAGE_KEY) return
      if (event.newValue === null) {
        setThresholds(defaultLabSnapshotThresholds())
        return
      }
      try {
        setThresholds(sanitizeLabSnapshotThresholds(JSON.parse(event.newValue)))
      } catch {
        // Corrupt payload from another tab — keep the current settings.
      }
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  /** Patch the global warn/fail thresholds (percents of changed pixels). */
  const updateGlobalThresholds = useCallback(
    (patch: { warnPercent?: number; failPercent?: number }) => {
      setThresholds((current) => {
        const failPercent = patch.failPercent ?? current.failPercent
        const warnPercent = Math.min(patch.warnPercent ?? current.warnPercent, failPercent)
        return {
          ...current,
          warnPercent: clampPercent(warnPercent),
          failPercent: clampPercent(failPercent),
        }
      })
    },
    [],
  )

  /**
   * Set or clear (`null`) the per-snapshot override for `snapshotId`. Empty
   * overrides are dropped so they fall back to the global thresholds.
   */
  const setSnapshotOverride = useCallback(
    (snapshotId: string, override: LabSnapshotThresholdOverride | null) => {
      setThresholds((current) => {
        const overrides = { ...current.overrides }
        const clean = override ? sanitizeOverride(override) : null
        if (clean) {
          overrides[snapshotId] = clean
        } else {
          delete overrides[snapshotId]
        }
        return { ...current, overrides }
      })
    },
    [],
  )

  return { thresholds, updateGlobalThresholds, setSnapshotOverride }
}
