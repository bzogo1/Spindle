import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  DEFAULT_SNAPSHOT_FAIL_PERCENT,
  DEFAULT_SNAPSHOT_WARN_PERCENT,
  LAB_SNAPSHOT_THRESHOLDS_STORAGE_KEY,
  LAB_SNAPSHOT_THRESHOLDS_VERSION,
  defaultLabSnapshotThresholds,
  formatDiffRatioPercent,
  labSnapshotDiffStatus,
  readLabSnapshotThresholds,
  resolvePairThresholds,
  sanitizeLabSnapshotThresholds,
  snapshotDiffStatusBadgeClass,
  snapshotDiffStatusLabel,
  useLabSnapshotThresholds,
} from "./lab-snapshot-thresholds"

function clearThresholds() {
  window.localStorage.removeItem(LAB_SNAPSHOT_THRESHOLDS_STORAGE_KEY)
}

beforeEach(clearThresholds)
afterEach(clearThresholds)

describe("sanitizeLabSnapshotThresholds", () => {
  it("returns defaults for non-object payloads", () => {
    expect(sanitizeLabSnapshotThresholds(null)).toEqual(defaultLabSnapshotThresholds())
    expect(sanitizeLabSnapshotThresholds("garbage")).toEqual(defaultLabSnapshotThresholds())
    expect(sanitizeLabSnapshotThresholds([1, 2])).toEqual(defaultLabSnapshotThresholds())
  })

  it("keeps valid values and clamps out-of-range percents", () => {
    const result = sanitizeLabSnapshotThresholds({
      version: LAB_SNAPSHOT_THRESHOLDS_VERSION,
      warnPercent: -5,
      failPercent: 250,
    })
    expect(result.warnPercent).toBe(0)
    expect(result.failPercent).toBe(100)
  })

  it("clamps warn to fail so the warn band cannot invert", () => {
    const result = sanitizeLabSnapshotThresholds({
      version: LAB_SNAPSHOT_THRESHOLDS_VERSION,
      warnPercent: 2,
      failPercent: 1,
    })
    expect(result.warnPercent).toBe(1)
    expect(result.failPercent).toBe(1)
  })

  it("rejects blobs from a different schema version", () => {
    expect(
      sanitizeLabSnapshotThresholds({
        version: LAB_SNAPSHOT_THRESHOLDS_VERSION + 1,
        failPercent: 9,
      }),
    ).toEqual(defaultLabSnapshotThresholds())
  })

  it("drops malformed overrides and empty override objects", () => {
    const result = sanitizeLabSnapshotThresholds({
      version: LAB_SNAPSHOT_THRESHOLDS_VERSION,
      overrides: {
        "snap-01": { failPercent: 2, warnPercent: "x" },
        "snap-02": {},
        "snap-03": "garbage",
      },
    })
    expect(result.overrides).toEqual({ "snap-01": { failPercent: 2 } })
  })
})

describe("readLabSnapshotThresholds", () => {
  it("returns defaults when nothing is stored", () => {
    expect(readLabSnapshotThresholds()).toEqual(defaultLabSnapshotThresholds())
  })

  it("returns defaults for a corrupt blob", () => {
    window.localStorage.setItem(LAB_SNAPSHOT_THRESHOLDS_STORAGE_KEY, "{not json")
    expect(readLabSnapshotThresholds()).toEqual(defaultLabSnapshotThresholds())
  })

  it("reads a persisted blob", () => {
    window.localStorage.setItem(
      LAB_SNAPSHOT_THRESHOLDS_STORAGE_KEY,
      JSON.stringify({ version: 1, warnPercent: 0.2, failPercent: 1, overrides: {} }),
    )
    expect(readLabSnapshotThresholds().failPercent).toBe(1)
  })
})

describe("resolvePairThresholds", () => {
  const base = defaultLabSnapshotThresholds()

  it("falls back to the global thresholds without overrides", () => {
    const resolved = resolvePairThresholds(base, "snap-01", "snap-02")
    expect(resolved).toEqual({
      warnPercent: DEFAULT_SNAPSHOT_WARN_PERCENT,
      failPercent: DEFAULT_SNAPSHOT_FAIL_PERCENT,
      overrideSnapshotId: null,
    })
  })

  it("prefers the B (other) snapshot's override over A's", () => {
    const thresholds = {
      ...base,
      overrides: {
        "snap-01": { failPercent: 5 },
        "snap-02": { failPercent: 2 },
      },
    }
    const resolved = resolvePairThresholds(thresholds, "snap-01", "snap-02")
    expect(resolved.failPercent).toBe(2)
    expect(resolved.overrideSnapshotId).toBe("snap-02")
  })

  it("uses the A snapshot's override when B has none, inheriting global fields", () => {
    const thresholds = {
      ...base,
      overrides: { "snap-01": { failPercent: 3 } },
    }
    const resolved = resolvePairThresholds(thresholds, "snap-01", "snap-02")
    expect(resolved.failPercent).toBe(3)
    expect(resolved.warnPercent).toBe(DEFAULT_SNAPSHOT_WARN_PERCENT)
    expect(resolved.overrideSnapshotId).toBe("snap-01")
  })

  it("clamps warn to a lower override fail", () => {
    const thresholds = {
      ...base,
      overrides: { "snap-02": { failPercent: 0.05 } },
    }
    const resolved = resolvePairThresholds(thresholds, "snap-01", "snap-02")
    expect(resolved.warnPercent).toBe(0.05)
    expect(resolved.failPercent).toBe(0.05)
  })
})

