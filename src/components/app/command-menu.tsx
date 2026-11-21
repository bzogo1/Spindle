"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { CSSProperties } from "react"
import { usePathname, useRouter } from "next/navigation"
import { Keyboard, LogOut, Plus, Search, SunMoon, Users } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { List, useDynamicRowHeight } from "react-window"
import type { ListImperativeAPI } from "react-window"

import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/toast"
import { useMockSession } from "@/components/app/mock-session-provider"
import { NAV_ITEMS } from "@/components/app/nav-items"
import { useAppTheme } from "@/components/app/use-app-theme"
import type { WorkspaceEntry } from "@/components/workspaces/workspace-switcher"
import { loadSession } from "@/lib/auth/auth-client"
import { mockAuthEnabled } from "@/lib/auth/mock-session"
import type { SearchItem } from "@/lib/search"
import {
  createActionsProvider,
  createChangelogProvider,
  createDocsProvider,
  createFilesProvider,
  createPagesProvider,
  createProjectsProvider,
  type SearchActionSpec,
} from "@/lib/search/providers"
import { recentIds, recordUse } from "@/lib/search/recency"
import { useSearchIndex } from "@/lib/search/use-search-index"
import { OPEN_NEW_PROJECT_EVENT, OPEN_NEW_PROJECT_STORAGE_KEY } from "./new-project-events"
import { OPEN_SHORTCUTS_EVENT } from "./app-shell-events"

// Cross-component signal for the dashboard's "New project" dialog. The event
// names live in ./new-project-events so dashboard-screen can subscribe
// without importing this lazily-loaded module; re-exported for compatibility.
export { OPEN_NEW_PROJECT_EVENT, OPEN_NEW_PROJECT_STORAGE_KEY }

const MAX_RECENTS = 5

const WORKSPACES_API = "/api/workspaces"

interface WorkspacesResponse {
  ok: boolean
  workspaces?: WorkspaceEntry[]
  message?: string
}

interface SwitchResponse {
  ok: boolean
  message?: string
}

/** Display order for result groups; "Recent" is prepended when the query is empty. */
const GROUP_ORDER = [
  "Pages",
  "Projects",
  "Files",
  "Docs",
  "Changelog",
  "Actions",
  "Workspaces",
] as const

type CommandGroup = {
  label: string
  items: SearchItem[]
}

/**
 * Flattened row model for the virtualized results list: one header row per
 * group followed by its item rows. `key` doubles as the react-window rowKey.
 */
type CommandRow =
  | { kind: "header"; key: string; label: string }
  | {
      kind: "item"
      key: string
      item: SearchItem
      /** 1-based position among option rows (for aria-posinset). */
      optionIndex: number
    }

type CommandListRowProps = {
  rows: CommandRow[]
  activeId: string | null
  optionCount: number
  onItemHover: (id: string) => void
  onItemActivate: (item: SearchItem) => void
}

/** Estimated heights (px) used until react-window measures real rows. */
function estimateRowHeight(row: CommandRow): number {
  if (row.kind === "header") return 30
  return row.item.subtitle ? 54 : 38
}

function CommandResultRow({
  index,
  style,
  ariaAttributes,
  rows,
  activeId,
  optionCount,
  onItemHover,
  onItemActivate,
}: {
  index: number
  style: CSSProperties
  ariaAttributes: {
    "aria-posinset": number
    "aria-setsize": number
    role: "listitem"
  }
} & CommandListRowProps) {
  const row = rows[index]
  if (!row) return null

  if (row.kind === "header") {
    return (
      <div
        {...ariaAttributes}
        role="group"
        aria-label={row.label}
        className="app-command-group"
        style={style}
      >
        <div className="app-command-group-label">{row.label}</div>
      </div>
    )
  }

  const item = row.item
  const isActive = item.id === activeId
  return (
    <div
      {...ariaAttributes}
      role="option"
      aria-posinset={row.optionIndex}
      aria-setsize={optionCount}
      id={`app-command-option-${item.id}`}
      aria-selected={isActive}
      data-command-id={item.id}
      className={`app-command-item${isActive ? " is-active" : ""}`}
      style={style}
      onMouseMove={() => onItemHover(item.id)}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onItemActivate(item)}
    >
      <span className="app-command-item-icon" aria-hidden="true">
        {item.icon}
      </span>
      <span className="app-command-item-text">
        <span className="app-command-item-label">{item.title}</span>
        {item.subtitle ? (
          <span className="app-command-item-hint">{item.subtitle}</span>
        ) : null}
      </span>
    </div>
  )
}

