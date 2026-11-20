import { NextResponse } from "next/server"

import { isAdminEmail } from "@/lib/admin"
import { requireAdmin } from "@/lib/admin-guard"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, ok } from "@/lib/auth/http"
import { buildUserPageArgs, paginateUserRows } from "@/lib/db/queries/pagination"
import type { UserWhereInput } from "@/generated/prisma/models"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/admin/users?q=&cursor=&size=&order= — paginated user directory for
 * admins. Admin-only: `requireAdmin` resolves the session (access-token
 * cookie or mock session in mock-auth mode) and 401/403s non-admins.
 *
 * Data source: the Prisma `User` table via the shared `prisma` client
 * (`@/lib/db`), using the keyset pagination helpers in
 * `src/lib/db/queries/pagination.ts` (`users_created_at_idx`-friendly
 * `(createdAt, id)` ordering). Rows expose only the persisted columns —
 * id, email, name, createdAt, updatedAt — plus a computed `admin` flag from
 * the ADMIN_EMAILS seam. There is no status/role/ban column in the schema
 * yet (see prisma/AUTH-SCHEMA.md), so nothing else is listed.
 *
 * The `AuthBackend` user store is a separate, in-memory dev backend whose ids
 * do not correspond to Prisma ids; it is not consulted here.
 *
 * `q` filters email/name case-insensitively; `cursor` is the opaque keyset
 * cursor from a previous page; `size` is clamped by `resolvePageSize`
 * (default 50, max 200); `order` is `desc` (default) or `asc` by createdAt.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const MAX_QUERY_LENGTH = 200

/**
 * Escape LIKE wildcards (`%`, `_`, `\`) so a search term like "%" or "_"
 * matches literally instead of acting as a pattern. Prisma's `contains`
 * does not escape these itself; the backslash is the LIKE escape character.
 */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  createdAt: true,
  updatedAt: true,
} as const

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

export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const params = new URL(request.url).searchParams

  const q = params.get("q")?.trim() ?? ""
  if (q.length > MAX_QUERY_LENGTH) {
    return fail(400, "invalid_request", "Search query is too long.")
  }

  const orderParam = params.get("order")
  if (orderParam !== null && orderParam !== "asc" && orderParam !== "desc") {
    return fail(400, "invalid_request", "order must be 'asc' or 'desc'.")
  }

  const pageArgs = buildUserPageArgs({
    cursor: params.get("cursor"),
    pageSize: params.get("size"),
    order: orderParam ?? "desc",
  })

  const searchWhere: UserWhereInput | undefined = q
    ? {
        OR: [
          { email: { contains: escapeLikePattern(q), mode: "insensitive" } },
          { name: { contains: escapeLikePattern(q), mode: "insensitive" } },
        ],
      }
    : undefined

  const clauses = [pageArgs.where, searchWhere].filter(
    (clause): clause is UserWhereInput => clause !== undefined,
  )
  const where = clauses.length > 0 ? { AND: clauses } : undefined

  // Lazy import: `@/lib/db` eagerly builds a pg pool and throws when
  // DATABASE_URL is unset, so it must only load inside a guarded path.
  let prisma: typeof import("@/lib/db").prisma
  try {
    ;({ prisma } = await import("@/lib/db"))
  } catch {
    return fail(503, "db_unavailable", "The user directory is unavailable.")
  }

  try {
    const rows = await prisma.user.findMany({
      where,
      orderBy: pageArgs.orderBy,
      take: pageArgs.take,
      select: USER_SELECT,
    })
    const { items, nextCursor } = paginateUserRows(rows, pageArgs.take - 1)
    return ok({
      users: items.map(serializeUser),
      nextCursor,
      pageSize: pageArgs.take - 1,
    })
  } catch {
    return fail(500, "internal", "Could not load users.")
  }
}
