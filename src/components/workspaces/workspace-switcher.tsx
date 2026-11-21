"use client"

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react"
import { useRouter } from "next/navigation"
import { Check, ChevronsUpDown, Plus, Search } from "lucide-react"

import { useMockSession } from "@/components/app/mock-session-provider"
import { useToast } from "@/components/ui/toast"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { CreateWorkspaceDialog, slugifyWorkspace } from "./create-workspace-dialog"
import { loadSession } from "@/lib/auth/auth-client"
import { mockAuthEnabled } from "@/lib/auth/mock-session"
import type { MockSessionWorkspace } from "@/lib/auth/mock-session"

/**
 * Workspace switcher for the app top bar: a searchable dropdown that filters
 * workspaces by name, marks the active one, and offers a "Create workspace"
 * quick action that opens a modal.
 *
 * Real mode: lists every membership from `GET /api/workspaces`, POSTs to
 * `/api/workspaces/{id}/switch` on select, and POSTs `{ name }` to
 * `/api/workspaces` from the create dialog. The session workspace is
 * resolved server-side per request, so after a successful switch or create
 * the component refetches `/api/auth/session` via `loadSession()` (which
 * updates `AuthSessionProvider` -> `MockSessionProvider` -> the rest of the
 * shell) and calls `router.refresh()` so server components pick up the new
 * workspace too.
 *
 * Mock mode (`NEXT_PUBLIC_MOCK_AUTH=1`): there is no real session backend, so
 * the switcher keeps the original cookie-session behaviour — it lists the
 * mock workspaces, swaps the displayed workspace locally, and "creates"
 * workspaces into component-local state.
 *
 * Renders nothing while the list is loading or when the caller has no
 * workspaces, so the top bar never shows an empty/broken control.
 */

const WORKSPACES_API = "/api/workspaces"
const NAME_MAX = 80

export interface WorkspaceEntry {
  id: string
  name: string
  slug: string
  role: string
  active: boolean
}

interface WorkspacesResponse {
  ok: boolean
  workspaces?: WorkspaceEntry[]
  workspace?: WorkspaceEntry
  message?: string
}

interface SwitchResponse {
  ok: boolean
  message?: string
}

/** Shared post-switch refresh: session refetch + server-component refresh. */
async function refreshAfterSwitch(router: ReturnType<typeof useRouter>) {
  try {
    await loadSession()
  } catch {
    // A failed session refetch must not mask a successful switch; the next
    // scheduled refresh/token rotation will pick the new workspace up.
  }
  router.refresh()
}

/** One row in the switcher dropdown, normalized across mock and API modes. */
interface WorkspaceMenuItem {
  key: string
  name: string
  detail?: string
  active: boolean
}

function filterByName(items: WorkspaceMenuItem[], query: string): WorkspaceMenuItem[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return items
  return items.filter((item) => item.name.toLowerCase().includes(normalized))
}

/**
 * Shared searchable dropdown. Owns the search query, the open state, and the
 * create-workspace dialog; the parent supplies the rows and the select/create
 * handlers so mock and API modes share one UI.
 */
