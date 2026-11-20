import { createHmac, timingSafeEqual } from "node:crypto"

import { clientEnv } from "@/lib/env"
import { getServerEnv } from "@/lib/env.server"

/**
 * Signed-token codec for short-lived auth artifacts (access tokens, TOTP
 * login challenges). HMAC-SHA256 over a compact `payload.signature` envelope.
 *
 * The signing key is `SESSION_SECRET`; `SESSION_SECRET_PREVIOUS` is accepted
 * for verification only, which is what makes zero-downtime key rotation
 * possible. Refresh tokens and emailed links are opaque random values stored
 * hashed — they do NOT go through this codec.
 *
 * Server-only: imports `env.server`, which throws if bundled for the browser.
 */

export type TokenPurpose = "access" | "totp-challenge"

export type AccessTokenPayload = {
  purpose: "access"
  /** Opaque session id; revocation looks this up server-side. */
  sid: string
  uid: string
  email: string
  name: string | null
  exp: number // epoch seconds
}

export type TotpChallengePayload = {
  purpose: "totp-challenge"
  uid: string
  /** Issued-at epoch seconds; challenges are single-use and short-lived. */
  iat: number
  exp: number
}

export type SignedPayload = AccessTokenPayload | TotpChallengePayload

const TOKEN_VERSION = "v1"
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60
const TOTP_CHALLENGE_TTL_SECONDS = 5 * 60

/** Dev-only fallback so local development works without provisioning secrets. */
const DEV_FALLBACK_SECRET = "spindle-dev-only-insecure-session-secret-do-not-use"

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
    // getServerEnv refuses to run outside a Node runtime (e.g. jsdom unit
    // tests); the dev fallback keeps those tests working. In production a
    // missing/broken env must never silently downgrade the signing key.
    if (clientEnv.NODE_ENV === "production") throw error
    return [DEV_FALLBACK_SECRET]
  }
}

function base64UrlEncode(input: string | Buffer): string {
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

/** Signs `payload` into a compact token string. */
export function signAuthToken(payload: SignedPayload): string {
  const body = `${TOKEN_VERSION}.${base64UrlEncode(JSON.stringify(payload))}`
  // Sign with the newest key only; verification tries every configured key.
  return `${body}.${sign(body, signingKeys()[0])}`
}

function verifyAuthTokenInternal<P extends TokenPurpose>(
  token: string,
  expectedPurpose: P,
  enforceExpiry: boolean,
): Extract<SignedPayload, { purpose: P }> | null {
  const parts = token.split(".")
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return null

  const body = `${parts[0]}.${parts[1]}`
  const signature = parts[2]
  const keys = signingKeys()
  const valid = keys.some((key) => signaturesMatch(sign(body, key), signature))
  if (!valid) return null

  let payload: SignedPayload
  try {
    payload = JSON.parse(base64UrlDecode(parts[1]).toString("utf8")) as SignedPayload
  } catch {
    return null
  }

  if (payload.purpose !== expectedPurpose) return null
  if (typeof payload.exp !== "number") return null
  if (enforceExpiry && payload.exp * 1000 <= Date.now()) return null
  return payload as Extract<SignedPayload, { purpose: P }>
}

/**
 * Verifies signature, version, and expiry. Returns the parsed payload or null
 * for anything malformed, forged, or expired. `expectedPurpose` narrows the
 * result type for callers.
 */
export function verifyAuthToken<P extends TokenPurpose>(
  token: string,
  expectedPurpose: P,
): Extract<SignedPayload, { purpose: P }> | null {
  return verifyAuthTokenInternal(token, expectedPurpose, true)
}

/**
 * Same checks as `verifyAuthToken` but skips the expiry check. Used by
 * coarse page-guard gates that only need to know a session cookie is genuine:
 * an expired access token still proves the visitor holds a real session, and
 * the client-side session provider can refresh it. Never use for decisions
 * that grant access to protected data.
 */
export function verifyAuthTokenIgnoreExpiry<P extends TokenPurpose>(
  token: string,
  expectedPurpose: P,
): Extract<SignedPayload, { purpose: P }> | null {
  return verifyAuthTokenInternal(token, expectedPurpose, false)
}

export function createAccessToken(input: {
  sid: string
  uid: string
  email: string
  name: string | null
}): { token: string; expiresAt: Date } {
  const exp = Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SECONDS
  return {
    token: signAuthToken({ purpose: "access", ...input, exp }),
    expiresAt: new Date(exp * 1000),
  }
}

export function createTotpChallenge(uid: string): { token: string; expiresAt: Date } {
  const now = Math.floor(Date.now() / 1000)
  return {
    token: signAuthToken({
      purpose: "totp-challenge",
      uid,
      iat: now,
      exp: now + TOTP_CHALLENGE_TTL_SECONDS,
    }),
    expiresAt: new Date((now + TOTP_CHALLENGE_TTL_SECONDS) * 1000),
  }
}

export const ACCESS_TOKEN_TTL_SECONDS_EXPORTED = ACCESS_TOKEN_TTL_SECONDS