describe("labSnapshotDiffStatus", () => {
  const thresholds = { warnPercent: 0.1, failPercent: 0.5, overrideSnapshotId: null }

  it("passes at or below the warn threshold", () => {
    expect(labSnapshotDiffStatus(0, thresholds)).toBe("pass")
    expect(labSnapshotDiffStatus(0.001, thresholds)).toBe("pass")
  })

  it("warns between warn and fail", () => {
    expect(labSnapshotDiffStatus(0.002, thresholds)).toBe("warn")
    expect(labSnapshotDiffStatus(0.005, thresholds)).toBe("warn")
  })

  it("fails above the fail threshold", () => {
    expect(labSnapshotDiffStatus(0.006, thresholds)).toBe("fail")
    expect(labSnapshotDiffStatus(0.5, thresholds)).toBe("fail")
  })
})

describe("status presentation helpers", () => {
  it("maps statuses to labels and badge classes", () => {
    expect(snapshotDiffStatusLabel("pass")).toBe("Match")
    expect(snapshotDiffStatusLabel("warn")).toBe("Warning")
    expect(snapshotDiffStatusLabel("fail")).toBe("Failed")
    expect(snapshotDiffStatusBadgeClass("pass")).toBe("is-succeeded")
    expect(snapshotDiffStatusBadgeClass("warn")).toBe("is-warn")
    expect(snapshotDiffStatusBadgeClass("fail")).toBe("is-failed")
  })

  it("formats diff ratios as percents", () => {
    expect(formatDiffRatioPercent(0)).toBe("0.000%")
    expect(formatDiffRatioPercent(0.005)).toBe("0.500%")
  })
})

describe("useLabSnapshotThresholds", () => {
  it("starts at the defaults and applies the stored blob on mount", () => {
    window.localStorage.setItem(
      LAB_SNAPSHOT_THRESHOLDS_STORAGE_KEY,
      JSON.stringify({ version: 1, warnPercent: 0.3, failPercent: 2, overrides: {} }),
    )

    const { result } = renderHook(() => useLabSnapshotThresholds())

    expect(result.current.thresholds.failPercent).toBe(2)
    expect(result.current.thresholds.warnPercent).toBe(0.3)
  })

  it("persists global threshold updates to localStorage", () => {
    const { result } = renderHook(() => useLabSnapshotThresholds())
    expect(result.current.thresholds.failPercent).toBe(DEFAULT_SNAPSHOT_FAIL_PERCENT)

    act(() => {
      result.current.updateGlobalThresholds({ failPercent: 1.5 })
    })

    expect(result.current.thresholds.failPercent).toBe(1.5)
    expect(
      JSON.parse(window.localStorage.getItem(LAB_SNAPSHOT_THRESHOLDS_STORAGE_KEY)!).failPercent,
    ).toBe(1.5)
  })

  it("keeps warn at or below fail when the fail threshold is lowered", () => {
    const { result } = renderHook(() => useLabSnapshotThresholds())

    act(() => {
      result.current.updateGlobalThresholds({ failPercent: 0.05 })
    })

    expect(result.current.thresholds.warnPercent).toBe(0.05)
    expect(result.current.thresholds.failPercent).toBe(0.05)
  })

  it("sets and clears per-snapshot overrides", () => {
    const { result } = renderHook(() => useLabSnapshotThresholds())

    act(() => {
      result.current.setSnapshotOverride("snap-01", { failPercent: 4 })
    })
    expect(result.current.thresholds.overrides["snap-01"]).toEqual({ failPercent: 4 })

    act(() => {
      result.current.setSnapshotOverride("snap-01", {
        warnPercent: undefined,
        failPercent: undefined,
      })
    })
    expect(result.current.thresholds.overrides["snap-01"]).toBeUndefined()

    act(() => {
      result.current.setSnapshotOverride("snap-01", null)
    })
    expect(result.current.thresholds.overrides).toEqual({})
  })

  it("syncs when another tab writes to storage", () => {
    const { result } = renderHook(() => useLabSnapshotThresholds())

    act(() => {
      window.localStorage.setItem(
        LAB_SNAPSHOT_THRESHOLDS_STORAGE_KEY,
        JSON.stringify({ version: 1, warnPercent: 0.1, failPercent: 7, overrides: {} }),
      )
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: LAB_SNAPSHOT_THRESHOLDS_STORAGE_KEY,
          newValue: window.localStorage.getItem(LAB_SNAPSHOT_THRESHOLDS_STORAGE_KEY),
        }),
      )
    })

    expect(result.current.thresholds.failPercent).toBe(7)
  })
})
