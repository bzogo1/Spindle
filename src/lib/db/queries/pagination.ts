import type { User } from "@/generated/prisma/client"
import type { UserOrderByWithRelationInput, UserWhereInput } from "@/generated/prisma/models"

/**
 * Bounded, keyset pagination helpers for list queries.
 *
 * The audit script (`scripts/db/queries/audit.mjs`) flags `findMany` without
 * `take`/`cursor` as an unbounded-query warning. These helpers make the
 * bounded path the easy path: they always emit `take` (plus one lookahead
 * row) and, when a cursor is supplied, a keyset `where` that pairs with the
 * `users_created_at_idx` index — see docs/database/query-optimization.md.
 */

export const DEFAULT_PAGE_SIZE = 50
export const MAX_PAGE_SIZE = 200

/**
 * Parse a page-size request (URL param, form value, …) into a safe `take`.
 * Invalid or missing input falls back to DEFAULT_PAGE_SIZE; anything above
 * MAX_PAGE_SIZE is clamped so a single request cannot pull an unbounded
 * result set.
 */
export function resolvePageSize(input?: number | string | null): number {
  const n = typeof input === "string" ? Number.parseInt(input, 10) : input
  if (typeof n !== "number" || !Number.isFinite(n) || n < 1) {
    return DEFAULT_PAGE_SIZE
  }
  return Math.min(Math.floor(n), MAX_PAGE_SIZE)
}

export interface UserCursor {
  /** ISO-8601 timestamp of the last row on the previous page. */
  readonly createdAt: string
  /** `id` of the last row — tie-breaker for identical `createdAt` values. */
  readonly id: string
}

type UserCursorSource = Pick<User, "id" | "createdAt">

/** Encode the (createdAt, id) pair of the last row into an opaque cursor. */
export function encodeUserCursor(user: UserCursorSource): string {
  const payload: UserCursor = {
    createdAt: user.createdAt.toISOString(),
    id: user.id,
  }
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
}

/**
 * Decode a cursor produced by `encodeUserCursor`. Returns `null` for
 * missing, malformed, or tampered input so callers can treat it as "first
 * page" rather than erroring.
 */
export function decodeUserCursor(raw: string | null | undefined): UserCursor | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))
    if (typeof parsed !== "object" || parsed === null) return null
    const { createdAt, id } = parsed as Record<string, unknown>
    if (typeof createdAt !== "string" || typeof id !== "string") return null
    if (Number.isNaN(new Date(createdAt).getTime())) return null
    return { createdAt, id }
  } catch {
    return null
  }
}

export type UserListOrder = "asc" | "desc"

export interface UserPageArgs {
  /** `pageSize + 1` — the extra row is the has-more lookahead. */
  readonly take: number
  readonly orderBy: UserOrderByWithRelationInput[]
  readonly where?: UserWhereInput
}

/**
 * Build the `findMany` arguments for one page of `prisma.user` results.
 *
 * Ordering is `(createdAt, id)` — both directions — so the cursor is a
 * stable keyset position even when rows share a `createdAt`. The `where`
 * clause only constrains rows strictly after the cursor, which lets
 * Postgres satisfy the page from `users_created_at_idx` without a sort.
 *
 * ```ts
 * const args = buildUserPageArgs({ cursor: searchParams.get("cursor"), pageSize: searchParams.get("size") })
 * const rows = await prisma.user.findMany({ ...args, select: USER_LIST_SELECT })
 * const { items, nextCursor } = paginateUserRows(rows, args.take - 1)
 * ```
 */
export function buildUserPageArgs(
  options: {
    cursor?: string | null
    pageSize?: number | string | null
    order?: UserListOrder
  } = {},
): UserPageArgs {
  const order = options.order ?? "desc"
  const pageSize = resolvePageSize(options.pageSize)
  const orderBy: UserOrderByWithRelationInput[] =
    order === "desc"
      ? [{ createdAt: "desc" }, { id: "desc" }]
      : [{ createdAt: "asc" }, { id: "asc" }]

  const cursor = decodeUserCursor(options.cursor)
  if (!cursor) {
    return { take: pageSize + 1, orderBy }
  }

  const createdAt = new Date(cursor.createdAt)
  const where: UserWhereInput =
    order === "desc"
      ? {
          OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: cursor.id } }],
        }
      : {
          OR: [{ createdAt: { gt: createdAt } }, { createdAt, id: { gt: cursor.id } }],
        }
  return { take: pageSize + 1, orderBy, where }
}

/**
 * Split a `findMany` result fetched with `buildUserPageArgs` into the page
 * items and the cursor for the next page (`null` when there is no next
 * page). `pageSize` is the resolved page size, i.e. `args.take - 1`.
 */
export function paginateUserRows<T extends UserCursorSource>(
  rows: readonly T[],
  pageSize: number,
): { items: T[]; nextCursor: string | null } {
  const hasMore = rows.length > pageSize
  const items = hasMore ? rows.slice(0, pageSize) : [...rows]
  const last = items[items.length - 1]
  return {
    items,
    nextCursor: hasMore && last ? encodeUserCursor(last) : null,
  }
}
