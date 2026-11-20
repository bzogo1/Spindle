import { z } from "zod"

import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { createRateLimiter } from "@/lib/site-forms"
import { getAuthBackend } from "@/lib/auth/backend"
import { accessTokenFromRequest, fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import {
  SUPPORT_TICKET_CATEGORIES,
  SUPPORT_TICKET_LIMITS,
  SUPPORT_TICKET_STATUSES,
  supportTicketStore,
  type SupportTicketStatus,
} from "@/lib/support-tickets"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET uses the lenient `publicRead` preset like the other authenticated read
 * endpoints. POST gets a tighter per-IP budget (10/hr) — ticket creation is
 * rare for real users and spammy for bots.
 */
const readLimiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)
const writeLimiter = createRateLimiter({ limit: 10, windowMs: 60 * 60 * 1000 })

const createSchema = z.object({
  subject: z
    .string()
    .trim()
    .min(SUPPORT_TICKET_LIMITS.subjectMin, "Subject is too short.")
    .max(SUPPORT_TICKET_LIMITS.subjectMax, "Subject is too long."),
  category: z.enum(SUPPORT_TICKET_CATEGORIES, "Choose a ticket category."),
  message: z
    .string()
    .trim()
    .min(SUPPORT_TICKET_LIMITS.messageMin, "Describe your issue.")
    .max(SUPPORT_TICKET_LIMITS.messageMax, "Message is too long."),
})

function isTicketStatus(value: string): value is SupportTicketStatus {
  return (SUPPORT_TICKET_STATUSES as readonly string[]).includes(value)
}

function parseNonNegativeInt(raw: string | null, fallback: number): number | null {
  if (raw === null || raw === "") return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return parsed
}

/**
 * GET /api/support/tickets — lists the caller's tickets, newest-updated
 * first. Query params: `status` (open|pending|resolved|closed), `limit`
 * (clamped to 1..50, default 20), `offset`.
 */
export async function GET(request: Request) {
  if (!readLimiter.check(clientIp(request))) return authRateLimited()

  const access = accessTokenFromRequest(request)
  if (!access) return fail(401, "unauthenticated", "Sign in required.")
  const user = await getAuthBackend().getUserById(access.uid)
  if (!user) return fail(401, "unauthenticated", "Sign in required.")

  const url = new URL(request.url)
  const statusParam = url.searchParams.get("status")
  if (statusParam !== null && statusParam !== "" && !isTicketStatus(statusParam)) {
    return fail(400, "invalid_request", "Unknown ticket status filter.")
  }
  const limit = parseNonNegativeInt(
    url.searchParams.get("limit"),
    SUPPORT_TICKET_LIMITS.defaultPageSize,
  )
  const offset = parseNonNegativeInt(url.searchParams.get("offset"), 0)
  if (limit === null || offset === null) {
    return fail(400, "invalid_request", "limit and offset must be non-negative integers.")
  }

  const page = supportTicketStore.listTickets(user.id, {
    status: statusParam ? (statusParam as SupportTicketStatus) : undefined,
    limit,
    offset,
  })
  return ok({
    tickets: page.tickets,
    total: page.total,
    limit,
    offset,
    hasMore: page.hasMore,
  })
}

/**
 * POST /api/support/tickets — creates a ticket for the caller with the
 * first user message. Body: `{ subject, category, message }`.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  if (!writeLimiter.check(clientIp(request))) return authRateLimited()

  const access = accessTokenFromRequest(request)
  if (!access) return fail(401, "unauthenticated", "Sign in required.")
  const user = await getAuthBackend().getUserById(access.uid)
  if (!user) return fail(401, "unauthenticated", "Sign in required.")

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Request body must be JSON.")
  }
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return fail(400, "invalid_request", "Check the subject, category, and message.")
  }

  const result = supportTicketStore.createTicket(user.id, parsed.data)
  if (!result.ok) {
    if (result.reason === "limit") {
      return fail(
        422,
        "ticket_limit",
        "You have reached the support ticket limit. Please close older tickets or contact us another way.",
      )
    }
    return fail(400, "invalid_request", "Check the subject, category, and message.")
  }
  return ok({ ticket: result.ticket })
}
