import { NextResponse } from "next/server"

import {
  ALL_UNSUBSCRIBE_SCOPE,
  isUnsubscribed,
  normalizeEmail,
  unsubscribeAddress,
  verifyUnsubscribeToken,
} from "@/lib/email-unsubscribe"
import { logger } from "@/lib/logger"
import { unsubscribe as unsubscribeSubscriber } from "@/lib/newsletter-store"
import { clientIp, createRateLimiter } from "@/lib/site-forms"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ok = (body: Record<string, unknown>) => NextResponse.json({ ok: true, ...body })
const fail = (status: number, message: string) =>
  NextResponse.json({ ok: false, message }, { status })

const INVALID_LINK_MESSAGE =
  "This unsubscribe link is invalid or has expired. Use the unsubscribe link in a recent Spindle email."

// Best-effort per-instance limit; see createRateLimiter for caveats.
const limiter = createRateLimiter({ limit: 30, windowMs: 60 * 60 * 1000 })

/** Returns true when a caller-supplied email disagrees with the token. */
function emailMismatch(
  verified: NonNullable<ReturnType<typeof verifyUnsubscribeToken>>,
  supplied: string | null | undefined,
): boolean {
  if (typeof supplied !== "string" || supplied.trim().length === 0) return false
  return normalizeEmail(supplied) !== verified.email
}

/**
 * GET /api/email/unsubscribe?token=...&email=...
 *
 * Status check only — never mutates. Mail clients and link scanners may GET
 * unsubscribe URLs, so the state change is reserved for POST.
 */
export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) {
    return fail(429, "Too many attempts. Please try again later.")
  }

  // Token and email both come from the query string for GET; the email param
  // is display-only and must agree with the address embedded in the token.
  const url = new URL(request.url)
  const rawToken = url.searchParams.get("token")
  const verified = rawToken ? verifyUnsubscribeToken(rawToken) : null
  if (!verified) return fail(400, INVALID_LINK_MESSAGE)

  const suppliedEmail = url.searchParams.get("email")
  if (emailMismatch(verified, suppliedEmail)) return fail(400, INVALID_LINK_MESSAGE)

  return ok({
    email: verified.email,
    scope: verified.scope,
    subscribed: !isUnsubscribed(verified.email, verified.scope),
    expiresAt: verified.expiresAt.toISOString(),
  })
}

/**
 * POST /api/email/unsubscribe
 *
 * Two callers:
 *  - RFC 8058 one-click: `List-Unsubscribe=One-Click` (form or urlencoded) with
 *    the token in the query string or body. Always succeeds silently-ish.
 *  - The /unsubscribe confirmation page: JSON `{ token, email? }`.
 *
 * Idempotent: unsubscribing an already-unsubscribed address returns ok.
 */
export async function POST(request: Request) {
  if (!limiter.check(clientIp(request))) {
    return fail(429, "Too many attempts. Please try again later.")
  }

  const url = new URL(request.url)
  const contentType = request.headers.get("content-type") ?? ""

  let bodyToken: string | undefined
  let bodyEmail: string | undefined
  let oneClick = false

  if (contentType.includes("application/json")) {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return fail(400, "Invalid request.")
    }
    if (body && typeof body === "object") {
      const record = body as Record<string, unknown>
      if (typeof record.token === "string") bodyToken = record.token
      if (typeof record.email === "string") bodyEmail = record.email
    }
  } else {
    // RFC 8058 one-click posts `List-Unsubscribe=One-Click`; also accept a
    // plain urlencoded `token=...` for non-JS form posts.
    const text = await request.text()
    const params = new URLSearchParams(text)
    const listUnsubscribe = params.get("List-Unsubscribe") ?? params.get("list-unsubscribe")
    oneClick = listUnsubscribe?.toLowerCase() === "one-click"
    bodyToken = params.get("token") ?? undefined
    bodyEmail = params.get("email") ?? undefined
  }

  const rawToken = bodyToken ?? url.searchParams.get("token")
  const verified = rawToken ? verifyUnsubscribeToken(rawToken) : null
  if (!verified) return fail(400, INVALID_LINK_MESSAGE)

  if (emailMismatch(verified, bodyEmail ?? url.searchParams.get("email"))) {
    return fail(400, INVALID_LINK_MESSAGE)
  }

  unsubscribeAddress(verified.email, verified.scope)

  // Keep the admin-visible subscriber record in sync when the opt-out covers
  // the newsletter. Best-effort: a store failure must not break the response.
  if (verified.scope === "newsletter" || verified.scope === ALL_UNSUBSCRIBE_SCOPE) {
    try {
      unsubscribeSubscriber(verified.email)
    } catch (error) {
      logger.warn(
        { event: "newsletter.store_failed", err: error },
        "Newsletter subscriber could not be marked unsubscribed",
      )
    }
  }

  logger.info(
    { event: "email.unsubscribed", scope: verified.scope, oneClick },
    "Email address unsubscribed",
  )

  return ok({
    email: verified.email,
    scope: verified.scope,
    subscribed: false,
    message: oneClick
      ? "Unsubscribed."
      : `You've been unsubscribed from ${scopeLabel(verified.scope)}.`,
  })
}

function scopeLabel(scope: string): string {
  if (scope === "all") return "all Spindle emails"
  if (scope === "marketing") return "Spindle marketing emails"
  return `Spindle ${scope} emails`
}
