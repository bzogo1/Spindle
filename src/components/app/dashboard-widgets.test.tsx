import { act, render, renderHook, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  DASHBOARD_WIDGETS_STORAGE_KEY,
  DASHBOARD_WIDGET_IDS,
  DashboardCustomizeDialog,
  defaultDashboardWidgets,
  sanitizeDashboardWidgets,
  useDashboardWidgets,
  type DashboardWidgetsApi,
} from "./dashboard-widgets"

function clearStoredWidgets() {
  window.localStorage.removeItem(DASHBOARD_WIDGETS_STORAGE_KEY)
}

beforeEach(clearStoredWidgets)

describe("sanitizeDashboardWidgets", () => {
  it("returns the defaults for non-object payloads", () => {
    expect(sanitizeDashboardWidgets(null)).toEqual(defaultDashboardWidgets())
    expect(sanitizeDashboardWidgets("nope")).toEqual(defaultDashboardWidgets())
    expect(sanitizeDashboardWidgets(42)).toEqual(defaultDashboardWidgets())
  })

  it("keeps a valid order grouped by zone and hidden list", () => {
    const result = sanitizeDashboardWidgets({
      order: ["storage", "stats", "projects", "activity", "quick-actions"],
      hidden: ["stats"],
    })

    // Cross-zone interleaving is normalized: top, then main, then sidebar,
    // preserving the relative order inside each zone.
    expect(result.order).toEqual(["stats", "projects", "storage", "activity", "quick-actions"])
    expect(result.hidden).toEqual(["stats"])
  })

  it("drops unknown ids and duplicates, then appends missing widgets", () => {
    const result = sanitizeDashboardWidgets({
      order: ["bogus", "activity", "activity", "storage"],
      hidden: ["nope", "activity", "activity"],
    })

    expect(result.order).toEqual(["stats", "projects", "activity", "storage", "quick-actions"])
    expect(result.hidden).toEqual(["activity"])
    // Every registered widget is present exactly once.
    expect(new Set(result.order)).toEqual(new Set(DASHBOARD_WIDGET_IDS))
    expect(result.order).toHaveLength(DASHBOARD_WIDGET_IDS.length)
  })

  it("falls back to the default order when order is not an array", () => {
    const result = sanitizeDashboardWidgets({ order: "stats", hidden: ["stats"] })
    expect(result.order).toEqual([...DASHBOARD_WIDGET_IDS])
    expect(result.hidden).toEqual(["stats"])
  })
})

describe("useDashboardWidgets", () => {
  it("starts at the defaults and persists changes", () => {
    const { result } = renderHook(() => useDashboardWidgets())

    expect(result.current.config).toEqual(defaultDashboardWidgets())
    expect(result.current.isVisible("projects")).toBe(true)

    act(() => {
      result.current.setVisible("projects", false)
    })

    expect(result.current.isVisible("projects")).toBe(false)
    const stored = JSON.parse(window.localStorage.getItem(DASHBOARD_WIDGETS_STORAGE_KEY) ?? "{}")
    expect(stored.hidden).toEqual(["projects"])
  })

  it("restores a valid stored config on mount", () => {
    window.localStorage.setItem(
      DASHBOARD_WIDGETS_STORAGE_KEY,
      JSON.stringify({
        order: ["quick-actions", "stats", "projects", "activity", "storage"],
        hidden: ["activity"],
      }),
    )

    const { result } = renderHook(() => useDashboardWidgets())

    // Stored order is canonicalized into zones on restore.
    expect(result.current.config.order).toEqual([
      "stats",
      "projects",
      "quick-actions",
      "activity",
      "storage",
    ])
    expect(result.current.isVisible("activity")).toBe(false)
    expect(result.current.isVisible("storage")).toBe(true)
  })

  it("falls back to defaults for corrupt or hostile stored JSON", () => {
    window.localStorage.setItem(DASHBOARD_WIDGETS_STORAGE_KEY, "{not json")
    const corrupt = renderHook(() => useDashboardWidgets())
    expect(corrupt.result.current.config).toEqual(defaultDashboardWidgets())
    corrupt.unmount()

    window.localStorage.setItem(
      DASHBOARD_WIDGETS_STORAGE_KEY,
      JSON.stringify({ order: ["bogus", "activity"], hidden: ["bogus", "activity"] }),
    )
    const hostile = renderHook(() => useDashboardWidgets())
    expect(hostile.result.current.config.order).toHaveLength(DASHBOARD_WIDGET_IDS.length)
    expect(hostile.result.current.config.hidden).toEqual(["activity"])
  })

  it("reorders within a zone and ignores cross-zone or edge moves", () => {
    const { result } = renderHook(() => useDashboardWidgets())

    // "activity" is the first sidebar widget; moving up would swap with
    // "projects" in the main zone — a silent no-op, so nothing changes.
    act(() => {
      result.current.move("activity", -1)
    })
    expect(result.current.config.order).toEqual([...DASHBOARD_WIDGET_IDS])

    // Moving down swaps with "storage" inside the sidebar zone.
    act(() => {
      result.current.move("activity", 1)
    })
    expect(result.current.config.order).toEqual([
      "stats",
      "projects",
      "storage",
      "activity",
      "quick-actions",
    ])

    // Singleton-zone widgets cannot move at all.
    act(() => {
      result.current.move("stats", 1)
      result.current.move("projects", -1)
    })
    expect(result.current.config.order.slice(0, 2)).toEqual(["stats", "projects"])

    // "quick-actions" bubbles to the top of the sidebar zone.
    act(() => {
      result.current.move("quick-actions", -1)
      result.current.move("quick-actions", -1)
    })
    expect(result.current.config.order).toEqual([
      "stats",
      "projects",
      "quick-actions",
      "storage",
      "activity",
    ])

    act(() => {
      result.current.reset()
    })
    expect(result.current.config).toEqual(defaultDashboardWidgets())
  })

  it("syncs config changes from other tabs via the storage event", () => {
    const { result } = renderHook(() => useDashboardWidgets())

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: DASHBOARD_WIDGETS_STORAGE_KEY,
          newValue: JSON.stringify({
            order: [...DASHBOARD_WIDGET_IDS].reverse(),
            hidden: ["stats"],
          }),
        }),
      )
    })

    // The reversed payload is sanitized into zone-grouped order.
    expect(result.current.config.order).toEqual([
      "stats",
      "projects",
      "quick-actions",
      "storage",
      "activity",
    ])
    expect(result.current.isVisible("stats")).toBe(false)

    // A removal in another tab resets to defaults.
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: DASHBOARD_WIDGETS_STORAGE_KEY,
          newValue: null,
        }),
      )
    })
    expect(result.current.config).toEqual(defaultDashboardWidgets())

    // localStorage.clear() in another tab also resets.
    act(() => {
      result.current.setVisible("storage", false)
      window.dispatchEvent(new StorageEvent("storage", { key: null }))
    })
    expect(result.current.config).toEqual(defaultDashboardWidgets())

    // Corrupt payloads from other tabs are ignored.
    act(() => {
      result.current.setVisible("storage", false)
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: DASHBOARD_WIDGETS_STORAGE_KEY,
          newValue: "{broken",
        }),
      )
    })
    expect(result.current.isVisible("storage")).toBe(false)
  })
})

