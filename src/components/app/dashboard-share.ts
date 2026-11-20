import {
  DASHBOARD_WIDGET_IDS,
  defaultDashboardWidgets,
  sanitizeDashboardWidgets,
  type DashboardWidgetConfig,
  type DashboardWidgetId,
} from "./dashboard-widgets"
import {
  DASHBOARD_PROJECT_SORTS,
  DEFAULT_DASHBOARD_PROJECT_SORT,
  type DashboardProjectSort,
} from "./dashboard-layout"

/**
 * Shareable dashboard links. Widget customization and the project sort are
 * encoded into compact URL params so a copied link restores the same view for
 * whoever opens it:
 *
 * - `widgets` — the widget `order` as digit codes over `DASHBOARD_WIDGET_IDS`
 *   (`stats`=0 … `quick-actions`=4), with the `hidden` ids appended after a
 *   `-` separator (omitted when empty), e.g. `widgets=01342-24`.
 * - `sort` — the project sort as an index into `DASHBOARD_PROJECT_SORTS`,
 *   e.g. `sort=3` for "Most files".
 *
 * Params equal to the defaults are omitted to keep links short, and every
 * payload is run through the same sanitizers the localStorage blobs use, so
 * hand-edited or stale links degrade gracefully instead of producing invalid
 * state. Unrelated params (e.g. `?project=` from the project switcher) are
 * preserved when building a share href.
 */

export const DASHBOARD_SHARE_WIDGETS_PARAM = "widgets"
export const DASHBOARD_SHARE_SORT_PARAM = "sort"

export interface DashboardShareState {
  widgets?: DashboardWidgetConfig
  sort?: DashboardProjectSort
}

const WIDGET_CODE_BY_ID = new Map<DashboardWidgetId, string>(
  DASHBOARD_WIDGET_IDS.map((id, index) => [id, String(index)]),
)

function isDefaultWidgets(config: DashboardWidgetConfig): boolean {
  const defaults = defaultDashboardWidgets()
  return (
    config.order.join(",") === defaults.order.join(",") &&
    config.hidden.join(",") === defaults.hidden.join(",")
  )
}

/** Decode a run of digit chars into widget ids; unknown digits are dropped. */
function decodeWidgetIds(part: string | undefined): DashboardWidgetId[] {
  if (!part) return []
  const ids: DashboardWidgetId[] = []
  for (const char of part) {
    // Strict digit check: `Number(" ")` is 0 and would alias the first widget.
    if (char < "0" || char > "9") continue
    const id = DASHBOARD_WIDGET_IDS[Number(char)]
    if (id) ids.push(id)
  }
  return ids
}

function encodeWidgetsParam(config: DashboardWidgetConfig): string {
  const sanitized = sanitizeDashboardWidgets(config)
  const order = sanitized.order.map((id) => WIDGET_CODE_BY_ID.get(id) ?? "").join("")
  const hidden = sanitized.hidden.map((id) => WIDGET_CODE_BY_ID.get(id) ?? "").join("")
  return hidden ? `${order}-${hidden}` : order
}

function decodeWidgetsParam(raw: string): DashboardWidgetConfig | undefined {
  const [orderPart, ...hiddenParts] = raw.split("-")
  const order = decodeWidgetIds(orderPart)
  if (order.length === 0) return undefined
  return sanitizeDashboardWidgets({
    order,
    hidden: decodeWidgetIds(hiddenParts.join("")),
  })
}

function decodeSortParam(raw: string): DashboardProjectSort | undefined {
  if (!/^\d$/.test(raw)) return undefined
  return DASHBOARD_PROJECT_SORTS[Number(raw)]
}

/**
 * Read the share params out of a URL query (`useSearchParams()` result or any
 * `{ get }`-shaped object). Absent, empty, or undecodable params yield
 * `undefined` fields so callers fall back to the persisted layout.
 */
export function parseDashboardShareParams(searchParams: {
  get(name: string): string | null
}): DashboardShareState {
  const state: DashboardShareState = {}

  const widgets = searchParams.get(DASHBOARD_SHARE_WIDGETS_PARAM)
  if (widgets) {
    const decoded = decodeWidgetsParam(widgets)
    if (decoded) state.widgets = decoded
  }

  const sort = searchParams.get(DASHBOARD_SHARE_SORT_PARAM)
  if (sort) {
    const decoded = decodeSortParam(sort)
    if (decoded) state.sort = decoded
  }

  return state
}

/**
 * Build the query string for a shareable dashboard URL. Starts from `base`
 * (typically the current `location.search`, preserving params like
 * `?project=`) and sets or removes the share params so values matching the
 * defaults stay out of the link.
 */
export function dashboardShareParams(
  state: { widgets: DashboardWidgetConfig; sort: DashboardProjectSort },
  base?: string | URLSearchParams,
): URLSearchParams {
  const params = new URLSearchParams(base?.toString() ?? "")

  const widgets = sanitizeDashboardWidgets(state.widgets)
  if (isDefaultWidgets(widgets)) {
    params.delete(DASHBOARD_SHARE_WIDGETS_PARAM)
  } else {
    params.set(DASHBOARD_SHARE_WIDGETS_PARAM, encodeWidgetsParam(widgets))
  }

  const sort = (DASHBOARD_PROJECT_SORTS as readonly string[]).includes(state.sort)
    ? state.sort
    : DEFAULT_DASHBOARD_PROJECT_SORT
  if (sort === DEFAULT_DASHBOARD_PROJECT_SORT) {
    params.delete(DASHBOARD_SHARE_SORT_PARAM)
  } else {
    params.set(DASHBOARD_SHARE_SORT_PARAM, String(DASHBOARD_PROJECT_SORTS.indexOf(sort)))
  }

  return params
}

/**
 * Absolute share URL for the current dashboard view. `window` is only touched
 * when the factory runs (on click), matching `AgentRunShareButton`.
 */
export function dashboardShareHref(
  state: { widgets: DashboardWidgetConfig; sort: DashboardProjectSort },
  pathname: string,
  search: string,
): string {
  const query = dashboardShareParams(state, search).toString()
  const origin = typeof window === "undefined" ? "" : window.location.origin
  return `${origin}${pathname}${query ? `?${query}` : ""}`
}
