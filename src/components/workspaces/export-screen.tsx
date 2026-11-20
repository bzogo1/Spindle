"use client"

import { useCallback, useEffect, useState } from "react"
import { Download, FileJson } from "lucide-react"

import { EmptyState } from "@/components/app/states/empty-state"
import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Button } from "@/components/ui/button"

/**
 * Workspace "Export" screen for `/app/workspaces/[id]/export`.
 *
 * The export endpoint (`GET /api/workspaces/[id]/export`) is owner/admin
 * only because the payload contains member PII (emails and names). This
 * screen first loads `GET /api/workspaces/[id]` to learn the caller's role
 * so members see a friendly insufficient-permissions state instead of a
 * failed download. The download itself uses fetch + Blob (same pattern as
 * the settings import/export card) so error responses surface as JSON
 * messages rather than a browser error page.
 */

interface WorkspaceInfoResponse {
  ok: boolean
  workspace?: { id: string; name: string; slug: string }
  role?: string
  memberCount?: number
  message?: string
}

function filenameFromDisposition(header: string | null, fallbackSlug: string): string {
  const match = header?.match(/filename="([^"]+)"/)
  return match?.[1] ?? `workspace-${fallbackSlug}-export.json`
}

export function WorkspaceExportScreen({ workspaceId }: { workspaceId: string }) {
  const [workspace, setWorkspace] = useState<{
    name: string
    slug: string
  } | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [memberCount, setMemberCount] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}`, { cache: "no-store" })
      const data = (await response.json()) as WorkspaceInfoResponse
      if (!response.ok || !data.ok || !data.workspace) {
        setError(data.message ?? "Could not load workspace information.")
        setWorkspace(null)
        setRole(null)
        return
      }
      setWorkspace({ name: data.workspace.name, slug: data.workspace.slug })
      setRole(data.role ?? null)
      setMemberCount(data.memberCount ?? null)
    } catch {
      setError("Could not load workspace information. Check your connection and try again.")
      setWorkspace(null)
      setRole(null)
    }
  }, [workspaceId])

  useEffect(() => {
    void load()
  }, [load])

  const canExport = role === "owner" || role === "admin"
  const loading = workspace === null && error === null

  async function download() {
    if (downloading) return
    setDownloading(true)
    setDownloadError(null)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/export`, {
        cache: "no-store",
      })
      if (!response.ok) {
        let message = "Export failed. Please try again."
        try {
          const data = (await response.json()) as { message?: string }
          if (data.message) message = data.message
        } catch {
          // Non-JSON error body — keep the generic message.
        }
        setDownloadError(message)
        return
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = filenameFromDisposition(
        response.headers.get("content-disposition"),
        workspace?.slug ?? workspaceId,
      )
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch {
      setDownloadError("Export failed. Check your connection and try again.")
    } finally {
      setDownloading(false)
    }
  }

  if (workspace && role && !canExport) {
    return (
      <EmptyState
        icon={<FileJson aria-hidden="true" />}
        title="Insufficient permissions"
        body="Workspace data export is restricted to owners and admins because it contains member personal information. Ask a workspace owner to grant you a higher role."
      />
    )
  }

  return (
    <section className="app-page-card" aria-labelledby="workspace-export-heading">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="workspace-export-heading">Export workspace data</h2>
        {role ? (
          <span className="text-muted-foreground text-sm">
            {workspace?.name}
            {memberCount !== null
              ? ` · ${memberCount} ${memberCount === 1 ? "member" : "members"}`
              : ""}
          </span>
        ) : null}
      </div>

      {error ? (
        <InlineError
          title="Workspace information unavailable"
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
        <LoadingPanel label="Loading workspace information" variant="table" />
      ) : workspace && canExport ? (
        <>
          <p className="text-muted-foreground text-sm">
            Download a JSON snapshot of this workspace. The export includes:
          </p>
          <ul className="text-muted-foreground list-disc pl-5 text-sm">
            <li>Workspace identity (id, name, slug)</li>
            <li>Workspace settings (invite permissions, default join role, display label)</li>
            <li>The full member roster — each member&apos;s id, email, name, and role</li>
          </ul>
          <p className="text-muted-foreground text-sm" role="note">
            The export contains personal information for every member, which is why it is restricted
            to owners and admins. Every export is recorded in the workspace audit log.
          </p>

          {downloadError ? (
            <InlineError
              title="Export failed"
              message={
                <span className="flex flex-wrap items-center gap-2">
                  <span>{downloadError}</span>
                  <Button type="button" variant="outline" size="sm" onClick={() => void download()}>
                    Retry
                  </Button>
                </span>
              }
            />
          ) : null}

          <div className="app-form-actions">
            <Button type="button" onClick={() => void download()} disabled={downloading}>
              <Download aria-hidden="true" />
              {downloading ? "Preparing download…" : "Download JSON"}
            </Button>
          </div>
        </>
      ) : null}
    </section>
  )
}
