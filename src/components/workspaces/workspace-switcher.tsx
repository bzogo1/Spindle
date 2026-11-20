"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Check, ChevronsUpDown } from "lucide-react"

import { useMockSession } from "@/components/app/mock-session-provider"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useToast } from "@/components/ui/toast"
import { loadSession } from "@/lib/auth/auth-client"
import { mockAuthEnabled } from "@/lib/auth/mock-session"

/**
 * Workspace switcher for the app top bar.
 *
 * Real mode: lists every membership from `GET /api/workspaces` and POSTs to
 * `/api/workspaces/{id}/switch` on select. The session workspace is resolved
 * server-side per request, so after a successful switch the component
 * refetches `/api/auth/session` via `loadSession()` (which updates
 * `AuthSessionProvider` -> `MockSessionProvider` -> the rest of the shell)
 * and calls `router.refresh()` so server components pick up the new
 * workspace too.
 *
 * Mock mode (`NEXT_PUBLIC_MOCK_AUTH=1`): there is no real session backend, so
 * the switcher keeps the original cookie-session behaviour — it lists the
 * mock workspaces and swaps the displayed workspace locally.
 *
 * Renders nothing while the list is loading or when the caller has no
 * workspaces, so the top bar never shows an empty/broken control.
 */

const WORKSPACES_API = "/api/workspaces"

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

function MockWorkspaceSwitcher() {
  const { workspace, workspaces, switchWorkspace } = useMockSession()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="app-workspace-trigger"
        aria-label={`Switch workspace — ${workspace?.name ?? "Workspace"}`}
      >
        <span className="app-workspace-name">{workspace?.name ?? "Workspace"}</span>
        <ChevronsUpDown className="app-workspace-caret" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="app-menu">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {workspaces.map((option) => (
          <DropdownMenuItem
            key={option.slug}
            onSelect={() => switchWorkspace(option)}
            className="app-menu-item"
          >
            <span className="app-menu-item-label">{option.name}</span>
            {option.slug === workspace?.slug ? (
              <Check className="app-menu-check" aria-hidden="true" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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

  if (!workspaces || workspaces.length === 0) return null

  const active = workspaces.find((entry) => entry.active) ?? workspaces[0]

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        // Refresh on open so the active marker and membership list stay
        // current after switches made elsewhere (another tab, settings page).
        if (open) void load()
      }}
    >
      <DropdownMenuTrigger
        className="app-workspace-trigger"
        aria-label={`Switch workspace — ${active.name}`}
      >
        <span className="app-workspace-name">{active.name}</span>
        <ChevronsUpDown className="app-workspace-caret" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="app-menu">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {workspaces.map((entry) => (
          <DropdownMenuItem
            key={entry.id}
            disabled={switchingId !== null}
            onSelect={() => void switchTo(entry)}
            className="app-menu-item"
          >
            <span className="app-menu-item-label">{entry.name}</span>
            <span className="text-muted-foreground text-xs">{entry.role}</span>
            {entry.active ? <Check className="app-menu-check" aria-hidden="true" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function WorkspaceSwitcher() {
  return mockAuthEnabled ? <MockWorkspaceSwitcher /> : <ApiWorkspaceSwitcher />
}