function stubWidgets(overrides: Partial<DashboardWidgetsApi> = {}): DashboardWidgetsApi {
  return {
    config: defaultDashboardWidgets(),
    isVisible: () => true,
    setVisible: vi.fn(),
    move: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  }
}

describe("DashboardCustomizeDialog", () => {
  it("groups widgets by zone with headers and reorder controls only in the sidebar", async () => {
    const widgets = stubWidgets()
    render(<DashboardCustomizeDialog open onOpenChange={vi.fn()} widgets={widgets} />)

    expect(await screen.findByRole("heading", { name: "Customize dashboard" })).toBeInTheDocument()

    // Zone sections communicate where each widget renders.
    expect(screen.getByRole("heading", { name: "Top row" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Main column" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Sidebar" })).toBeInTheDocument()

    expect(screen.getAllByRole("checkbox")).toHaveLength(DASHBOARD_WIDGET_IDS.length)
    expect(screen.getByRole("checkbox", { name: /Summary stats/ })).toBeInTheDocument()

    // Singleton-zone widgets are fixed: no reorder buttons for them.
    expect(screen.queryByRole("button", { name: "Move Summary stats up" })).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Move Summary stats down" }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Move Projects up" })).not.toBeInTheDocument()
    expect(screen.getAllByText("Fixed position")).toHaveLength(2)

    // Sidebar widgets keep their reorder controls.
    expect(screen.getByRole("button", { name: "Move Recent activity up" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Move Quick actions down" })).toBeInTheDocument()
  })

  it("toggles visibility and moves widgets through the api", async () => {
    const user = userEvent.setup()
    const setVisible = vi.fn()
    const move = vi.fn()
    const widgets = stubWidgets({ setVisible, move })
    render(<DashboardCustomizeDialog open onOpenChange={vi.fn()} widgets={widgets} />)

    await user.click(await screen.findByRole("checkbox", { name: /Summary stats/ }))
    expect(setVisible).toHaveBeenCalledWith("stats", false)

    await user.click(screen.getByRole("button", { name: "Move Storage up" }))
    expect(move).toHaveBeenCalledWith("storage", -1)

    await user.click(screen.getByRole("button", { name: "Reset to default" }))
    expect(widgets.reset).toHaveBeenCalledTimes(1)
  })

  it("disables reorder buttons at the sidebar zone edges", async () => {
    const widgets = stubWidgets()
    render(<DashboardCustomizeDialog open onOpenChange={vi.fn()} widgets={widgets} />)

    // First sidebar widget cannot move up; last cannot move down. Widgets in
    // other zones have no reorder buttons at all.
    expect(await screen.findByRole("button", { name: "Move Recent activity up" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Move Quick actions down" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Move Storage up" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "Move Quick actions up" })).toBeEnabled()
  })
})
