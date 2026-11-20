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
import { SUPPORT_TICKET_LIMITS, supportTicketStore } from "@/lib/support-tickets"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

const readLimiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)
const writeLimiter = createRateLimiter({ limit: 30, windowMs: 60 * 60 * 1000 })

const replySchema = z.object({
  body: z
    .string()
    .trim()
    .min(SUPPORT_TICKET_LIMITS.messageMin, "Write a reply.")
    .max(SUPPORT_TICKET_LIMITS.messageMax, "Reply is too long."),
})

// Owners may only close or reopen their own ticket; "pending"/"resolved" are
// agent-side states and are rejected here.
const statusSchema = z.object({
  status: z.enum(["open", "closed"], "Status must be open or closed."),
})

async function authenticate(request: Request) {
  const access = accessTokenFromRequest(request)
  if (!access) return { error: fail(401, "unauthenticated", "Sign in required.") } as const
  const user = await getAuthBackend().getUserById(access.uid)
  if (!user) return { error: fail(401, "unauthenticated", "Sign in required.") } as const
  return { user } as const
}

/**
 * GET /api/support/tickets/[id] — fetches one ticket with its message
 * thread. Ownership is enforced inside the store: foreign and missing ids
 * both answer 404 so ticket ids cannot be enumerated.
 */
export async function GET(request: Request, { params }: Params) {
  if (!readLimiter.check(clientIp(request))) return authRateLimited()

  const auth = await authenticate(request)
  if ("error" in auth) return auth.error

  const { id } = await params
  const ticket = supportTicketStore.getTicket(auth.user.id, id)
  if (!ticket) return fail(404, "not_found", "Ticket not found.")
  return ok({ ticket })
}

/**
 * POST /api/support/tickets/[id] — appends a user reply `{ body }`.
 * Replying to a "resolved" ticket reopens it ("open"); "closed" tickets
 * reject replies with 409 until the owner reopens them via PATCH.
 */
export async function POST(request: Request, { params }: Params) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  if (!writeLimiter.check(clientIp(request))) return authRateLimited()

  const auth = await authenticate(request)
  if ("error" in auth) return auth.error

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Request body must be JSON.")
  }
  const parsed = replySchema.safeParse(body)
  if (!parsed.success) {
    return fail(400, "invalid_request", "Write a reply and try again.")
  }

  const { id } = await params
  const result = supportTicketStore.addMessage(auth.user.id, id, parsed.data.body)
  if (!result.ok) {
    if (result.reason === "not_found") {
      return fail(404, "not_found", "Ticket not found.")
    }
    if (result.reason === "closed") {
      return fail(409, "ticket_closed", "This ticket is closed. Reopen it to reply.")
    }
    if (result.reason === "too_many_messages") {
      return fail(422, "ticket_full", "This ticket has reached its message limit.")
    }
    return fail(400, "invalid_request", "Write a reply and try again.")
  }
  return ok({ ticket: result.ticket })
}

/**
 * PATCH /api/support/tickets/[id] — owner status change `{ status }`.
 * Only "open" (reopen) and "closed" are accepted; "pending"/"resolved"
 * belong to the agent side and are rejected with 400.
 */
export async function PATCH(request: Request, { params }: Params) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  if (!writeLimiter.check(clientIp(request))) return authRateLimited()

  const auth = await authenticate(request)
  if ("error" in auth) return auth.error

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Request body must be JSON.")
  }
  const parsed = statusSchema.safeParse(body)
  if (!parsed.success) {
    return fail(400, "invalid_request", "Status must be open or closed.")
  }

  const { id } = await params
  const ticket = supportTicketStore.setTicketStatus(auth.user.id, id, parsed.data.status)
  if (!ticket) return fail(404, "not_found", "Ticket not found.")
  return ok({ ticket })
}
