import { createHmac, randomUUID, timingSafeEqual } from "node:crypto"

import { getAuthBackend } from "@/lib/auth/backend"
import { accessTokenFromRequest, readCookie } from "@/lib/auth/http"
import { decodeMockSession, MOCK_SESSION_COOKIE, mockAuthEnabled } from "@/lib/auth/mock-session"
import { createResendCooldown } from "@/lib/auth/resend-cooldown"
import { emailField } from "@/lib/auth/schemas"
import { clientEnv } from "@/lib/env"
import { getServerEnv } from "@/lib/env.server"

/**
 * Email-change verification flow.
 *
 * Like `src/lib/profile.ts` there is no user-email update endpoint in the
 * auth backend (`AuthBackend` has no `updateEmail`), so confirmed changes are
 * recorded in a process-local override map — `getEffectiveEmail` is the seam
 * a real profile API replaces. Pending changes and the signed confirm tokens
 * live in the same in-memory model as `MemoryAuthBackend`: per-process,
 * lost on restart, reset between tests via `resetEmailChangeStoreForTests`.
 *
 * Token design: the emailed link carries an HMAC-SHA256-signed payload
 * (`v1.<b64>.<sig>`, same envelope shape as `token-codec.ts`) binding the
 * pending-change id, principal, new address, and expiry. The backend's
 * one-time-token kinds ("magic" | "reset" | "verify") cannot express this
 * purpose, and `token-codec.ts`'s `TokenPurpose` union is shared with access
 * tokens — so this module keeps its own codec keyed by `SESSION_SECRET`.
 * Single-use is enforced by the pending record: confirming deletes it, and
 * resending rotates the record id so older links die.
 *
 * This module is server-only (imports `env.server` through the token codec
 * and the session helpers); client components define their own response
 * types, matching the `BackupCodesStatus` pattern.
 */

export const EMAIL_CHANGE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
export const EMAIL_CHANGE_CONFIRM_PATH = "/api/auth/email-change/confirm"

/** Cooldown between verification emails for the same pending change. */
export const emailChangeResendCooldown = createResendCooldown({
  cooldownMs: 60 * 1000,
})

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EmailChangeIdentity = {
  /** Stable per-user key: `user:<id>` or `mock:<email>`. */
  principal: string
  /** Backend user id for real sessions; null for mock sessions. */
  userId: string | null
  /** The email the session currently authenticates with. */
  email: string
}

export type PendingEmailChange = {
  /** Random id embedded in the signed token; rotated on every resend. */
  id: string
  principal: string
  /** Session email snapshot at request time (the "old" address). */
  currentEmail: string
  newEmail: string
  requestedAt: string
  /** ISO timestamp; pending records and tokens share this deadline. */
  expiresAt: string
}

export type EmailChangePendingView = {
  newEmail: string
  requestedAt: string
  expiresAt: string
}

export type EmailChangeStatus = {
  /** Effective sign-in email: confirmed override ?? session email. */
  email: string
  pending: EmailChangePendingView | null
  /** Whole seconds until another verification email may be sent. */
  resendCooldownSeconds: number
}

// ---------------------------------------------------------------------------
// Session identity (same two-mode shape as api/profile/route.ts)
// ---------------------------------------------------------------------------

