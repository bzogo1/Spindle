"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowDown, ArrowUp } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"

/**
 * Dashboard widget customization. The dashboard is composed of fixed
 * sections; this module lets users show/hide each section and reorder them.
 * The layout has three zones — a full-width stats row (`top`), a main
 * column (`main`), and a sidebar (`sidebar`) — matching how
 * `dashboard-screen.tsx` renders them. `order` is always kept grouped by
 * zone (stats and projects are singletons, so only sidebar widgets can
 * actually move); reordering across a zone boundary is a no-op both here
 * and in the customize dialog.
 *
 * Preferences persist to localStorage under a versioned key and sync across
 * tabs via the `storage` event, mirroring `AppNotificationsProvider`.
 */

export const DASHBOARD_WIDGET_IDS = [
  "stats",
  "projects",
  "activity",
  "storage",
  "quick-actions",
] as const
export type DashboardWidgetId = (typeof DASHBOARD_WIDGET_IDS)[number]

export interface DashboardWidgetDef {
  id: DashboardWidgetId
  title: string
  description: string
}

export const DASHBOARD_WIDGETS: readonly DashboardWidgetDef[] = [
  {
    id: "stats",
    title: "Summary stats",
    description: "Project, storage, and agent run totals.",
  },
  {
    id: "projects",
    title: "Projects",
    description: "Search, sort, and open a project home.",
  },
  {
    id: "activity",
    title: "Recent activity",
    description: "Latest project, file, lab, chat, and agent events.",
  },
  {
    id: "storage",
    title: "Storage",
    description: "Workspace file and compute checkpoint usage.",
  },
  {
    id: "quick-actions",
    title: "Quick actions",
    description: "Shortcuts to common tasks.",
  },
]

/** Widgets rendered in the right-hand sidebar column, in default order. */
export const DASHBOARD_SIDEBAR_WIDGET_IDS = [
  "activity",
  "storage",
  "quick-actions",
] as const satisfies readonly DashboardWidgetId[]

/**
 * Layout zones the dashboard renders widgets into. `top` is the full-width
 * stats row, `main` the projects column, and `sidebar` the right-hand column
 * (`DASHBOARD_SIDEBAR_WIDGET_IDS`). Widgets only reorder within their zone.
 */
export type DashboardWidgetZone = "top" | "main" | "sidebar"

export interface DashboardWidgetZoneDef {
  id: DashboardWidgetZone
  title: string
  description: string
}

export const DASHBOARD_WIDGET_ZONES: readonly DashboardWidgetZoneDef[] = [
  {
    id: "top",
    title: "Top row",
    description: "Full-width summary stats above the columns.",
  },
  {
    id: "main",
    title: "Main column",
    description: "The projects list.",
  },
  {
    id: "sidebar",
    title: "Sidebar",
    description: "Right-hand column widgets; these reorder with the arrows.",
  },
]

const ZONE_BY_WIDGET: Record<DashboardWidgetId, DashboardWidgetZone> = {
  stats: "top",
  projects: "main",
  activity: "sidebar",
  storage: "sidebar",
  "quick-actions": "sidebar",
}

/** Zone rank used to keep `order` grouped: top, then main, then sidebar. */
const ZONE_RANK: Record<DashboardWidgetZone, number> = { top: 0, main: 1, sidebar: 2 }

export function dashboardWidgetZone(id: DashboardWidgetId): DashboardWidgetZone {
  return ZONE_BY_WIDGET[id]
}

/** Versioned localStorage key for the persisted widget config. */
export const DASHBOARD_WIDGETS_STORAGE_KEY = "spindle-dashboard-widgets:v1"

export interface DashboardWidgetConfig {
  /** Full ordering of every widget id; missing ids are appended in default order on sanitize. */
  order: DashboardWidgetId[]
  /** Widget ids the user has hidden. */
  hidden: DashboardWidgetId[]
}

