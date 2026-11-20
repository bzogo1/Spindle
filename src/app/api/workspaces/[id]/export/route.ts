import { NextResponse } from "next/server"

import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail } from "@/lib/auth/http"
import { recordWorkspaceEvent } from "@/lib/workspace-audit"
import { requireWorkspaceRole } from "@/lib/workspace-auth"
import { buildWorkspaceExport } from "@/lib/workspace-export"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const exportLimiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

/**
 * Roles allowed to export workspace data. The payload contains every
 * member's email/name — PII — so exporting is restricted to owner/admin,
 * matching the audit-log and settings endpoints rather than opening it to
 * plain members.
 */
const EXPORT_ROLES = ["owner", "admin"] as const

type Params = { params: Promise<{ id: string }> }

/** Filename-safe slug; falls back to the workspace id. */
function exportFilename(slug: string, workspaceId: string): string {
  const safe = slug
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return `workspace-${safe || workspaceId}-export.json`
}

/**
 * GET /api/workspaces/[id]/export — downloads a JSON snapshot of the
 * workspace (identity, settings, member roster). Owner/admin only; the
 * response is a `Content-Disposition: attachment` download rather than the
 * usual `{ ok: true }` envelope, so error paths still use `fail(...)`.
 *
 * Emits a `workspace.exported` audit event with the actor and member count.
 * The underlying data is an in-memory development seam — see
 * {@link buildWorkspaceExport}.
 */
export async function GET(request: Request, { params }: Params) {
  if (!exportLimiter.check(clientIp(request))) return authRateLimited()

  const { id } = await params

  const result = await requireWorkspaceRole(request, EXPORT_ROLES, id)
  if (!result.ok) return result.response
  const { user } = result.context

  const exportData = await buildWorkspaceExport(id)
  if (!exportData) return fail(404, "not_found", "Workspace not found.")

  recordWorkspaceEvent({
    workspaceId: id,
    type: "workspace.exported",
    actorId: user.id,
    details: { memberCount: exportData.members.length },
  })

  return new NextResponse(JSON.stringify(exportData, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${exportFilename(exportData.workspace.slug, id)}"`,
    },
  })
}
