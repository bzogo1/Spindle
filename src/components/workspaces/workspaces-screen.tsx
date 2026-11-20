"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Building2, Plus } from "lucide-react"

import { EmptyState } from "@/components/app/states/empty-state"
import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"
import { loadSession } from "@/lib/auth/auth-client"

/**
 * "Your workspaces" screen for `/app/workspaces`: lists every workspace
 * membership from `GET /api/workspaces` with role and active-state badges,
 * a Switch action per row (POST `/api/workspaces/{id}/switch`, then a session
 * refetch + `router.refresh()` so the whole shell picks up the new active
 * workspace), quick links into each workspace's settings/members/audit
 * pages, and a Create button pointing at `/app/workspaces/new`.
 */

const WORKSPACES_API = "/api/workspaces"
const NEW_WORKSPACE_HREF = "/app/workspaces/new"

interface WorkspaceEntry {
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

export function WorkspacesScreen() {
  const router = useRouter()
  const { toast } = useToast()
  const [workspaces, setWorkspaces] = useState<WorkspaceEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [switchingId, setSwitchingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const response = await fetch(WORKSPACES_API, { cache: "no-store" })
      const data = (await response.json()) as WorkspacesResponse
      if (!response.ok || !data.ok) {
        setError(data.message ?? "Could not load your workspaces.")
        setWorkspaces([])
        return
      }
      setWorkspaces(data.workspaces ?? [])
    } catch {
      setError("Could not load your workspaces. Check your connection and try again.")
      setWorkspaces([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function switchTo(target: WorkspaceEntry) {
    if (switchingId || target.active) return
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
      // The session workspace is resolved server-side per request: refetch
      // the session so providers update, then refresh RSC for server data.
      try {
        await loadSession()
      } catch {
        // Non-fatal — the next scheduled session refresh catches up.
      }
      router.refresh()
      toast({
        title: `Switched to ${target.name}`,
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

  const loading = workspaces === null && error === null
  const empty = workspaces !== null && workspaces.length === 0

  return (
    <section className="app-panel" aria-labelledby="workspaces-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="workspaces-heading">Your workspaces</h2>
          <p>
            Every workspace you belong to. Switching changes which workspace your projects, members,
            and settings belong to.
          </p>
        </div>
        <div className="app-panel-head-actions">
          <Button asChild size="sm">
            <Link href={NEW_WORKSPACE_HREF}>
              <Plus aria-hidden="true" />
              Create workspace
            </Link>
          </Button>
        </div>
      </div>

      {error ? (
        <InlineError
          title="Workspaces unavailable"
          message={
            <span className="flex flex-wrap items-center gap-2">
              <span>{error}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                Retry
              </Button>
            </span>
          }
        />
      ) : null}

      {loading ? (
        <LoadingPanel label="Loading workspaces" variant="table" />
      ) : empty ? (
        <EmptyState
          icon={<Building2 aria-hidden="true" />}
          title="No workspaces yet"
          body="Create a workspace to group your projects, members, and settings."
          primaryAction={{
            label: "Create workspace",
            href: NEW_WORKSPACE_HREF,
            icon: <Plus aria-hidden="true" />,
          }}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Workspace</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {workspaces?.map((entry) => (
              <TableRow key={entry.id} data-active={entry.active || undefined}>
                <TableCell>
                  <div className="grid gap-0.5">
                    <span className="font-medium">{entry.name}</span>
                    <span className="text-muted-foreground font-mono text-xs">{entry.slug}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary" size="sm">
                    {entry.role}
                  </Badge>
                </TableCell>
                <TableCell>
                  {entry.active ? (
                    <Badge variant="default" size="sm">
                      Active
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground text-sm">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1">
                    {entry.active ? (
                      <span className="text-muted-foreground text-sm">Current workspace</span>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        disabled={switchingId !== null}
                        onClick={() => void switchTo(entry)}
                      >
                        {switchingId === entry.id ? "Switching…" : "Switch"}
                      </Button>
                    )}
                    <Button asChild variant="ghost" size="xs">
                      <Link href={`/app/workspaces/${entry.id}/settings`}>Settings</Link>
                    </Button>
                    <Button asChild variant="ghost" size="xs">
                      <Link href={`/app/workspaces/${entry.id}/members`}>Members</Link>
                    </Button>
                    <Button asChild variant="ghost" size="xs">
                      <Link href={`/app/workspaces/${entry.id}/audit`}>Audit</Link>
                    </Button>
                    <Button asChild variant="ghost" size="xs">
                      <Link href={`/app/workspaces/${entry.id}/billing`}>Billing</Link>
                    </Button>
                    <Button asChild variant="ghost" size="xs">
                      <Link href={`/app/workspaces/${entry.id}/export`}>Export</Link>
                    </Button>
                    <Button asChild variant="ghost" size="xs">
                      <Link href={`/app/workspaces/${entry.id}/domain`}>Domain</Link>
                    </Button>
                    <Button asChild variant="ghost" size="xs">
                      <Link href={`/app/workspaces/${entry.id}/branding`}>Branding</Link>
                    </Button>
                    <Button asChild variant="ghost" size="xs">
                      <Link href={`/app/workspaces/${entry.id}/sso`}>SSO</Link>
                    </Button>
                    <Button asChild variant="ghost" size="xs">
                      <Link href={`/app/workspaces/${entry.id}/directory`}>Directory</Link>
                    </Button>
                    <Button asChild variant="ghost" size="xs">
                      <Link href={`/app/workspaces/${entry.id}/danger`}>Danger</Link>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  )
}