export function defaultDashboardWidgets(): DashboardWidgetConfig {
  return {
    order: [...DASHBOARD_WIDGET_IDS],
    hidden: [],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isWidgetId(value: unknown): value is DashboardWidgetId {
  return typeof value === "string" && (DASHBOARD_WIDGET_IDS as readonly string[]).includes(value)
}

/**
 * Merge an untrusted value (localStorage blob, cross-tab storage event) over
 * the defaults so a corrupt or partial payload can never produce an invalid
 * config: unknown ids are dropped, duplicates removed, and any missing widget
 * is appended in its default position.
 */
export function sanitizeDashboardWidgets(value: unknown): DashboardWidgetConfig {
  const defaults = defaultDashboardWidgets()
  if (!isRecord(value)) return defaults

  const order: DashboardWidgetId[] = []
  const seen = new Set<DashboardWidgetId>()
  if (Array.isArray(value.order)) {
    for (const entry of value.order) {
      if (isWidgetId(entry) && !seen.has(entry)) {
        seen.add(entry)
        order.push(entry)
      }
    }
  }
  for (const id of defaults.order) {
    if (!seen.has(id)) order.push(id)
  }
  // Canonicalize into zone order (top, main, sidebar). The sort is stable, so
  // the relative order inside each zone is preserved while any cross-zone
  // interleaving from a hand-edited or legacy blob is normalized away.
  order.sort((a, b) => ZONE_RANK[dashboardWidgetZone(a)] - ZONE_RANK[dashboardWidgetZone(b)])

  const hidden: DashboardWidgetId[] = []
  const hiddenSeen = new Set<DashboardWidgetId>()
  if (Array.isArray(value.hidden)) {
    for (const entry of value.hidden) {
      if (isWidgetId(entry) && !hiddenSeen.has(entry)) {
        hiddenSeen.add(entry)
        hidden.push(entry)
      }
    }
  }

  return { order, hidden }
}

function readStoredDashboardWidgets(): DashboardWidgetConfig {
  if (typeof window === "undefined") return defaultDashboardWidgets()
  try {
    const raw = window.localStorage.getItem(DASHBOARD_WIDGETS_STORAGE_KEY)
    if (!raw) return defaultDashboardWidgets()
    return sanitizeDashboardWidgets(JSON.parse(raw))
  } catch {
    return defaultDashboardWidgets()
  }
}

export interface DashboardWidgetsApi {
  config: DashboardWidgetConfig
  isVisible: (id: DashboardWidgetId) => boolean
  setVisible: (id: DashboardWidgetId, visible: boolean) => void
  /** Move a widget one step earlier (-1) or later (+1) within its zone. */
  move: (id: DashboardWidgetId, direction: -1 | 1) => void
  reset: () => void
}

/**
 * Widget show/hide + order state for the dashboard. Starts at the defaults on
 * both server and client so the first render hydrates cleanly; the stored
 * blob is applied in a mount effect, then persisted back on every change and
 * synced across tabs via the `storage` event.
 *
 * `sharedConfig` (decoded from shareable-link URL params by
 * `dashboard-share.ts`) takes precedence over the stored blob for the view.
 * A shared view is ephemeral: it is never written back to localStorage and
 * ignores cross-tab `storage` events, so opening someone's link does not
 * overwrite the recipient's own customization.
 */
export function useDashboardWidgets(sharedConfig?: DashboardWidgetConfig): DashboardWidgetsApi {
  const [config, setConfig] = useState<DashboardWidgetConfig>(defaultDashboardWidgets)
  // Mirror for the once-subscribed storage listener (kept out of its deps).
  const sharedRef = useRef<DashboardWidgetConfig | undefined>(sharedConfig)

  useEffect(() => {
    sharedRef.current = sharedConfig
  }, [sharedConfig])

  // Restore the persisted config after mount — or apply the shared-link
  // override when present. This effect must run BEFORE the persist effect
  // below: on the first commit both see the default state, so the persist
  // effect briefly rewrites defaults — harmless because this effect already
  // captured the stored value, and the next render persists the restored
  // config back (same pattern as `useDashboardLayout`).
  useEffect(() => {
    setConfig(sharedConfig ? sanitizeDashboardWidgets(sharedConfig) : readStoredDashboardWidgets())
  }, [sharedConfig])

  useEffect(() => {
    // Shared-link views are read-only with respect to storage.
    if (sharedConfig) return
    try {
      window.localStorage.setItem(DASHBOARD_WIDGETS_STORAGE_KEY, JSON.stringify(config))
    } catch {
      // Storage can be unavailable (private mode); the config still applies
      // for this session via React state.
    }
  }, [config, sharedConfig])

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      // A shared view stays pinned to the link's params.
      if (sharedRef.current) return
      // `key === null` means localStorage.clear() ran in another tab — treat
      // it as a reset to defaults.
      if (event.key === null) {
        setConfig(defaultDashboardWidgets())
        return
      }
      if (event.key !== DASHBOARD_WIDGETS_STORAGE_KEY) return
      if (event.newValue === null) {
        setConfig(defaultDashboardWidgets())
        return
      }
      try {
        setConfig(sanitizeDashboardWidgets(JSON.parse(event.newValue)))
      } catch {
        // Corrupt payload from another tab — keep current config.
      }
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  const isVisible = useCallback(
    (id: DashboardWidgetId) => !config.hidden.includes(id),
    [config.hidden],
  )

  const setVisible = useCallback((id: DashboardWidgetId, visible: boolean) => {
    setConfig((current) =>
      sanitizeDashboardWidgets({
        order: current.order,
        hidden: visible
          ? current.hidden.filter((entry) => entry !== id)
          : [...current.hidden.filter((entry) => entry !== id), id],
      }),
    )
  }, [])

  const move = useCallback((id: DashboardWidgetId, direction: -1 | 1) => {
    setConfig((current) => {
      const index = current.order.indexOf(id)
      const target = index + direction
      if (index === -1 || target < 0 || target >= current.order.length) return current
      // Reordering is scoped to the widget's zone: the dashboard renders each
      // zone in a fixed position, so a swap across a zone boundary would
      // persist but have no visual effect — treat it as a no-op.
      if (dashboardWidgetZone(current.order[target]) !== dashboardWidgetZone(id)) {
        return current
      }
      const order = [...current.order]
      ;[order[index], order[target]] = [order[target], order[index]]
      return { ...current, order }
    })
  }, [])

  const reset = useCallback(() => setConfig(defaultDashboardWidgets()), [])

  return { config, isVisible, setVisible, move, reset }
}

export interface DashboardCustomizeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  widgets: DashboardWidgetsApi
}

/**
 * "Customize dashboard" dialog: widgets grouped by layout zone, each with a
 * checkbox plus up/down reorder controls where the zone allows reordering.
 * Driven entirely by props so the owning screen's hook instance is
 * the single source of truth (same-tab writes do not fire `storage` events).
 */
export function DashboardCustomizeDialog({
  open,
  onOpenChange,
  widgets,
}: DashboardCustomizeDialogProps) {
  const { config, setVisible, move, reset } = widgets

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Customize dashboard</DialogTitle>
          <DialogDescription>
            Choose which sections appear. Sidebar widgets reorder with the arrow buttons; stats and
            projects stay in their fixed positions.
          </DialogDescription>
        </DialogHeader>

        {DASHBOARD_WIDGET_ZONES.map((zone) => {
          const zoneIds = config.order.filter((id) => dashboardWidgetZone(id) === zone.id)
          if (zoneIds.length === 0) return null
          // Only zones with more than one widget can reorder; singleton zones
          // (stats, projects) render as fixed.
          const reorderable = zoneIds.length > 1
          return (
            <section key={zone.id} className="app-widget-zone" aria-label={zone.title}>
              <h3 className="app-widget-zone-title">{zone.title}</h3>
              <p className="app-widget-zone-desc">{zone.description}</p>
              <ul className="app-widget-list">
                {zoneIds.map((id) => {
                  const widget = DASHBOARD_WIDGETS.find((entry) => entry.id === id)
                  if (!widget) return null
                  const visible = !config.hidden.includes(id)
                  const position = zoneIds.indexOf(id)
                  const checkboxId = `dashboard-widget-${id}`
                  return (
                    <li key={id} className="app-widget-row">
                      <Checkbox
                        id={checkboxId}
                        checked={visible}
                        onCheckedChange={(checked) => setVisible(id, checked === true)}
                      />
                      <Label htmlFor={checkboxId} className="app-widget-label">
                        <strong>{widget.title}</strong>
                        <small>{widget.description}</small>
                      </Label>
                      {reorderable ? (
                        <div className="app-widget-reorder">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            aria-label={`Move ${widget.title} up`}
                            disabled={position === 0}
                            onClick={() => move(id, -1)}
                          >
                            <ArrowUp aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            aria-label={`Move ${widget.title} down`}
                            disabled={position === zoneIds.length - 1}
                            onClick={() => move(id, 1)}
                          >
                            <ArrowDown aria-hidden="true" />
                          </Button>
                        </div>
                      ) : (
                        <span className="app-widget-fixed">Fixed position</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={reset}>
            Reset to default
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
