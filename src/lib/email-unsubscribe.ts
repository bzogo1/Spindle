import { createHmac, timingSafeEqual } from "node:crypto"

import { clientEnv } from "@/lib/env"
import { getServerEnv } from "@/lib/env.server"

/**
 * Unsubscribe tokens and the opt-out store for marketing email.
 *
 * Tokens are HMAC-SHA256-signed compact envelopes (`u1.<payload>.<sig>`),
 * modeled on `src/lib/auth/token-codec.ts` but domain-separated: the signed
 * body is prefixed with `email-unsubscribe` so an auth token can never be
 * replayed here and vice versa. Links in marketing emails carry the token, so
 * anyone holding the link (the recipient, or a mailbox provider's
 * List-Unsubscribe handler) can unsubscribe that address — but nobody can
 * unsubscribe an arbitrary address without a valid token for it.
 *
 * KNOWN LIMITATION: opt-outs live in a process-local `Map`. On a single
 * instance (or serverless with one warm container) this works, but with
 * multiple instances/restarts an opt-out recorded on one instance is
 * invisible to the others — a subscriber could keep receiving mail after
 * unsubscribing, or appear unsubscribed after a redeploy. This is an
 * interim store only. The upgrade path is an `EmailOptOut` table keyed by
 * (normalized email, scope) with `unsubscribedAt`, read/written here instead
 * of the Map; the function signatures are already shaped for that swap.
 *
 * Server-only: imports `env.server`, which throws if bundled for the browser.
 */

/** Scopes an address can opt out of. `"all"` covers every category. */
export const DEFAULT_UNSUBSCRIBE_SCOPE = "marketing"
export const ALL_UNSUBSCRIBE_SCOPE = "all"

const TOKEN_VERSION = "u1"
const DOMAIN = "email-unsubscribe"
/** Links in email must keep working for months; 180 days is generous. */
export const UNSUBSCRIBE_TOKEN_TTL_SECONDS = 180 * 24 * 60 * 60

const DEV_FALLBACK_SECRET = "spindle-dev-only-insecure-unsubscribe-secret"

export type UnsubscribeTokenPayload = {
  purpose: "email-unsubscribe"
  /** Normalized (lowercased, trimmed) recipient address. */
  email: string
  /** Opt-out scope, e.g. "marketing", "newsletter", or "all". */
  scope: string
  iat: number // epoch seconds
  exp: number // epoch seconds
}

function signingKeys(): string[] {
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

function base64UrlEncode(input: string): string {
  return Buffer.from(input).toString("base64url")
}

function base64UrlDecode(input: string): Buffer {
  return Buffer.from(input, "base64url")
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url")
}

function signaturesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/** Lowercased, trimmed — the canonical form used for tokens and opt-outs. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function normalizeScope(scope: string | null | undefined): string {
  const trimmed = (scope ?? "").trim().toLowerCase()
  return trimmed.length > 0 ? trimmed : DEFAULT_UNSUBSCRIBE_SCOPE
}

/**
 * Mints a signed unsubscribe token for `email`. The token embeds the address
 * and scope, so the link alone is sufficient — the `email` query param on the
 * URL is informational and must match the token when present.
 */
export function createUnsubscribeToken(input: {
  email: string
  scope?: string
  ttlSeconds?: number
  now?: number // epoch seconds; injectable for tests
}): { token: string; expiresAt: Date } {
  const now = input.now ?? Math.floor(Date.now() / 1000)
  const ttl = input.ttlSeconds ?? UNSUBSCRIBE_TOKEN_TTL_SECONDS
  const payload: UnsubscribeTokenPayload = {
    purpose: "email-unsubscribe",
    email: normalizeEmail(input.email),
    scope: normalizeScope(input.scope),
    iat: now,
    exp: now + ttl,
  }
  const body = `${DOMAIN}.${TOKEN_VERSION}.${base64UrlEncode(JSON.stringify(payload))}`
  return {
    token: `${body}.${sign(body, signingKeys()[0])}`,
    expiresAt: new Date(payload.exp * 1000),
  }
}

export type VerifiedUnsubscribeToken = {
  email: string
  scope: string
  expiresAt: Date
}

/**
 * Verifies signature, version, shape, and expiry. Returns the payload fields
 * or null for anything malformed, forged, or expired.
 */
export function verifyUnsubscribeToken(token: string): VerifiedUnsubscribeToken | null {
  const parts = token.split(".")
  // Envelope: "email-unsubscribe" is a single segment, so split gives
  // [domain, version, payload, signature].
  if (parts.length !== 4) return null
  const [domain, version, encodedPayload, signature] = parts
  if (domain !== DOMAIN || version !== TOKEN_VERSION) return null

  const body = `${domain}.${version}.${encodedPayload}`
  const keys = signingKeys()
  const valid = keys.some((key) => signaturesMatch(sign(body, key), signature))
  if (!valid) return null

  let payload: UnsubscribeTokenPayload
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload).toString("utf8"))
  } catch {
    return null
  }
  if (payload?.purpose !== "email-unsubscribe") return null
  if (typeof payload.email !== "string" || payload.email.length === 0) return null
  if (typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) return null

  return {
    email: payload.email,
    scope: normalizeScope(payload.scope),
    expiresAt: new Date(payload.exp * 1000),
  }
}

