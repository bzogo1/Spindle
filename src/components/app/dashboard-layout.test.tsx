import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  DASHBOARD_LAYOUT_STORAGE_KEY,
  DASHBOARD_LAYOUT_VERSION,
  defaultDashboardLayout,
  readDashboardLayout,
  sanitizeDashboardLayout,
  useDashboardLayout,
} from "./dashboard-layout"

function clearLayout() {
  window.localStorage.removeItem(DASHBOARD_LAYOUT_STORAGE_KEY)
}

beforeEach(clearLayout)
afterEach(clearLayout)

describe("sanitizeDashboardLayout", () => {
  it("returns defaults for non-object payloads", () => {
    expect(sanitizeDashboardLayout(null)).toEqual(defaultDashboardLayout())
    expect(sanitizeDashboardLayout("garbage")).toEqual(defaultDashboardLayout())
    expect(sanitizeDashboardLayout([1, 2])).toEqual(defaultDashboardLayout())
  })

  it("keeps a valid sort and fills in the version", () => {
    expect(sanitizeDashboardLayout({ sort: "name" })).toEqual({
      version: DASHBOARD_LAYOUT_VERSION,
      sort: "name",
    })
  })

  it("falls back to the default sort for unknown values", () => {
    expect(sanitizeDashboardLayout({ sort: "bogus" }).sort).toBe("updated")
    expect(sanitizeDashboardLayout({ sort: 42 }).sort).toBe("updated")
  })

  it("rejects blobs from a different schema version", () => {
    expect(
      sanitizeDashboardLayout({ version: DASHBOARD_LAYOUT_VERSION + 1, sort: "name" }),
    ).toEqual(defaultDashboardLayout())
  })
})

describe("readDashboardLayout", () => {
  it("returns defaults when nothing is stored", () => {
    expect(readDashboardLayout()).toEqual(defaultDashboardLayout())
  })

  it("returns defaults for a corrupt blob", () => {
    window.localStorage.setItem(DASHBOARD_LAYOUT_STORAGE_KEY, "{not json")
    expect(readDashboardLayout()).toEqual(defaultDashboardLayout())
  })

  it("reads a persisted layout", () => {
    window.localStorage.setItem(
      DASHBOARD_LAYOUT_STORAGE_KEY,
      JSON.stringify({ version: 1, sort: "files" }),
    )
    expect(readDashboardLayout().sort).toBe("files")
  })
})

describe("useDashboardLayout", () => {
  it("starts at the defaults and applies the stored layout on mount", () => {
    window.localStorage.setItem(
      DASHBOARD_LAYOUT_STORAGE_KEY,
      JSON.stringify({ version: 1, sort: "created" }),
    )

    const { result } = renderHook(() => useDashboardLayout())

    expect(result.current.sort).toBe("created")
  })

  it("persists sort changes to localStorage", () => {
    const { result } = renderHook(() => useDashboardLayout())
    expect(result.current.sort).toBe("updated")

    act(() => {
      result.current.setSort("name")
    })

    expect(result.current.sort).toBe("name")
    expect(JSON.parse(window.localStorage.getItem(DASHBOARD_LAYOUT_STORAGE_KEY)!)).toEqual({
      version: DASHBOARD_LAYOUT_VERSION,
      sort: "name",
    })
  })

  it("syncs when another tab writes to storage", () => {
    const { result } = renderHook(() => useDashboardLayout())
    expect(result.current.sort).toBe("updated")

    act(() => {
      window.localStorage.setItem(
        DASHBOARD_LAYOUT_STORAGE_KEY,
        JSON.stringify({ version: 1, sort: "files" }),
      )
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: DASHBOARD_LAYOUT_STORAGE_KEY,
          newValue: window.localStorage.getItem(DASHBOARD_LAYOUT_STORAGE_KEY),
        }),
      )
    })

    expect(result.current.sort).toBe("files")
  })

  it("resets to defaults when another tab clears storage", () => {
    const { result } = renderHook(() => useDashboardLayout())

    act(() => {
      result.current.setSort("name")
    })
    expect(result.current.sort).toBe("name")

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: null }))
    })

    expect(result.current.sort).toBe("updated")
  })

  it("ignores storage events for unrelated keys", () => {
    const { result } = renderHook(() => useDashboardLayout())

    act(() => {
      result.current.setSort("name")
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "spindle-unrelated",
          newValue: JSON.stringify({ version: 1, sort: "files" }),
        }),
      )
    })

    expect(result.current.sort).toBe("name")
  })
})
