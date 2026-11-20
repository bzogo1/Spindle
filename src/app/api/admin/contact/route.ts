import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/admin-guard"
import {
  CONTACT_QUEUES,
  CONTACT_SUBMISSION_STATUSES,
  listSubmissions,
  updateSubmissionStatus,
  type ContactQueue,
  type ContactSubmissionStatus,
} from "@/lib/contact-routing"
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
 * GET  /api/admin/contact?status=&queue=&q=&limit=&offset=
 *   — paginated, filterable inbox of public contact-form submissions.
 * PATCH /api/admin/contact — `{ id, status, assignee? }` updates a
 *   submission's triage status (and optionally assignee).
 *
 * Admin-only via `requireAdmin` (401 unauthenticated / 403 non-admin).
 *
 * Data source: the in-memory dev-seam store in `src/lib/contact-routing.ts`
 * (see its docstring — per-instance, bounded, lost on restart). Submissions
 * include full message bodies; this endpoint is admin-only.
 *
 * `status` filters to new|in_progress|resolved|spam; `queue` to the routing
 * queues (support|sales|billing|security|press|general); `q` is a
 * case-insensitive substring match over name, email, subject, message, and
 * ticket id. `limit` defaults to 50 (max 200) and `offset` paginates.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const MAX_QUERY_LENGTH = 200
const MAX_ID_LENGTH = 120
const MAX_ASSIGNEE_LENGTH = 120

function parseNonNegativeInt(raw: string | null, fallback: number): number | null {
  if (raw === null || raw === "") return fallback
  if (!/^\d+$/.test(raw)) return null
  const value = Number.parseInt(raw, 10)
  return Number.isSafeInteger(value) ? value : null
}

export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const params = new URL(request.url).searchParams

  const statusParam = params.get("status")?.trim() ?? ""
  if (statusParam && !(CONTACT_SUBMISSION_STATUSES as readonly string[]).includes(statusParam)) {
    return fail(400, "invalid_request", "status must be new, in_progress, resolved, or spam.")
  }

  const queueParam = params.get("queue")?.trim() ?? ""
  if (queueParam && !(CONTACT_QUEUES as readonly string[]).includes(queueParam)) {
    return fail(
      400,
      "invalid_request",
      "queue must be one of support, sales, billing, security, press, general.",
    )
  }

  const q = params.get("q")?.trim() ?? ""
  if (q.length > MAX_QUERY_LENGTH) {
    return fail(400, "invalid_request", "Search query is too long.")
  }

  const limit = parseNonNegativeInt(params.get("limit"), DEFAULT_LIMIT)
  if (limit === null || limit < 1) {
    return fail(400, "invalid_request", "limit must be a positive integer.")
  }
  const offset = parseNonNegativeInt(params.get("offset"), 0)
  if (offset === null) {
    return fail(400, "invalid_request", "offset must be a non-negative integer.")
  }

  const page = listSubmissions({
    ...(statusParam ? { status: statusParam as ContactSubmissionStatus } : {}),
    ...(queueParam ? { queue: queueParam as ContactQueue } : {}),
    ...(q ? { query: q } : {}),
    limit: Math.min(limit, MAX_LIMIT),
    offset,
  })

  return ok({
    submissions: page.items,
    total: page.total,
    limit: Math.min(limit, MAX_LIMIT),
    offset,
  })
}

export async function PATCH(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Expected a JSON body.")
  }

  const { id, status, assignee } = (body ?? {}) as {
    id?: unknown
    status?: unknown
    assignee?: unknown
  }

  if (typeof id !== "string" || id.trim() === "" || id.length > MAX_ID_LENGTH) {
    return fail(400, "invalid_request", "id must be a non-empty string.")
  }
  if (
    typeof status !== "string" ||
    !(CONTACT_SUBMISSION_STATUSES as readonly string[]).includes(status)
  ) {
    return fail(400, "invalid_request", "status must be new, in_progress, resolved, or spam.")
  }
  if (
    assignee !== undefined &&
    (typeof assignee !== "string" || assignee.length > MAX_ASSIGNEE_LENGTH)
  ) {
    return fail(
      400,
      "invalid_request",
      `assignee must be a string of at most ${MAX_ASSIGNEE_LENGTH} characters.`,
    )
  }

  const submission = updateSubmissionStatus(
    id.trim(),
    status as ContactSubmissionStatus,
    typeof assignee === "string" ? assignee : undefined,
  )
  if (!submission) return fail(404, "not_found", "Submission not found.")

  return ok({ submission })
}
