import { describe, expect, it } from "vitest"

import { DASHBOARD_PROJECT_SORTS, DEFAULT_DASHBOARD_PROJECT_SORT } from "./dashboard-layout"
import {
  dashboardShareHref,
  dashboardShareParams,
  parseDashboardShareParams,
} from "./dashboard-share"
import {
  DASHBOARD_WIDGET_IDS,
  defaultDashboardWidgets,
  sanitizeDashboardWidgets,
} from "./dashboard-widgets"

function params(query: string) {
  return new URLSearchParams(query)
}

describe("parseDashboardShareParams", () => {
  it("returns empty state when no share params are present", () => {
    expect(parseDashboardShareParams(params("project=prj_01"))).toEqual({})
    expect(parseDashboardShareParams(params(""))).toEqual({})
  })

  it("decodes the widgets order and hidden digits", () => {
    // Sidebar reordered (storage, quick-actions, activity) + activity hidden.
    const state = parseDashboardShareParams(params("widgets=01342-2"))
    expect(state.widgets?.order).toEqual([
      "stats",
      "projects",
      "storage",
      "quick-actions",
      "activity",
    ])
    expect(state.widgets?.hidden).toEqual(["activity"])
  })

  it("sanitizes partial and hostile widget payloads", () => {
    // Unknown digits are dropped; missing widgets are appended by the
    // sanitizer, so a truncated link still yields a valid config.
    const partial = parseDashboardShareParams(params("widgets=09-7"))
    expect(partial.widgets?.order).toHaveLength(DASHBOARD_WIDGET_IDS.length)
    expect(new Set(partial.widgets?.order)).toEqual(new Set(DASHBOARD_WIDGET_IDS))
    expect(partial.widgets?.hidden).toEqual([])

    const garbage = parseDashboardShareParams(params("widgets=abc"))
    expect(garbage.widgets).toBeUndefined()

    const empty = parseDashboardShareParams(params("widgets="))
    expect(empty.widgets).toBeUndefined()
  })

  it("decodes the sort index and rejects non-digit values", () => {
    expect(parseDashboardShareParams(params("sort=3")).sort).toBe("files")
    expect(parseDashboardShareParams(params("sort=9")).sort).toBeUndefined()
    expect(parseDashboardShareParams(params("sort=abc")).sort).toBeUndefined()
    expect(parseDashboardShareParams(params("sort=")).sort).toBeUndefined()
  })
})

describe("dashboardShareParams", () => {
  it("omits params that match the defaults", () => {
    const result = dashboardShareParams({
      widgets: defaultDashboardWidgets(),
      sort: DEFAULT_DASHBOARD_PROJECT_SORT,
    })
    expect(result.toString()).toBe("")
  })

  it("encodes a non-default config compactly and round-trips", () => {
    const widgets = sanitizeDashboardWidgets({
      order: ["stats", "projects", "quick-actions", "storage", "activity"],
      hidden: ["activity", "storage"],
    })
    const result = dashboardShareParams({ widgets, sort: "name" })

    // stats=0, projects=1, quick-actions=4, storage=3, activity=2.
    expect(result.get("widgets")).toBe("01432-23")
    expect(result.get("sort")).toBe("1")

    const parsed = parseDashboardShareParams(result)
    expect(parsed.widgets).toEqual(widgets)
    expect(parsed.sort).toBe("name")
  })

  it("preserves unrelated base params and removes stale share params", () => {
    const result = dashboardShareParams(
      { widgets: defaultDashboardWidgets(), sort: "created" },
      params("project=prj_01&widgets=00000&sort=2"),
    )

    // Default widgets drop the stale `widgets` param; `project` survives.
    expect(result.get("project")).toBe("prj_01")
    expect(result.get("widgets")).toBeNull()
    expect(result.get("sort")).toBe("2")
  })
})

describe("dashboardShareHref", () => {
  it("builds an absolute URL with encoded params", () => {
    const href = dashboardShareHref(
      {
        widgets: sanitizeDashboardWidgets({ hidden: ["quick-actions"] }),
        sort: "files",
      },
      "/dashboard",
      "project=prj_01",
    )

    expect(href).toMatch(/^https?:\/\/[^/]+\/dashboard\?/)
    const query = new URL(href).searchParams
    expect(query.get("project")).toBe("prj_01")
    expect(query.get("widgets")).toBe("01234-4")
    expect(query.get("sort")).toBe("3")
    expect(DASHBOARD_PROJECT_SORTS[3]).toBe("files")
  })

  it("returns a bare path-free origin URL when state is default", () => {
    const href = dashboardShareHref(
      { widgets: defaultDashboardWidgets(), sort: DEFAULT_DASHBOARD_PROJECT_SORT },
      "/dashboard",
      "",
    )
    expect(href).not.toContain("?")
  })
})
