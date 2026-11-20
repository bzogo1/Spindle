import { NextResponse } from "next/server"

import { isAdminEmail } from "@/lib/admin"
import { requireAdmin } from "@/lib/admin-guard"
import { getAuthBackend } from "@/lib/auth/backend"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, ok } from "@/lib/auth/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET  /api/admin/users/[id] — one user's directory record plus whatever
 * auth-backend detail resolves for the same id (best-effort; the Prisma and
 * in-memory auth stores have independent id spaces, so this is usually null).
 * PATCH /api/admin/users/[id] — update the `name` column (the only mutable
 * field on the Prisma `User` model today).
 *
 * Admin-only via `requireAdmin` (401 unauthenticated / 403 non-admin).
 *
 * NOT supported (documented gaps, see prisma/AUTH-SCHEMA.md):
 *  - suspend/ban/delete: the `User` model has no status column and there is
 *    no delete path in `AuthBackend`.
 *  - role changes: roles live on workspace memberships
 *    (`AuthBackend.listWorkspaceMemberships`/`addWorkspaceMember`), keyed by
 *    auth-backend user ids — not addressable from Prisma user ids.
 *  - force sign-out: `AuthBackend.revokeAllSessions(userId)` exists but takes
 *    an auth-backend id, not a Prisma id.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  createdAt: true,
  updatedAt: true,
} as const

const MAX_NAME_LENGTH = 120

function serializeUser(user: {
  id: string
  email: string
  name: string | null
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    admin: isAdminEmail(user.email),
  }
}

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Best-effort auth-backend detail for `id`. Returns null when the id does
 * not resolve in the auth backend (expected: Prisma ids are cuids, the dev
 * auth backend uses uuids) or when any lookup fails — detail must never 500
 * because an enrichment source is unavailable.
 */
async function authEnrichment(id: string) {
  try {
    const backend = getAuthBackend()
    const user = await backend.getUserById(id)
    if (!user) return null
    const [totpEnabled, sessions, memberships] = await Promise.all([
      backend.isTotpEnabled(user.id).catch(() => false),
      backend.listSessions(user.id).catch(() => []),
      backend.listWorkspaceMemberships(user.id).catch(() => []),
    ])
    return {
      authUserId: user.id,
      emailVerified: user.emailVerified,
      totpEnabled,
      activeSessionCount: sessions.length,
      memberships: memberships.map((m) => ({
        workspace: m.workspace.name,
        role: m.role,
      })),
    }
  } catch {
    return null
  }
}

async function loadPrisma() {
  try {
    return (await import("@/lib/db")).prisma
  } catch {
    return null
  }
}

export async function GET(request: Request, context: RouteContext) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const { id } = await context.params
  const prisma = await loadPrisma()
  if (!prisma) return fail(503, "db_unavailable", "The user directory is unavailable.")

  try {
    const user = await prisma.user.findUnique({ where: { id }, select: USER_SELECT })
    if (!user) return fail(404, "not_found", "User not found.")
    return ok({
      user: serializeUser(user),
      auth: await authEnrichment(id),
    })
  } catch {
    return fail(500, "internal", "Could not load the user.")
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const { id } = await context.params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Expected a JSON body.")
  }
  const name = (body as { name?: unknown })?.name
  if (
    name !== null &&
    (typeof name !== "string" || name.trim().length === 0 || name.length > MAX_NAME_LENGTH)
  ) {
    return fail(
      400,
      "invalid_request",
      `name must be a string of 1-${MAX_NAME_LENGTH} characters or null.`,
    )
  }

  const prisma = await loadPrisma()
  if (!prisma) return fail(503, "db_unavailable", "The user directory is unavailable.")

  try {
    const existing = await prisma.user.findUnique({ where: { id }, select: { id: true } })
    if (!existing) return fail(404, "not_found", "User not found.")

    const user = await prisma.user.update({
      where: { id },
      data: { name: name === null ? null : (name as string).trim() },
      select: USER_SELECT,
    })
    return ok({ user: serializeUser(user) })
  } catch {
    return fail(500, "internal", "Could not update the user.")
  }
}