/** Below this many rows the plain list renders faster than the virtualizer. */
const VIRTUALIZE_MIN_ROWS = 100

/**
 * ⌘K/Ctrl+K command palette backed by the pluggable search index in
 * `src/lib/search`: pages, projects, files, docs, changelog entries, and
 * actions are provided asynchronously, fuzzy-scored with field weights, and
 * boosted by frecency. Built on the Radix dialog primitive used by the app shell.
 */
export function CommandMenu() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [activeId, setActiveId] = useState<string | null>(null)
  /** Bumped whenever recency changes so the Recent group re-derives. */
  const [recentsTick, setRecentsTick] = useState(0)
  const router = useRouter()
  const pathname = usePathname()
  const { workspace, workspaces, switchWorkspace, signOut } = useMockSession()
  const { toast } = useToast()
  const { toggle: toggleTheme } = useAppTheme()
  /** Real-mode workspace memberships from GET /api/workspaces (mock mode uses `workspaces`). */
  const [apiWorkspaces, setApiWorkspaces] = useState<WorkspaceEntry[] | null>(null)
  const [switchingId, setSwitchingId] = useState<string | null>(null)
  /** DOM node of the plain (non-virtualized) results list. */
  const listRef = useRef<HTMLDivElement>(null)
  /** Imperative API of the virtualized results list (react-window). */
  const listApiRef = useRef<ListImperativeAPI | null>(null)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setOpen((current) => !current)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  useEffect(() => {
    if (open) setRecentsTick((tick) => tick + 1)
  }, [open])

  // Real mode mirrors workspace-switcher.tsx: memberships come from
  // GET /api/workspaces and a select POSTs to /api/workspaces/{id}/switch,
  // then refetches the session (loadSession) and router.refresh() so the
  // shell picks up the new active workspace. Mock mode keeps the local
  // switchWorkspace() override.
  const loadApiWorkspaces = useCallback(async () => {
    if (mockAuthEnabled) return
    try {
      const response = await fetch(WORKSPACES_API, { cache: "no-store" })
      const data = (await response.json()) as WorkspacesResponse
      setApiWorkspaces(response.ok && data.ok ? (data.workspaces ?? []) : [])
    } catch {
      setApiWorkspaces([])
    }
  }, [])

  useEffect(() => {
    if (open) void loadApiWorkspaces()
  }, [open, loadApiWorkspaces])

  async function switchWorkspaceApi(targetId: string) {
    if (switchingId) return
    setSwitchingId(targetId)
    try {
      const response = await fetch(`${WORKSPACES_API}/${targetId}/switch`, {
        method: "POST",
      })
      const data = (await response.json()) as SwitchResponse
      if (!response.ok || !data.ok) {
        toast({
          title: "Couldn't switch workspace",
          description: data.message ?? "Please try again.",
          variant: "error",
        })
        return
      }
      setApiWorkspaces(
        (current) =>
          current?.map((entry) => ({ ...entry, active: entry.id === targetId })) ?? current,
      )
      // The session workspace is resolved server-side per request: refetch
      // the session so providers update, then refresh RSC for server data.
      try {
        await loadSession()
      } catch {
        // Non-fatal — the next scheduled session refresh catches up.
      }
      router.refresh()
      const name = apiWorkspaces?.find((entry) => entry.id === targetId)?.name
      toast({
        title: name ? `Switched to ${name}` : "Switched workspace",
        variant: "success",
      })
    } catch {
      toast({
        title: "Couldn't switch workspace",
        description: "Check your connection and try again.",
        variant: "error",
      })
    } finally {
      setSwitchingId(null)
    }
  }

  const switchOptions = useMemo(
    () => (mockAuthEnabled ? workspaces : (apiWorkspaces ?? [])),
    [workspaces, apiWorkspaces],
  )

  const actionSpecs = useMemo<SearchActionSpec[]>(() => {
    const actions: SearchActionSpec[] = [
      {
        id: "action:new-project",
        title: "New project",
        subtitle: "Action",
        keywords: "create",
        icon: <Plus aria-hidden="true" />,
        action: "new-project",
      },
      {
        id: "action:toggle-theme",
        title: "Toggle theme",
        subtitle: "Action",
        icon: <SunMoon aria-hidden="true" />,
        action: "toggle-theme",
      },
      {
        id: "action:keyboard-shortcuts",
        title: "Keyboard shortcuts",
        subtitle: "Action",
        keywords: "help keys hotkeys",
        icon: <Keyboard aria-hidden="true" />,
        action: "keyboard-shortcuts",
      },
    ]
    for (const option of switchOptions) {
      if (option.slug === workspace?.slug) continue
      actions.push({
        id: `workspace:${option.slug}`,
        title: `Switch to ${option.name}`,
        subtitle: "Workspace",
        group: "Workspaces",
        icon: <Users aria-hidden="true" />,
        action: "switch-workspace",
        meta: { slug: option.slug },
      })
    }
    actions.push({
      id: "action:sign-out",
      title: "Sign out",
      subtitle: "Action",
      icon: <LogOut aria-hidden="true" />,
      action: "sign-out",
    })
    return actions
  }, [switchOptions, workspace?.slug])

  const providers = useMemo(
    () => [
      createPagesProvider(
        NAV_ITEMS.map((item) => ({
          label: item.label,
          href: item.href,
          keywords: item.href,
          icon: item.icon,
        })),
      ),
      createProjectsProvider(),
      createFilesProvider(),
      createDocsProvider(),
      createChangelogProvider(),
      createActionsProvider(actionSpecs),
    ],
    [actionSpecs],
  )

  const { results, debouncedQuery, loading, searchNow } = useSearchIndex({
    providers,
    query,
    enabled: open,
  })

  const groups = useMemo<CommandGroup[]>(() => {
    const q = debouncedQuery.trim()
    const result: CommandGroup[] = []

    if (!q) {
      const byId = new Map(results.map((hit) => [hit.item.id, hit.item]))
      const recentItems = recentIds(MAX_RECENTS)
        .map((id) => byId.get(id))
        .filter((item): item is SearchItem => item !== undefined)
      if (recentItems.length > 0) result.push({ label: "Recent", items: recentItems })
    }

    for (const label of GROUP_ORDER) {
      const items = results.filter((hit) => hit.item.group === label).map((hit) => hit.item)
      if (items.length > 0) result.push({ label, items })
    }
    return result
    // recentsTick is intentionally in the deps (but not read in the body) so the
    // Recent group re-derives after recordUse().
  }, [results, debouncedQuery, recentsTick])

  const flatItems = useMemo(() => groups.flatMap((group) => group.items), [groups])

  // Flatten groups into header/item rows for the virtualized list, and keep
  // a item.id → row-index map so keyboard navigation can scrollToRow when the
  // active option isn't currently mounted.
  const { rows, rowsSignature, rowIndexById } = useMemo(() => {
    const nextRows: CommandRow[] = []
    const indexById = new Map<string, number>()
    let optionIndex = 0
    for (const group of groups) {
      nextRows.push({ kind: "header", key: `group:${group.label}`, label: group.label })
      for (const item of group.items) {
        optionIndex += 1
        nextRows.push({ kind: "item", key: `item:${item.id}`, item, optionIndex })
        indexById.set(item.id, nextRows.length - 1)
      }
    }
    return {
      rows: nextRows,
      // Changes whenever the row set changes so measured heights reset.
      rowsSignature: nextRows.map((row) => row.key).join(""),
      rowIndexById: indexById,
    }
  }, [groups])

  const virtualized = rows.length > VIRTUALIZE_MIN_ROWS

  // Dynamic row heights: items with a subtitle are taller than single-line
  // rows. `key` resets the measurement cache whenever results change.
  const rowHeight = useDynamicRowHeight({
    defaultRowHeight: 44,
    initialRowHeights: rows.map(estimateRowHeight),
    key: rowsSignature,
  })

  const rowKey = useCallback(
    (index: number, data: CommandListRowProps) => data.rows[index]?.key ?? index,
    [],
  )

  useEffect(() => {
    setActiveId((current) =>
      current && flatItems.some((item) => item.id === current)
        ? current
        : (flatItems[0]?.id ?? null),
    )
  }, [flatItems])

  useEffect(() => {
    if (!activeId) return
    const root = virtualized ? (listApiRef.current?.element ?? null) : listRef.current
    const element = root?.querySelector(`[data-command-id="${CSS.escape(activeId)}"]`)
    if (element) {
      element.scrollIntoView?.({ block: "nearest" })
      return
    }
    // Virtualized: the active row may be outside the mounted window — ask the
    // list to scroll it into view instead.
    const rowIndex = rowIndexById.get(activeId)
    if (virtualized && rowIndex !== undefined) {
      listApiRef.current?.scrollToRow({ index: rowIndex, align: "auto" })
    }
  }, [activeId, virtualized, rowIndexById])

  function moveActive(direction: 1 | -1) {
    if (flatItems.length === 0) return
    const index = flatItems.findIndex((item) => item.id === activeId)
    const nextIndex =
      index === -1
        ? direction === 1
          ? 0
          : flatItems.length - 1
        : (index + direction + flatItems.length) % flatItems.length
    setActiveId(flatItems[nextIndex]?.id ?? null)
  }

  function runItem(item: SearchItem) {
    if (item.href) {
      router.push(item.href)
      return
    }
    switch (item.action) {
      case "new-project":
        try {
          sessionStorage.setItem(OPEN_NEW_PROJECT_STORAGE_KEY, "1")
        } catch {
          // Private mode: the in-page event below still covers this case.
        }
        window.dispatchEvent(new Event(OPEN_NEW_PROJECT_EVENT))
        if (pathname !== "/dashboard") router.push("/dashboard")
        break
      case "toggle-theme":
        toggleTheme()
        break
      case "keyboard-shortcuts":
        // KeyboardShortcuts owns the shortcuts dialog; it listens for this
        // event so the palette doesn't need a handle on that component.
        window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT))
        break
      case "switch-workspace": {
        const slug = item.meta?.slug
        if (mockAuthEnabled) {
          const target = workspaces.find((option) => option.slug === slug)
          if (target) switchWorkspace(target)
        } else {
          const target = apiWorkspaces?.find((option) => option.slug === slug)
          if (target) void switchWorkspaceApi(target.id)
        }
        break
      }
      case "sign-out":
        signOut()
        break
      default:
        break
    }
  }

  function activateItem(item: SearchItem | undefined) {
    if (!item) return
    recordUse(item.id)
    setRecentsTick((tick) => tick + 1)
    setOpen(false)
    runItem(item)
  }

  function activateActive() {
    // Enter must reflect the latest keystrokes even inside the debounce window,
    // so re-run the search synchronously when the query moved ahead.
    const hits = query.trim() === debouncedQuery.trim() ? results : searchNow(query)
    const items = hits.map((hit) => hit.item)
    activateItem(items.find((item) => item.id === activeId) ?? items[0])
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      moveActive(1)
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      moveActive(-1)
    } else if (event.key === "Enter") {
      event.preventDefault()
      activateActive()
    }
  }

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next) {
      setQuery("")
      setActiveId(null)
    }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <button type="button" className="app-search-trigger" onClick={() => handleOpenChange(true)}>
        <Search aria-hidden="true" />
        <span className="app-search-label">Search</span>
        <kbd className="app-search-kbd" aria-hidden="true">
          ⌘K
        </kbd>
      </button>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="app-overlay" />
        <DialogPrimitive.Content
          className="app-search-dialog app-command-dialog"
          aria-modal="true"
          aria-describedby={undefined}
        >
          <DialogPrimitive.Title className="sr-only">Command menu</DialogPrimitive.Title>
          <div className="app-command-input">
            <Search aria-hidden="true" />
            <Input
              autoFocus
              role="combobox"
              aria-expanded="true"
              aria-controls="app-command-list"
              aria-activedescendant={activeId ? `app-command-option-${activeId}` : undefined}
              aria-autocomplete="list"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="Search pages, projects, files, docs…"
              aria-label="Command menu"
              className="app-command-input-field"
            />
            <kbd className="app-search-kbd" aria-hidden="true">
              esc
            </kbd>
          </div>
          {virtualized ? (
            <List<CommandListRowProps>
              listRef={listApiRef}
              className="app-command-list app-command-list--virtual"
              id="app-command-list"
              role="listbox"
              aria-label="Command results"
              rowCount={rows.length}
              rowComponent={CommandResultRow}
              rowHeight={rowHeight}
              rowKey={rowKey}
              rowProps={{
                rows,
                activeId,
                optionCount: flatItems.length,
                onItemHover: (id) => setActiveId(id),
                onItemActivate: activateItem,
              }}
              overscanCount={8}
              defaultHeight={360}
              style={{ minHeight: 0 }}
            />
          ) : (
            <div
              className="app-command-list"
              role="listbox"
              id="app-command-list"
              aria-label="Command results"
              ref={listRef}
            >
              {flatItems.length === 0 ? (
                loading ? (
                  <p className="app-command-empty" role="status">
                    Loading…
                  </p>
                ) : (
                  <p className="app-command-empty">No results for “{query.trim()}”.</p>
                )
              ) : (
                groups.map((group) => (
                  <div
                    key={group.label}
                    className="app-command-group"
                    role="group"
                    aria-label={group.label}
                  >
                    <div className="app-command-group-label">{group.label}</div>
                    {group.items.map((item) => (
                      <div
                        key={item.id}
                        id={`app-command-option-${item.id}`}
                        role="option"
                        aria-selected={item.id === activeId}
                        data-command-id={item.id}
                        className={`app-command-item${item.id === activeId ? " is-active" : ""}`}
                        onMouseMove={() => setActiveId(item.id)}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => activateItem(item)}
                      >
                        <span className="app-command-item-icon" aria-hidden="true">
                          {item.icon}
                        </span>
                        <span className="app-command-item-text">
                          <span className="app-command-item-label">{item.title}</span>
                          {item.subtitle ? (
                            <span className="app-command-item-hint">{item.subtitle}</span>
                          ) : null}
                        </span>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          )}
          <div className="app-command-footer">
            <span>
              <kbd className="app-search-kbd" aria-hidden="true">
                ↑↓
              </kbd>{" "}
              Navigate
            </span>
            <span>
              <kbd className="app-search-kbd" aria-hidden="true">
                ↵
              </kbd>{" "}
              Select
            </span>
            <span>
              <kbd className="app-search-kbd" aria-hidden="true">
                esc
              </kbd>{" "}
              Close
            </span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
