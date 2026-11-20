import { z } from "zod"

import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { createScimToken, listScimTokens } from "@/lib/scim-tokens"
import { requireWorkspaceRole } from "@/lib/workspace-auth"
import { recordWorkspaceEvent } from "@/lib/workspace-audit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const readLimiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)
const writeLimiter = createAuthRateLimiter(AUTH_LIMITS.tokenConsume)

const MANAGE_ROLES = ["owner", "admin"] as const

const createTokenSchema = z
  .object({
    label: z.string().trim().min(1).max(80).optional(),
  })
  .strict()

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/workspaces/[id]/scim-tokens — metadata for the workspace's SCIM
 * bearer tokens. Owner/admin only: even though the store never holds secrets,
 * the list reveals which IdP integrations exist. Plaintext tokens are never
 * returned here — only the safe `prefix` set at creation.
 */
export async function GET(request: Request, { params }: Params) {
  if (!readLimiter.check(clientIp(request))) return authRateLimited()

  const { id } = await params
  const result = await requireWorkspaceRole(request, MANAGE_ROLES, id)
  if (!result.ok) return result.response

  return ok({ role: result.context.membership.role, tokens: listScimTokens(id) })
}

/**
 * POST /api/workspaces/[id]/scim-tokens — mints a new SCIM bearer token.
 * Owner/admin only; same-origin + rate limited. The plaintext `token` is
 * returned in THIS response only — it is stored hashed and cannot be
 * recovered afterwards. Emits `workspace.scim_token_created` (never the
 * secret) after creation.
 */
export async function POST(request: Request, { params }: Params) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request rejected.")
  }
  if (!writeLimiter.check(clientIp(request))) return authRateLimited()

  const { id } = await params

  let body: unknown = {}
  try {
    const text = await request.text()
    if (text.trim()) body = JSON.parse(text)
  } catch {
    return fail(400, "invalid_input", "Invalid request body.")
  }
  const parsed = createTokenSchema.safeParse(body)
  if (!parsed.success) {
    return fail(400, "invalid_input", parsed.error.issues[0]?.message ?? "Invalid input.")
  }

  const result = await requireWorkspaceRole(request, MANAGE_ROLES, id)
  if (!result.ok) return result.response

  const created = createScimToken(id, parsed.data.label ?? null)
  recordWorkspaceEvent({
    workspaceId: id,
    type: "workspace.scim_token_created",
    actorId: result.context.user.id,
    details: { tokenId: created.id, label: created.label, prefix: created.prefix },
  })

  return ok({ role: result.context.membership.role, token: created })
}
