import { z } from "zod"

import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { getAuthBackend } from "@/lib/auth/backend"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { requireWorkspaceContext, requireWorkspaceRole } from "@/lib/workspace-auth"
import { recordWorkspaceEvent } from "@/lib/workspace-audit"
import {
  getWorkspaceDomain,
  removeWorkspaceDomain,
  verifyWorkspaceDomain,
  WorkspaceDomainError,
  setWorkspaceDomain,
  workspaceDomainInputSchema,
  type WorkspaceDomain,
} from "@/lib/workspace-domains"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const readLimiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)
const writeLimiter = createAuthRateLimiter(AUTH_LIMITS.tokenConsume)

const MANAGE_ROLES = ["owner", "admin"] as const

const verifySchema = z
  .object({
    action: z.literal("verify"),
    token: z.string().trim().min(1, "Verification token is required.").max(256),
  })
  .strict()

type Params = { params: Promise<{ id: string }> }

/**
 * Domain payload for API responses. The `verificationToken` is a
 * bearer-ish secret (the value admins publish as a DNS TXT record), so it
 * is only included for owner/admin callers — members get status fields only.
 */
function domainPayload(record: WorkspaceDomain, canManage: boolean) {
  const base = {
    domain: record.domain,
    status: record.status,
    verifiedAt: record.verifiedAt,
    createdAt: record.createdAt,
  }
  return canManage ? { ...base, verificationToken: record.verificationToken } : base
}

function domainErrorResponse(error: unknown): ReturnType<typeof fail> | null {
  if (!(error instanceof WorkspaceDomainError)) return null
  switch (error.code) {
    case "domain_unavailable":
      return fail(409, "domain_unavailable", error.message)
    case "invalid_domain":
    case "invalid_status":
      return fail(400, "invalid_input", error.message)
    default:
      return fail(400, "invalid_input", error.message)
  }
}

/**
 * GET /api/workspaces/[id]/domain — the workspace's custom-domain record.
 * Any member may read it; `verificationToken` is only exposed to
 * owner/admin. Returns `{ domain: null }` when no domain is configured.
 */
export async function GET(request: Request, { params }: Params) {
  if (!readLimiter.check(clientIp(request))) return authRateLimited()

  const { id } = await params
  const result = await requireWorkspaceContext(request, id)
  if (!result.ok) return result.response

  const workspace = await getAuthBackend().getWorkspace(id)
  if (!workspace) return fail(404, "not_found", "Workspace not found.")

  const record = getWorkspaceDomain(id)
  const canManage = MANAGE_ROLES.includes(
    result.context.membership.role as (typeof MANAGE_ROLES)[number],
  )
  return ok({
    role: result.context.membership.role,
    domain: record ? domainPayload(record, canManage) : null,
  })
}

/**
 * PUT /api/workspaces/[id]/domain — set or replace the workspace's single
 * custom domain. Body: `{ domain: string }` (bare hostname; normalized to
 * lowercase by the store). Owner/admin only; same-origin + rate limited.
 * Emits `workspace.domain_updated` after the store write succeeds.
 */
export async function PUT(request: Request, { params }: Params) {
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
  const parsed = workspaceDomainInputSchema.safeParse(body)
  if (!parsed.success) {
    return fail(400, "invalid_input", parsed.error.issues[0]?.message ?? "Invalid input.")
  }

  const result = await requireWorkspaceRole(request, MANAGE_ROLES, id)
  if (!result.ok) return result.response

  const workspace = await getAuthBackend().getWorkspace(id)
  if (!workspace) return fail(404, "not_found", "Workspace not found.")

  let record: WorkspaceDomain
  try {
    record = setWorkspaceDomain(id, parsed.data.domain)
  } catch (error) {
    const mapped = domainErrorResponse(error)
    if (mapped) return mapped
    throw error
  }

  recordWorkspaceEvent({
    workspaceId: id,
    type: "workspace.domain_updated",
    actorId: result.context.user.id,
    details: { domain: record.domain, status: record.status },
  })

  return ok({ domain: domainPayload(record, true) })
}

/**
 * DELETE /api/workspaces/[id]/domain — remove the workspace's custom
 * domain entirely. Owner/admin only; same-origin + rate limited. Emits
 * `workspace.domain_removed` when a record existed.
 */
export async function DELETE(request: Request, { params }: Params) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request rejected.")
  }
  if (!writeLimiter.check(clientIp(request))) return authRateLimited()

  const { id } = await params

  const result = await requireWorkspaceRole(request, MANAGE_ROLES, id)
  if (!result.ok) return result.response

  const workspace = await getAuthBackend().getWorkspace(id)
  if (!workspace) return fail(404, "not_found", "Workspace not found.")

  const existing = getWorkspaceDomain(id)
  const removed = removeWorkspaceDomain(id)
  if (removed && existing) {
    recordWorkspaceEvent({
      workspaceId: id,
      type: "workspace.domain_removed",
      actorId: result.context.user.id,
      details: { domain: existing.domain },
    })
  }

  return ok({ removed })
}

/**
 * POST /api/workspaces/[id]/domain — verification attempt. Body:
 * `{ action: "verify", token: string }`. Owner/admin only; same-origin +
 * rate limited. The token is the value the admin published as a DNS TXT
 * record — {@link verifyWorkspaceDomain} is the verification seam where a
 * real DNS-01 lookup would run in production. Emits
 * `workspace.domain_verified` on success.
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
  const parsed = verifySchema.safeParse(body)
  if (!parsed.success) {
    return fail(400, "invalid_input", parsed.error.issues[0]?.message ?? "Invalid input.")
  }

  const result = await requireWorkspaceRole(request, MANAGE_ROLES, id)
  if (!result.ok) return result.response

  const workspace = await getAuthBackend().getWorkspace(id)
  if (!workspace) return fail(404, "not_found", "Workspace not found.")

  // Snapshot before verifying: verifyWorkspaceDomain is idempotent for
  // already-verified records, so only emit the audit event on a real
  // pending -> verified transition, not on repeat verify calls.
  const before = getWorkspaceDomain(id)
  const record = verifyWorkspaceDomain(id, parsed.data.token)
  if (!record) {
    return fail(
      400,
      "invalid_input",
      "Verification failed. Check that the DNS TXT record is published and try again.",
    )
  }

  if (before?.status !== "verified") {
    recordWorkspaceEvent({
      workspaceId: id,
      type: "workspace.domain_verified",
      actorId: result.context.user.id,
      details: { domain: record.domain, status: record.status },
    })
  }

  return ok({ domain: domainPayload(record, true) })
}
