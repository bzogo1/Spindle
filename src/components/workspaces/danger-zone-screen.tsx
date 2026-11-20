"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AlertTriangle, Download } from "lucide-react"

import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"

/**
 * Danger zone screen for `/app/workspaces/[id]/danger`.
 *
 * Loads `GET /api/workspaces/{id}` for the workspace name and the caller's
 * role. Only owners get the deletion form: a type-the-name-to-confirm input
 * gates a two-step inline confirm (arm → permanently delete) that POSTs to
 * `/api/workspaces/{id}/delete`. On success the user is redirected to
 * `/app/workspaces` with a success toast. Admins and members see an
 * explanatory note instead of the form.
 */

interface WorkspaceInfo {
  id: string
  name: string
  slug: string
}

interface WorkspaceResponse {
  ok: boolean
  workspace?: WorkspaceInfo
  role?: string
  message?: string
}

interface DeleteResponse {
  ok: boolean
  message?: string
}

export function DangerZoneScreen({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
  const { toast } = useToast()
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState("")
  const [armed, setArmed] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}`, { cache: "no-store" })
      const data = (await response.json()) as WorkspaceResponse
      // Defensive read: the payload nests workspace info under `workspace`.
      const info = data.workspace
      if (!response.ok || !data.ok || !info || typeof info.name !== "string") {
        setError(data.message ?? "Could not load this workspace.")
        setWorkspace(null)
        setRole(null)
        return
      }
      setWorkspace(info)
      setRole(data.role ?? null)
    } catch {
      setError("Could not load this workspace. Check your connection and try again.")
      setWorkspace(null)
      setRole(null)
    }
  }, [workspaceId])

  useEffect(() => {
    void load()
  }, [load])

  const isOwner = role === "owner"
  const nameMatches =
    workspace !== null && confirmation === workspace.name && workspace.name.length > 0

  async function deleteWorkspace() {
    if (!workspace || !nameMatches || deleting) return
    setDeleting(true)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/delete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation: workspace.name }),
      })
      const data = (await response.json()) as DeleteResponse
      if (!response.ok || !data.ok) {
        toast({
          title: "Couldn't delete workspace",
          description: data.message ?? "Please try again.",
          variant: "error",
        })
        setArmed(false)
        return
      }
      toast({
        title: "Workspace deleted",
        description: `"${workspace.name}" and all of its data were permanently removed.`,
        variant: "success",
      })
      router.push("/app/workspaces")
    } catch {
      toast({
        title: "Couldn't delete workspace",
        description: "Check your connection and try again.",
        variant: "error",
      })
      setArmed(false)
    } finally {
      setDeleting(false)
    }
  }

  const loading = workspace === null && error === null

  return (
    <section className="app-page-card" aria-labelledby="danger-zone-heading">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="danger-zone-heading">Danger zone</h2>
        {role ? (
          <Badge variant="secondary" size="sm">
            {role}
          </Badge>
        ) : null}
      </div>

      {error ? (
        <InlineError
          title="Workspace unavailable"
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

      {loading ? <LoadingPanel label="Loading workspace" variant="table" /> : null}

      {workspace && !error ? (
        <>
          <div
            className="border-destructive/40 bg-destructive/5 rounded-md border p-3 text-sm"
            role="note"
          >
            <p className="text-destructive flex items-start gap-2 font-medium">
              <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              Deleting this workspace is permanent and cannot be undone.
            </p>
            <ul className="text-muted-foreground mt-2 list-disc space-y-1 pl-6">
              <li>
                <strong className="text-foreground">{workspace.name}</strong> and everything in it —
                projects, members, settings, and audit history references — will be removed for
                good.
              </li>
              <li>Every member loses access to this workspace immediately.</li>
              <li>
                Anyone signed in with this workspace active will be moved back to their home
                workspace automatically.
              </li>
            </ul>
            <p className="mt-2">
              <Link
                href={`/app/workspaces/${workspaceId}/export`}
                className="text-primary inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline"
              >
                <Download aria-hidden="true" className="size-4" />
                Download workspace data first
              </Link>{" "}
              — export everything before you delete.
            </p>
          </div>

          {isOwner ? (
            <div className="grid gap-2.5">
              <div className="app-field">
                <label htmlFor="delete-confirmation">
                  Type <strong>{workspace.name}</strong> to confirm
                </label>
                <input
                  id="delete-confirmation"
                  type="text"
                  value={confirmation}
                  autoComplete="off"
                  disabled={deleting}
                  onChange={(event) => {
                    setConfirmation(event.target.value)
                    setArmed(false)
                  }}
                />
                <p className="app-field-hint">
                  The name must match exactly, including capitalization and spacing.
                </p>
              </div>

              {armed ? (
                <div
                  className="border-destructive/40 bg-destructive/5 flex flex-wrap items-center gap-2 rounded-md border p-3"
                  role="alert"
                >
                  <p className="text-destructive text-sm font-medium">
                    This will permanently delete {workspace.name}. This cannot be undone.
                  </p>
                  <div className="ml-auto flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setArmed(false)}
                      disabled={deleting}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => void deleteWorkspace()}
                      disabled={deleting}
                    >
                      {deleting ? "Deleting…" : "Permanently delete"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => setArmed(true)}
                    disabled={!nameMatches || deleting}
                  >
                    Delete workspace
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm" role="note">
              Only the workspace owner can delete {workspace.name}. You&apos;re a {role ?? "member"}{" "}
              of this workspace, so the deletion controls are hidden.
            </p>
          )}
        </>
      ) : null}
    </section>
  )
}
