import { z } from "zod"

import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { getAuthBackend } from "@/lib/auth/backend"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import {
  computeSyncPlan,
  lastSyncResult,
  setLastSyncResult,
  type DirectorySyncOutcome,
  type DirectorySyncPlan,
} from "@/lib/directory-sync"
import type { WorkspaceRole } from "@/lib/members/permissions"
import { requireWorkspaceContext, requireWorkspaceRole } from "@/lib/workspace-auth"
import { recordWorkspaceEvent } from "@/lib/workspace-audit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const readLimiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)
const writeLimiter = createAuthRateLimiter(AUTH_LIMITS.tokenConsume)

const MANAGE_ROLES = ["owner", "admin"] as const
const MAX_DIRECTORY_USERS = 500

const directoryUserSchema = z
  .object({
    email: z.string().min(1).max(254),
    name: z.string().max(200).nullish(),
    // Kept as a free-form string so computeSyncPlan can report invalid
    // roles in `plan.errors` alongside bad emails, rather than 400ing early.
    role: z.string().max(50).optional(),
  })
  .strict()

const postSchema = z
  .object({
    users: z.array(directoryUserSchema).max(MAX_DIRECTORY_USERS),
    dryRun: z.boolean().optional(),
    removeAbsent: z.boolean().optional(),
  })
  .strict()

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/workspaces/[id]/directory-sync — the most recent sync record for
 * this workspace (plan + outcome), or `result: null` when none exists. Any
 * member may read it; running a sync is owner/admin only (see POST).
 */
export async function GET(request: Request, { params }: Params) {
  if (!readLimiter.check(clientIp(request))) return authRateLimited()

  const { id } = await params
  const result = await requireWorkspaceContext(request, id)
  if (!result.ok) return result.response

  return ok({ result: lastSyncResult(id) })
}

/**
 * POST /api/workspaces/[id]/directory-sync — reconcile the workspace roster
 * against a directory export.
 *
 * Body: `{ users: [{email, name?, role?}], dryRun?, removeAbsent? }` (≤500
 * users). Owner/admin only. The roster is loaded from the backend, diffed
 * via {@link computeSyncPlan}, and — unless `dryRun` — applied through
 * `upsertOAuthUser` + `addWorkspaceMember` / `setWorkspaceMemberRole` /
 * `kickWorkspaceMember`. Per-item failures are collected into
 * `outcome.failed` rather than aborting the run. Applied runs emit
 * `directory_sync.applied` and are recorded for GET.
 */
export async function POST(request: Request, { params }: Params) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request rejected.")
  }
  if (!writeLimiter.check(clientIp(request))) return authRateLimited()

  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_input", "Invalid request body.")
  }
  const parsed = postSchema.safeParse(body)
  if (!parsed.success) {
    return fail(400, "invalid_input", parsed.error.issues[0]?.message ?? "Invalid input.")
  }
  const { users, dryRun = false, removeAbsent = false } = parsed.data

  const result = await requireWorkspaceRole(request, MANAGE_ROLES, id)
  if (!result.ok) return result.response
  const actorId = result.context.user.id

  const backend = getAuthBackend()
  const roster = await backend.listWorkspaceMembers(id)
  const plan: DirectorySyncPlan = computeSyncPlan(
    roster.map((member) => ({
      id: member.user.id,
      email: member.user.email,
      name: member.user.name,
      role: member.role,
    })),
    users,
    { removeAbsent },
  )

  let outcome: DirectorySyncOutcome | null = null

  if (!dryRun) {
    const workspace = await backend.getWorkspace(id)
    if (!workspace) {
      return fail(404, "not_found", "Workspace not found.")
    }

    outcome = { added: 0, updated: 0, removed: 0, failed: [] }

    for (const add of plan.toAdd) {
      try {
        const { user } = await backend.upsertOAuthUser({
          email: add.email,
          name: add.name,
          provider: "directory",
        })
        await backend.addWorkspaceMember({
          userId: user.id,
          workspace,
          role: add.role,
        })
        outcome.added += 1
      } catch (error) {
        outcome.failed.push({
          email: add.email,
          reason: error instanceof Error ? error.message : "add failed",
        })
      }
    }

    for (const update of plan.toUpdate) {
      try {
        // Role changes go through the guarded backend path; display-name
        // updates have no backend mutation yet, so they ride along in the
        // plan but are not persisted by this dev seam.
        if (update.to.role !== update.from.role) {
          const updated = await backend.setWorkspaceMemberRole(
            actorId,
            id,
            update.userId,
            update.to.role as WorkspaceRole,
          )
          if (!updated) {
            outcome.failed.push({
              email: update.email,
              reason: "role change denied by workspace permissions",
            })
            continue
          }
          // Only count updates that actually mutated the backend — name-only
          // diffs ride along in the plan but are never persisted by this dev
          // seam, so they must not inflate outcome.updated.
          outcome.updated += 1
        }
      } catch (error) {
        outcome.failed.push({
          email: update.email,
          reason: error instanceof Error ? error.message : "update failed",
        })
      }
    }

    for (const removal of plan.toRemove) {
      try {
        const removed = await backend.kickWorkspaceMember(actorId, id, removal.userId)
        if (!removed) {
          outcome.failed.push({
            email: removal.email,
            reason: "removal denied by workspace permissions",
          })
          continue
        }
        outcome.removed += 1
      } catch (error) {
        outcome.failed.push({
          email: removal.email,
          reason: error instanceof Error ? error.message : "remove failed",
        })
      }
    }

    recordWorkspaceEvent({
      workspaceId: id,
      type: "directory_sync.applied",
      actorId,
      details: {
        added: outcome.added,
        updated: outcome.updated,
        removed: outcome.removed,
        failed: outcome.failed.length,
        errors: plan.errors.length,
      },
    })
  }

  const record = {
    at: new Date().toISOString(),
    dryRun,
    applied: !dryRun,
    plan,
    outcome,
  }
  setLastSyncResult(id, record)

  return ok({ plan, result: record })
}
