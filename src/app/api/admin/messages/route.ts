import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/admin-guard"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { createRateLimiter } from "@/lib/site-forms"
import {
  listSentMessages,
  MESSAGE_BODY_MAX_LENGTH,
  MESSAGE_KINDS,
  MESSAGE_SUBJECT_MAX_LENGTH,
  sendMessage,
  type MessageKind,
} from "@/lib/in-app-messages"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET  /api/admin/messages?limit=N — recent direct sends (admin audit view;
 *   broadcasts excluded since they have no single recipient).
 * POST /api/admin/messages — `{ subject, body, kind, userId? }` delivers an
 *   in-app message. Omitting `userId` (or passing null/"") broadcasts to
 *   every inbox; a concrete id targets one principal — the auth user's id
 *   for real sessions or `mock:<email>` for mock-auth sessions.
 *
 * Admin-only via `requireAdmin` (401 unauthenticated / 403 non-admin).
 * Messages live in the process-local store in `src/lib/in-app-messages.ts`
 * — per-instance dev seam, lost on restart.
 */

const readLimiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)
/** Sends are rare and admin-initiated; 30/hour per IP is generous. */
const writeLimiter = createRateLimiter({ limit: 30, windowMs: 60 * 60 * 1000 })

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const MAX_USER_ID_LENGTH = 200

function parseLimit(raw: string | null): number | null {
  if (raw === null || raw === "") return DEFAULT_LIMIT
  if (!/^\d+$/.test(raw)) return null
  const value = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(value) || value < 1) return null
  return Math.min(value, MAX_LIMIT)
}

function isMessageKind(value: unknown): value is MessageKind {
  return typeof value === "string" && (MESSAGE_KINDS as readonly string[]).includes(value)
}

export async function GET(request: Request) {
  if (!readLimiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const limit = parseLimit(new URL(request.url).searchParams.get("limit"))
  if (limit === null) {
    return fail(400, "invalid_request", "limit must be a positive integer.")
  }

  return ok({ messages: listSentMessages(limit), limit })
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  if (!writeLimiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Request body must be JSON.")
  }

  const {
    subject,
    body: messageBody,
    kind,
    userId,
  } = (body ?? {}) as {
    subject?: unknown
    body?: unknown
    kind?: unknown
    userId?: unknown
  }

  if (
    typeof subject !== "string" ||
    subject.trim() === "" ||
    subject.trim().length > MESSAGE_SUBJECT_MAX_LENGTH
  ) {
    return fail(
      400,
      "invalid_request",
      `subject must be a non-empty string of at most ${MESSAGE_SUBJECT_MAX_LENGTH} characters.`,
    )
  }
  if (
    typeof messageBody !== "string" ||
    messageBody.trim() === "" ||
    messageBody.trim().length > MESSAGE_BODY_MAX_LENGTH
  ) {
    return fail(
      400,
      "invalid_request",
      `body must be a non-empty string of at most ${MESSAGE_BODY_MAX_LENGTH} characters.`,
    )
  }
  if (!isMessageKind(kind)) {
    return fail(400, "invalid_request", `kind must be one of ${MESSAGE_KINDS.join(", ")}.`)
  }
  if (
    userId !== undefined &&
    userId !== null &&
    (typeof userId !== "string" || userId.length > MAX_USER_ID_LENGTH)
  ) {
    return fail(
      400,
      "invalid_request",
      `userId must be a string of at most ${MAX_USER_ID_LENGTH} characters.`,
    )
  }

  const message = sendMessage({
    userId: typeof userId === "string" && userId.trim() ? userId.trim() : null,
    subject,
    body: messageBody,
    kind,
  })

  return ok({
    message: {
      id: message.id,
      userId: message.userId,
      broadcast: message.userId === null,
      subject: message.subject,
      kind: message.kind,
      createdAt: message.createdAt,
    },
  })
}