/**
 * Absolute URL to embed in email footers / List-Unsubscribe headers. The page
 * at `/unsubscribe` confirms before mutating; `/api/email/unsubscribe` is the
 * machine endpoint (GET status, POST one-click).
 */
export function unsubscribePageUrl(input: {
  email: string
  origin: string
  scope?: string
}): string {
  const { token } = createUnsubscribeToken({
    email: input.email,
    scope: input.scope,
  })
  const params = new URLSearchParams({
    token,
    email: normalizeEmail(input.email),
  })
  return `${input.origin.replace(/\/+$/, "")}/unsubscribe?${params.toString()}`
}

// ---------------------------------------------------------------------------
// Opt-out store (in-memory; see module docstring for the upgrade path)
// ---------------------------------------------------------------------------

const optOuts = new Map<string, number>() // `${scope}${email}` → epoch ms

function optOutKey(scope: string, email: string): string {
  return `${normalizeScope(scope)}${normalizeEmail(email)}`
}

/** Records an opt-out. Idempotent; later calls refresh the timestamp. */
export function unsubscribeAddress(email: string, scope: string = DEFAULT_UNSUBSCRIBE_SCOPE): void {
  optOuts.set(optOutKey(scope, email), Date.now())
}

/**
 * Clears the opt-out recorded for `email` in `scope` — the inverse of
 * `unsubscribeAddress`, used when the address explicitly re-consents (e.g. a
 * newsletter re-subscribe). Other scopes, including `"all"`, are untouched.
 */
export function resubscribeAddress(email: string, scope: string = DEFAULT_UNSUBSCRIBE_SCOPE): void {
  optOuts.delete(optOutKey(scope, email))
}

/**
 * True when `email` has opted out. With `scope`, checks that scope plus the
 * catch-all `"all"` scope; without it, true if the address opted out of
 * anything.
 */
export function isUnsubscribed(email: string, scope?: string): boolean {
  const normalized = normalizeEmail(email)
  if (scope !== undefined) {
    return (
      optOuts.has(optOutKey(scope, normalized)) ||
      optOuts.has(optOutKey(ALL_UNSUBSCRIBE_SCOPE, normalized))
    )
  }
  const suffix = `${normalized}`
  for (const key of optOuts.keys()) {
    if (key.endsWith(suffix)) return true
  }
  return false
}

/** Test hook: clears all recorded opt-outs. */
export function clearUnsubscribeStore(): void {
  optOuts.clear()
}
