import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAdmin } from "@/lib/admin-guard"
import { getAuthBackend } from "@/lib/auth/backend"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { mockAuthEnabled } from "@/lib/auth/mock-session"
import {
  betaProgramJson,
  enrollUser,
  getProgram,
  listProgramEnrollments,
  unenrollUser,
  updateProgramStatus,
} from "@/lib/beta-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * /api/admin/beta/[id]
 *
 * GET   — one program plus its full enrolled-user-id list.
 * PATCH — one of two shapes (exactly one per request):
 *   - `{ status: "open" | "closed" }` — open/close self-service enrollment.
 *     Existing enrollees are kept either way.
 *   - `{ action: "enroll" | "unenroll", userId }` or
 *     `{ action: "enroll" | "unenroll", email }` — admin-managed
 *     membership. `email` is resolved through the auth backend
 *     (`getUserByEmail`) to the `user:<id>` enrollment principal;
 *     unknown addresses get 404 `user_not_found`, except in mock-auth
 *     mode where they fall back to the `mock:<email>` principal mock
 *     sessions enroll under. `userId` is stored verbatim — it must be
 *     the full principal (`user:<uid>` / `mock:<email>`) shown in the
 *     enrollment list.
 *     Admin enrollment works regardless of program status — the `open`
 *     gate only applies to the self-service `/api/beta/[id]/enroll`
 *     endpoint. Both actions are idempotent.
 * POST  — the enrollment-action shape only (`{ action, userId|email }`),
 *         same-origin enforced. Use PATCH for status changes.
 *
 * Admin-only via `requireAdmin`, rate limited. The store is the in-memory
 * dev seam described in `src/lib/beta-access.ts`.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const USER_ID_MAX = 200
const EMAIL_MAX = 320

type RouteContext = { params: Promise<{ id: string }> }

const statusSchema = z.object({
  status: z.enum(["open", "closed"]),
})

const actionSchema = z
  .object({
    action: z.enum(["enroll", "unenroll"]),
    userId: z.string().trim().min(1).max(USER_ID_MAX).optional(),
    email: z.string().trim().min(3).max(EMAIL_MAX).optional(),
  })
  .refine((data) => (data.userId === undefined) !== (data.email === undefined), {
    message: "Provide exactly one of userId or email.",
  })

export async function GET(request: Request, context: RouteContext) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const { id } = await context.params
  const program = getProgram(id)
  if (!program) return fail(404, "not_found", "Beta program not found.")

  return ok({
    program: betaProgramJson(program),
    enrollments: listProgramEnrollments(id),
  })
}

/**
 * Resolves the enrollment principal from `userId` (verbatim — callers pass
 * the `user:<uid>` / `mock:<email>` key shown in the enrollment list) or
 * `email` (auth-backend lookup → `user:<id>`; mock-auth fallback →
 * `mock:<email>`).
 */
async function resolveTargetUserId(
  userId: string | undefined,
  email: string | undefined,
): Promise<{ userId: string } | { error: NextResponse }> {
  if (userId) return { userId }
  const normalized = email?.trim().toLowerCase()
  if (!normalized) {
    return { error: fail(400, "invalid_request", "Provide exactly one of userId or email.") }
  }
  const user = await getAuthBackend()
    .getUserByEmail(normalized)
    .catch(() => null)
  if (user) return { userId: `user:${user.id}` }
  // Mock-auth sessions enroll under `mock:<email>` and have no backend
  // user record, so an unmatched email resolves to that principal when
  // mock auth is enabled (same convention as /api/preferences et al.).
  if (mockAuthEnabled) return { userId: `mock:${normalized}` }
  return { error: fail(404, "user_not_found", "No user with that email.") }
}

/** Applies a validated enroll/unenroll action and returns the updated program. */
async function applyMembershipAction(
  id: string,
  data: z.infer<typeof actionSchema>,
): Promise<NextResponse> {
  const target = await resolveTargetUserId(data.userId, data.email)
  if ("error" in target) return target.error

  if (data.action === "enroll") {
    enrollUser(id, target.userId)
  } else {
    unenrollUser(id, target.userId)
  }

  const program = getProgram(id)
  return ok({
    program: program ? betaProgramJson(program) : null,
    enrolledCount: program?.enrolledUserIds.size ?? 0,
  })
}

function hasField(body: unknown, field: "status" | "action"): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    field in body &&
    (body as Record<string, unknown>)[field] !== undefined
  )
}

export async function PATCH(request: Request, context: RouteContext) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const { id } = await context.params
  if (!getProgram(id)) return fail(404, "not_found", "Beta program not found.")

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Request body must be JSON.")
  }

  const hasStatus = hasField(body, "status")
  const hasAction = hasField(body, "action")

  if (hasStatus === hasAction) {
    return fail(
      400,
      "invalid_request",
      "Provide exactly one of { status } or { action, userId|email }.",
    )
  }

  try {
    if (hasStatus) {
      const parsed = statusSchema.safeParse(body)
      if (!parsed.success) {
        return fail(400, "invalid_request", "status must be 'open' or 'closed'.")
      }
      const program = updateProgramStatus(id, parsed.data.status)
      return ok({
        program: betaProgramJson(program),
        enrolledCount: program.enrolledUserIds.size,
      })
    }

    const parsed = actionSchema.safeParse(body)
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Invalid enrollment action."
      return fail(400, "invalid_request", message)
    }

    return await applyMembershipAction(id, parsed.data)
  } catch (error) {
    return fail(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid beta program update.",
    )
  }
}

export async function POST(request: Request, context: RouteContext) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const { id } = await context.params
  if (!getProgram(id)) return fail(404, "not_found", "Beta program not found.")

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Request body must be JSON.")
  }

  if (hasField(body, "status")) {
    return fail(
      400,
      "invalid_request",
      "POST accepts enrollment actions only; use PATCH for status changes.",
    )
  }

  const parsed = actionSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid enrollment action."
    return fail(400, "invalid_request", message)
  }

  try {
    return await applyMembershipAction(id, parsed.data)
  } catch (error) {
    return fail(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid beta program update.",
    )
  }
}