function WorkspaceMenu({
  activeName,
  items,
  selecting,
  onOpen,
  onSelect,
  onCreate,
}: {
  activeName: string
  items: WorkspaceMenuItem[]
  /** Key of the row currently being switched to, if any. */
  selecting: string | null
  /** Called when the menu opens (API mode refetches memberships here). */
  onOpen?: () => void
  onSelect: (item: WorkspaceMenuItem) => void
  /** Creates a workspace by name; resolves on success, throws on failure. */
  onCreate: (name: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  const filtered = filterByName(items, query)

  // Keep focus in the search field: Radix moves focus into the menu content
  // on open, so refocus on the next frame once that has settled.
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => searchRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open])

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next) {
      setQuery("")
      onOpen?.()
    }
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Printable keys must not trigger the menu's typeahead; everything else
    // (Escape, arrows, Enter) keeps bubbling so Radix dismissal still works.
    if (event.key.length === 1) event.stopPropagation()
  }

  return (
    <>
      <DropdownMenu open={open} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger
          className="app-workspace-trigger"
          aria-label={`Switch workspace — ${activeName}`}
        >
          <span className="app-workspace-name">{activeName}</span>
          <ChevronsUpDown className="app-workspace-caret" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="app-menu" aria-label="Switch workspace">
          <div className="app-project-switcher-search">
            <Search aria-hidden="true" />
            <Input
              ref={searchRef}
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder="Search workspaces"
              aria-label="Search workspaces"
              className="app-command-input-field"
            />
          </div>
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {filtered.length === 0 ? (
            <p className="app-command-empty">
              {items.length === 0 ? "No workspaces yet." : `No workspaces match “${query.trim()}”.`}
            </p>
          ) : (
            filtered.map((item) => (
              <DropdownMenuItem
                key={item.key}
                disabled={selecting !== null}
                onSelect={() => onSelect(item)}
                className="app-menu-item"
              >
                <span className="app-menu-item-label">{item.name}</span>
                {item.detail ? (
                  <span className="text-muted-foreground text-xs">{item.detail}</span>
                ) : null}
                {item.active ? <Check className="app-menu-check" aria-hidden="true" /> : null}
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreateOpen(true)} className="app-menu-item">
            <Plus aria-hidden="true" />
            <span className="app-menu-item-label">Create workspace</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} onCreate={onCreate} />
    </>
  )
}

function uniqueSlug(base: string, taken: Set<string>): string {
  let slug = base
  let suffix = 2
  while (taken.has(slug)) {
    slug = `${base}-${suffix}`
    suffix += 1
  }
  return slug
}

function MockWorkspaceSwitcher() {
  const { workspace, workspaces, switchWorkspace } = useMockSession()
  const { toast } = useToast()
  // Workspaces "created" in mock mode live only in component state — there
  // is no backend to persist them to.
  const [created, setCreated] = useState<MockSessionWorkspace[]>([])

  const all = [...workspaces, ...created]
  const items: WorkspaceMenuItem[] = all.map((option) => ({
    key: option.slug,
    name: option.name,
    active: option.slug === workspace?.slug,
  }))

  async function handleCreate(name: string) {
    if (name.length > NAME_MAX)
      throw new Error(`Workspace names are limited to ${NAME_MAX} characters.`)
    const taken = new Set(all.map((option) => option.slug))
    const next: MockSessionWorkspace = {
      name,
      slug: uniqueSlug(slugifyWorkspace(name), taken),
    }
    setCreated((current) => [...current, next])
    switchWorkspace(next)
    toast({
      title: "Workspace created",
      description: `“${name}” is ready to use.`,
      variant: "success",
    })
  }

  if (items.length === 0) return null

  return (
    <WorkspaceMenu
      activeName={workspace?.name ?? "Workspace"}
      items={items}
      selecting={null}
      onSelect={(item) => {
        const target = all.find((option) => option.slug === item.key)
        if (target) switchWorkspace(target)
      }}
      onCreate={handleCreate}
    />
  )
}

function ApiWorkspaceSwitcher() {
  const router = useRouter()
  const { toast } = useToast()
  const [workspaces, setWorkspaces] = useState<WorkspaceEntry[] | null>(null)
  const [switchingId, setSwitchingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch(WORKSPACES_API, { cache: "no-store" })
      const data = (await response.json()) as WorkspacesResponse
      setWorkspaces(response.ok && data.ok ? (data.workspaces ?? []) : [])
    } catch {
      setWorkspaces([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function switchTo(target: WorkspaceEntry) {
    if (switchingId) return
    setSwitchingId(target.id)
    try {
      const response = await fetch(`${WORKSPACES_API}/${target.id}/switch`, {
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
      setWorkspaces(
        (current) =>
          current?.map((entry) => ({ ...entry, active: entry.id === target.id })) ?? current,
      )
      await refreshAfterSwitch(router)
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

  async function createWorkspace(name: string) {
    const response = await fetch(WORKSPACES_API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    })
    const data = (await response.json().catch(() => ({}))) as WorkspacesResponse
    if (!response.ok || !data.ok || !data.workspace) {
      throw new Error(data.message ?? "Could not create the workspace. Try again.")
    }
    const created = data.workspace
    setWorkspaces((current) =>
      current
        ? [
            ...current.map((entry) => ({ ...entry, active: entry.id === created.id })),
            ...(current.some((entry) => entry.id === created.id) ? [] : [created]),
          ]
        : [created],
    )
    toast({
      title: "Workspace created",
      description: `“${created.name}” is ready to use.`,
      variant: "success",
    })
    // The new workspace is the session's active workspace server-side; pull
    // the fresh session and refresh server components like a switch does.
    await refreshAfterSwitch(router)
  }

  if (!workspaces || workspaces.length === 0) return null

  const active = workspaces.find((entry) => entry.active) ?? workspaces[0]
  const byKey = new Map(workspaces.map((entry) => [entry.id, entry]))
  const items: WorkspaceMenuItem[] = workspaces.map((entry) => ({
    key: entry.id,
    name: entry.name,
    detail: entry.role,
    active: entry.active,
  }))

  return (
    <WorkspaceMenu
      activeName={active.name}
      items={items}
      selecting={switchingId}
      onOpen={() => void load()}
      onSelect={(item) => {
        const target = byKey.get(item.key)
        if (target) void switchTo(target)
      }}
      onCreate={createWorkspace}
    />
  )
}

export function WorkspaceSwitcher() {
  return mockAuthEnabled ? <MockWorkspaceSwitcher /> : <ApiWorkspaceSwitcher />
}
