import { NextResponse } from "next/server"

import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { sendAuthEmail } from "@/lib/auth/mailer"
import { escapeHtml } from "@/emails/layout"
import { createRateLimiter, clientIp } from "@/lib/site-forms"
import { logger } from "@/lib/logger"
import { confirmEmailChange, inspectEmailChangeToken } from "@/lib/email-change"
import { recordAuthEvent } from "@/lib/auth/audit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const limiter = createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 })

const ACCOUNT_PATH = "/app/account"

function redirectTo(request: Request, params: Record<string, string>): NextResponse {
  const url = new URL(ACCOUNT_PATH, request.url)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return NextResponse.redirect(url)
}

function htmlPage(title: string, body: string): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#111827"><h1>${escapeHtml(title)}</h1>${body}</body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  )
}

/**
 * GET /api/auth/email-change/confirm?token=… — interstitial page.
 *
 * Email scanners and link prefetchers issue GET requests, so GET must NOT
 * consume the single-use token. It only inspects it (signature, expiry,
 * live pending record) and renders a page with an explicit Confirm button;
 * the button submits a regular form POST which performs the real confirm.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token")
  const inspection = token ? inspectEmailChangeToken(token) : { ok: false as const }

  if (!inspection.ok) {
    return htmlPage(
      "Email change link unavailable",
      `<p>This confirmation link is invalid, expired, or has already been used.</p><p><a href="${ACCOUNT_PATH}">Back to account settings</a></p>`,
    )
  }

  const newEmail = escapeHtml(inspection.newEmail)
  return htmlPage(
    "Confirm your new email address",
    `<p>You asked to change the email address on your Spindle account to <strong>${newEmail}</strong>.</p>` +
      `<form method="POST" action="/api/auth/email-change/confirm">` +
      `<input type="hidden" name="token" value="${escapeHtml(token ?? "")}">` +
      `<button type="submit" style="padding:0.6rem 1.2rem;font-size:1rem;cursor:pointer">Confirm email change</button>` +
      `</form>` +
      `<p style="color:#5b6472;font-size:0.875rem">This link can only be used once and expires 24 hours after it was sent.</p>`,
  )
}

async function applyConfirmation(
  request: Request,
  token: string,
): Promise<
  | { ok: true; newEmail: string }
  | { ok: false; reason: "invalid" | "expired" | "email_unavailable" }
> {
  const result = await confirmEmailChange(token)
  if (!result.ok) return { ok: false, reason: result.reason }

  recordAuthEvent({
    type: "email.verify",
    userId: result.userId,
    email: result.newEmail,
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
    metadata: { purpose: "email-change", previousEmail: result.previousEmail },
  })

  // Security notification to the OLD address — fire-and-forget so the
  // redirect/response never waits on the provider.
  void sendAuthEmail({
    to: result.previousEmail,
    subject: "Your Spindle email address was changed",
    text: [
      `The email address on your Spindle account was changed from ${result.previousEmail} to ${result.newEmail}.`,
      "",
      "If you did not make this change, reset your password immediately and contact support.",
    ].join("\n"),
    linkPath: "/app/account",
  }).catch((error: unknown) => {
    logger.warn(
      { event: "auth.email-change.notify-failed" },
      "Email-change security notification failed.",
    )
    void error
  })

  return { ok: true, newEmail: result.newEmail }
}

/**
 * POST /api/auth/email-change/confirm — performs the single-use confirm.
 * Accepts JSON `{ token }` (API clients) or the interstitial's
 * `application/x-www-form-urlencoded` form post.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  if (!limiter.check(clientIp(request))) {
    return fail(429, "rate_limited", "Too many attempts. Try again later.")
  }

  const contentType = request.headers.get("content-type") ?? ""
  let token: unknown
  if (contentType.includes("application/x-www-form-urlencoded")) {
    try {
      token = (await request.formData()).get("token")
    } catch {
      token = undefined
    }
  } else {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return fail(400, "invalid_request", "Request body must be JSON.")
    }
    token =
      typeof body === "object" && body !== null ? (body as { token?: unknown }).token : undefined
  }

  if (typeof token !== "string" || token.length === 0 || token.length > 2048) {
    return fail(400, "invalid_request", "A confirmation token is required.")
  }

  const result = await applyConfirmation(request, token)
  if (!result.ok) {
    // The interstitial's form post lands here too — send the browser back to
    // account settings with the failure flag the panel already surfaces;
    // JSON callers get the structured error.
    if (contentType.includes("application/x-www-form-urlencoded")) {
      return redirectTo(request, { "email-change": "failed", reason: result.reason })
    }
    const messages = {
      expired: "This confirmation link has expired or was replaced by a newer one.",
      invalid: "This confirmation link isn't valid.",
      email_unavailable: "That email address is already in use by another account.",
    } as const
    return fail(410, "confirm_failed", messages[result.reason], {
      reason: result.reason,
    })
  }

  // The interstitial's plain form post lands here — send the browser back to
  // account settings with the result flag; JSON callers get the payload.
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return redirectTo(request, { "email-change": "confirmed" })
  }
  return ok({ email: result.newEmail })
}