export async function resolveEmailChangeIdentity(
  request: Request,
): Promise<EmailChangeIdentity | null> {
  const access = accessTokenFromRequest(request)
  if (access) {
    return {
      principal: `user:${access.uid}`,
      userId: access.uid,
      email: access.email,
    }
  }

  if (mockAuthEnabled) {
    const session = decodeMockSession(readCookie(request, MOCK_SESSION_COOKIE))
    if (session) {
      return {
        principal: `mock:${session.user.email.trim().toLowerCase()}`,
        userId: null,
        email: session.user.email,
      }
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const pendingByPrincipal = new Map<string, PendingEmailChange>()
const emailOverrides = new Map<string, { email: string; updatedAt: string }>()

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function isExpired(pending: PendingEmailChange, now = Date.now()): boolean {
  return Date.parse(pending.expiresAt) <= now
}

/** Live pending change for the principal, or null (expired entries are dropped). */
export function getPendingEmailChange(
  principal: string,
  now = Date.now(),
): PendingEmailChange | null {
  const pending = pendingByPrincipal.get(principal)
  if (!pending) return null
  if (isExpired(pending, now)) {
    pendingByPrincipal.delete(principal)
    return null
  }
  return pending
}

export function getEffectiveEmail(principal: string, sessionEmail: string): string {
  return emailOverrides.get(principal)?.email ?? sessionEmail
}

export function getConfirmedEmailOverride(
  principal: string,
): { email: string; updatedAt: string } | null {
  return emailOverrides.get(principal) ?? null
}

export type EmailChangeRequestResult =
  { ok: true; pending: PendingEmailChange; token: string } | { ok: false; error: string }

/**
 * Validates `newEmail` and (re)places the principal's pending change. Any
 * previous pending record — and therefore its emailed link — is superseded:
 * the token embeds the record id, so only the newest link can confirm.
 */
export function requestEmailChange(
  identity: EmailChangeIdentity,
  newEmail: string,
  now = Date.now(),
): EmailChangeRequestResult {
  const parsed = emailField.safeParse(newEmail)
  if (!parsed.success) {
    return { ok: false, error: "Enter a valid email address." }
  }
  const target = parsed.data
  const current = getEffectiveEmail(identity.principal, identity.email)
  if (target === normalizeEmail(current)) {
    return { ok: false, error: "That is already your email address." }
  }

  const pending: PendingEmailChange = {
    id: randomUUID(),
    principal: identity.principal,
    currentEmail: current,
    newEmail: target,
    requestedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + EMAIL_CHANGE_TTL_MS).toISOString(),
  }
  pendingByPrincipal.set(identity.principal, pending)
  return { ok: true, pending, token: createEmailChangeToken(pending, now) }
}

/** Status payload for GET /api/auth/email-change. */
export function getEmailChangeStatus(
  identity: EmailChangeIdentity,
  now = Date.now(),
): EmailChangeStatus {
  const pending = getPendingEmailChange(identity.principal, now)
  return {
    email: getEffectiveEmail(identity.principal, identity.email),
    pending: pending
      ? {
          newEmail: pending.newEmail,
          requestedAt: pending.requestedAt,
          expiresAt: pending.expiresAt,
        }
      : null,
    resendCooldownSeconds: emailChangeResendCooldown.remainingSeconds(identity.principal),
  }
}

/** Cancels the pending change, if any. Returns whether one existed. */
export function cancelEmailChange(principal: string): boolean {
  return pendingByPrincipal.delete(principal)
}

export type EmailChangeConfirmResult =
  | {
      ok: true
      principal: string
      userId: string | null
      previousEmail: string
      newEmail: string
    }
  // A validly-signed token whose pending record is gone (confirmed,
  // cancelled, superseded, or expired) reports "expired" — there is no
  // separate "no_pending" outcome because the pending lookup is the same
  // check for all of those states.
  | { ok: false; reason: "invalid" | "expired" | "email_unavailable" }

/**
 * Verifies a confirm token and applies the change: the pending record is
 * consumed (single-use), the email override is stored, and the result
 * carries both addresses so the route can notify the old address.
 *
 * `email_unavailable` is returned when the target address is already bound
 * to a *different* backend user — checked at confirm time so the request
 * endpoint cannot be used to probe which addresses are registered.
 */
export async function confirmEmailChange(
  token: string,
  now = Date.now(),
): Promise<EmailChangeConfirmResult> {
  const payload = verifyEmailChangeToken(token, now)
  if (!payload) return { ok: false, reason: "invalid" }

  const pending = getPendingEmailChange(payload.principal, now)
  if (!pending) {
    // The token signature was valid but the pending record is gone — either
    // already confirmed/cancelled or past expiry.
    return { ok: false, reason: "expired" }
  }
  if (pending.id !== payload.pendingId || pending.newEmail !== payload.newEmail) {
    return { ok: false, reason: "invalid" }
  }

  // Re-check uniqueness at confirm time: the address may have been claimed
  // between request and click.
  const backend = getAuthBackend()
  const existing = await backend.getUserByEmail(payload.newEmail).catch(() => null)
  const currentUserId = pending.principal.startsWith("user:")
    ? pending.principal.slice("user:".length)
    : null
  if (existing && existing.id !== currentUserId) {
    pendingByPrincipal.delete(pending.principal)
    return { ok: false, reason: "email_unavailable" }
  }

  pendingByPrincipal.delete(pending.principal)
  emailOverrides.set(pending.principal, {
    email: pending.newEmail,
    updatedAt: new Date(now).toISOString(),
  })
  return {
    ok: true,
    principal: pending.principal,
    userId: currentUserId,
    previousEmail: pending.currentEmail,
    newEmail: pending.newEmail,
  }
}

/** Test hook: clears pending changes, overrides, and the resend cooldown. */
export function resetEmailChangeStoreForTests(): void {
  pendingByPrincipal.clear()
  emailOverrides.clear()
  emailChangeResendCooldown.reset()
}

// ---------------------------------------------------------------------------
// Signed confirm token (HMAC envelope, SESSION_SECRET keyed)
// ---------------------------------------------------------------------------

type EmailChangeTokenPayload = {
  purpose: "email-change"
  /** Pending-change record id; rotated on resend so old links die. */
  pid: string
  principal: string
  newEmail: string
  /** Epoch seconds. */
  exp: number
}

const TOKEN_VERSION = "v1"
/**
 * Domain separation: the HMAC key is derived as
 * `HMAC(SESSION_SECRET, DOMAIN_SEPARATOR)` so an email-change token can never
 * collide with a `token-codec.ts` envelope (access / TOTP challenge) even if
 * the payload shapes were ever confused — the signatures live under
 * different keys entirely.
 */
const DOMAIN_SEPARATOR = "spindle:email-change:v1"
const DEV_FALLBACK_SECRET = "spindle-dev-only-insecure-session-secret-do-not-use"

function baseSigningKeys(): string[] {
  try {
    const env = getServerEnv()
    const keys = [env.SESSION_SECRET, env.SESSION_SECRET_PREVIOUS].filter(
      (key): key is string => typeof key === "string" && key.length > 0,
    )
    if (keys.length > 0) return keys
    if (env.NODE_ENV === "production") {
      throw new Error("SESSION_SECRET is required in production.")
    }
    return [DEV_FALLBACK_SECRET]
  } catch (error) {
    if (clientEnv.NODE_ENV === "production") throw error
    return [DEV_FALLBACK_SECRET]
  }
}

function signingKeys(): string[] {
  return baseSigningKeys().map((secret) =>
    createHmac("sha256", secret).update(DOMAIN_SEPARATOR).digest("base64url"),
  )
}

function b64url(input: string): string {
  return Buffer.from(input).toString("base64url")
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url")
}

function signaturesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

function createEmailChangeToken(pending: PendingEmailChange, now: number): string {
  const payload: EmailChangeTokenPayload = {
    purpose: "email-change",
    pid: pending.id,
    principal: pending.principal,
    newEmail: pending.newEmail,
    exp: Math.floor(now / 1000) + Math.ceil(EMAIL_CHANGE_TTL_MS / 1000),
  }
  const body = `${TOKEN_VERSION}.${b64url(JSON.stringify(payload))}`
  return `${body}.${sign(body, signingKeys()[0])}`
}

function verifyEmailChangeToken(
  token: string,
  now: number,
): { pendingId: string; principal: string; newEmail: string } | null {
  const parts = token.split(".")
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return null
  const body = `${parts[0]}.${parts[1]}`
  const signature = parts[2]
  if (!signingKeys().some((key) => signaturesMatch(sign(body, key), signature))) {
    return null
  }
  let payload: EmailChangeTokenPayload
  try {
    payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as EmailChangeTokenPayload
  } catch {
    return null
  }
  if (payload.purpose !== "email-change") return null
  if (typeof payload.exp !== "number" || payload.exp * 1000 <= now) return null
  if (
    typeof payload.pid !== "string" ||
    typeof payload.principal !== "string" ||
    typeof payload.newEmail !== "string"
  ) {
    return null
  }
  return {
    pendingId: payload.pid,
    principal: payload.principal,
    newEmail: payload.newEmail,
  }
}

export type EmailChangeTokenInspection = { ok: true; newEmail: string } | { ok: false }

/**
 * Read-only token check for the GET interstitial: verifies the signature and
 * expiry and confirms a live pending record still matches, WITHOUT consuming
 * anything. Email scanners/prefetchers hitting the link therefore cannot burn
 * the single-use token — only the explicit POST confirm consumes it.
 */
export function inspectEmailChangeToken(
  token: string,
  now = Date.now(),
): EmailChangeTokenInspection {
  const payload = verifyEmailChangeToken(token, now)
  if (!payload) return { ok: false }
  const pending = getPendingEmailChange(payload.principal, now)
  if (!pending) return { ok: false }
  if (pending.id !== payload.pendingId || pending.newEmail !== payload.newEmail) {
    return { ok: false }
  }
  return { ok: true, newEmail: pending.newEmail }
}
