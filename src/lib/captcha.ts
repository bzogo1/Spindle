import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"

import { clientEnv } from "@/lib/env"
import { getServerEnv } from "@/lib/env.server"

/**
 * Local proof-of-work CAPTCHA for sensitive auth actions (sign-up, password
 * reset confirm). No external service: the server issues a challenge
 * `{ challengeId, prefix, difficulty }`, the client finds a `nonce` such that
 * `sha256(prefix + nonce)` has at least `difficulty` leading zero bits, and
 * the server verifies the solution once before minting a short-lived
 * HMAC-signed `captchaToken` that protected routes require in the body.
 *
 * Server-only: imports `env.server`, which throws if bundled for the browser.
 * The client-side solver lives in `src/components/auth/captcha-widget.tsx`.
 *
 * Multi-instance caveat: both the challenge store and the used-token (`jti`)
 * set live in this process's memory. On serverless/multi-instance deploys a
 * challenge issued by one instance cannot be verified by another, and a
 * captcha token minted on one instance may be rejected by another. This
 * blunts abuse on single-instance/self-hosted deploys; horizontal scaling
 * needs sticky sessions or a shared store (Redis/DB) as the upgrade path.
 */

/**
 * Leading zero bits required in the digest. Calibrated against the pure-JS
 * solver in `captcha-widget.tsx` (~0.4–1M hashes/s on modern devices):
 * 20 bits ≈ 1M hashes average ≈ 1–3s solve time.
 */
export const CAPTCHA_POW_BITS = 20
/** Challenges expire quickly; solving takes seconds, not minutes. */
export const CAPTCHA_CHALLENGE_TTL_MS = 5 * 60 * 1000
/** Minted captcha tokens are short-lived but reusable within the window. */
export const CAPTCHA_TOKEN_TTL_MS = 5 * 60 * 1000
/** Bound on live challenges so the store cannot grow without limit. */
export const CAPTCHA_MAX_CHALLENGES = 10_000
/** Failed nonce guesses per challenge before it is burned. */
export const CAPTCHA_MAX_ATTEMPTS = 10
/** Sweep expired entries once the store crosses this size. */
const PRUNE_THRESHOLD = 1_000

const NONCE_PATTERN = /^\d{1,15}$/
const CHALLENGE_ID_PATTERN = /^[0-9a-f]{16}$/
const DEV_FALLBACK_SECRET = "spindle-dev-only-insecure-session-secret-do-not-use"

export type CaptchaChallenge = {
  challengeId: string
  /** String the client must hash together with the nonce. */
  prefix: string
  /** Required count of leading zero bits in the sha256 digest. */
  difficulty: number
  /** ISO timestamp when the challenge stops being verifiable. */
  expiresAt: string
}

type StoredChallenge = {
  prefix: string
  difficulty: number
  expiresAtMs: number
  attempts: number
  consumed: boolean
}

const challenges = new Map<string, StoredChallenge>()

/**
 * Single-use tracking for minted captcha tokens, keyed by `jti`. A token is
 * burned on its first successful `verifyCaptchaToken` call — i.e. when a
 * protected route accepts it — so it cannot be replayed within its TTL.
 * Same per-process caveat as the challenge store (see header).
 */
const usedTokens = new Map<string, number>() // jti -> expiry epoch ms
const USED_TOKENS_PRUNE_THRESHOLD = 5_000

function pruneUsedTokens(at: number) {
  if (usedTokens.size < USED_TOKENS_PRUNE_THRESHOLD) return
  for (const [jti, expiresAtMs] of usedTokens) {
    if (expiresAtMs <= at) usedTokens.delete(jti)
  }
}

function nowMs(): number {
  return Date.now()
}

function pruneExpired(at: number) {
  if (challenges.size < PRUNE_THRESHOLD) return
  for (const [id, challenge] of challenges) {
    if (challenge.expiresAtMs <= at) challenges.delete(id)
  }
}

/**
 * Creates and stores a fresh challenge. The `prefix` embeds the challenge id
 * plus a random salt so solutions cannot be precomputed or shared across
 * challenges; it is kept short so `prefix + nonce` stays a single sha256
 * block for typical nonce sizes.
 */
export function issueCaptchaChallenge(
  options: {
    now?: number
    difficulty?: number
  } = {},
): CaptchaChallenge {
  const at = options.now ?? nowMs()
  pruneExpired(at)

  // Bound the store: evict oldest entries (Map preserves insertion order).
  while (challenges.size >= CAPTCHA_MAX_CHALLENGES) {
    const oldest = challenges.keys().next().value
    if (oldest === undefined) break
    challenges.delete(oldest)
  }

  const challengeId = randomBytes(8).toString("hex")
  const salt = randomBytes(8).toString("hex")
  const prefix = `spindle-pow:${challengeId}:${salt}:`
  const difficulty = options.difficulty ?? CAPTCHA_POW_BITS
  const expiresAtMs = at + CAPTCHA_CHALLENGE_TTL_MS

  challenges.set(challengeId, { prefix, difficulty, expiresAtMs, attempts: 0, consumed: false })

  return {
    challengeId,
    prefix,
    difficulty,
    expiresAt: new Date(expiresAtMs).toISOString(),
  }
}

function leadingZeroBitsAtLeast(digest: Buffer, bits: number): boolean {
  let remaining = bits
  for (const byte of digest) {
    if (remaining <= 0) return true
    if (byte === 0) {
      remaining -= 8
      continue
    }
    let mask = 0x80
    while (mask && remaining > 0) {
      if (byte & mask) return false
      remaining -= 1
      mask >>= 1
    }
    return remaining <= 0
  }
  return remaining <= 0
}

/**
 * Verifies `{ challengeId, nonce }` against a live challenge. On success the
 * challenge is consumed (single-use) and `true` is returned; on failure the
 * attempt counter grows and the challenge is burned after
 * `CAPTCHA_MAX_ATTEMPTS` misses. Unknown, expired, or consumed challenges
 * always return false.
 */
export function verifyCaptchaSolution(input: {
  challengeId: unknown
  nonce: unknown
  now?: number
}): boolean {
  const { challengeId, nonce } = input
  if (typeof challengeId !== "string" || !CHALLENGE_ID_PATTERN.test(challengeId)) return false
  if (typeof nonce !== "string" || !NONCE_PATTERN.test(nonce)) return false

  const at = input.now ?? nowMs()
  const challenge = challenges.get(challengeId)
  if (!challenge) return false
  if (
    challenge.expiresAtMs <= at ||
    challenge.consumed ||
    challenge.attempts >= CAPTCHA_MAX_ATTEMPTS
  ) {
    challenges.delete(challengeId)
    return false
  }

  const digest = createHash("sha256")
    .update(challenge.prefix + nonce, "utf8")
    .digest()
  if (!leadingZeroBitsAtLeast(digest, challenge.difficulty)) {
    challenge.attempts += 1
    if (challenge.attempts >= CAPTCHA_MAX_ATTEMPTS) challenges.delete(challengeId)
    return false
  }

  challenges.delete(challengeId)
  return true
}

// ---------------------------------------------------------------------------
// Captcha token (HMAC-signed, mirrors token-codec.ts envelope)
// ---------------------------------------------------------------------------

type CaptchaTokenPayload = {
  purpose: "captcha"
  /** Challenge id this token was minted for (audit/debug only). */
  cid: string
  /** Unique token id — burned on first successful verification (single-use). */
  jti: string
  iat: number // epoch seconds
  exp: number // epoch seconds
}

const TOKEN_VERSION = "v1"

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
  return Buffer.from(input, "utf8").toString("base64url")
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

/** Mints a captcha token after a challenge has been solved. */
export function createCaptchaToken(
  challengeId: string,
  now?: number,
): {
  token: string
  expiresAt: Date
} {
  const at = Math.floor((now ?? nowMs()) / 1000)
  const exp = at + Math.floor(CAPTCHA_TOKEN_TTL_MS / 1000)
  const payload: CaptchaTokenPayload = {
    purpose: "captcha",
    cid: challengeId,
    jti: randomBytes(8).toString("hex"),
    iat: at,
    exp,
  }
  const body = `${TOKEN_VERSION}.${base64UrlEncode(JSON.stringify(payload))}`
  return {
    token: `${body}.${sign(body, signingKeys()[0])}`,
    expiresAt: new Date(exp * 1000),
  }
}

/**
 * Verifies a captcha token's signature, version, expiry, and single-use
 * status. SIDE EFFECT: a token that passes all checks is burned (its `jti`
 * recorded) so it cannot be verified twice — callers must treat a `null`
 * return as "no valid captcha presented" and a non-null return as consuming
 * the token. Returns the challenge id on success, null for anything
 * malformed, forged, expired, or already used.
 */
export function verifyCaptchaToken(token: unknown, now?: number): string | null {
  if (typeof token !== "string" || token.length > 2048) return null
  const parts = token.split(".")
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return null

  const body = `${parts[0]}.${parts[1]}`
  const signature = parts[2]
  const valid = signingKeys().some((key) => signaturesMatch(sign(body, key), signature))
  if (!valid) return null

  let payload: CaptchaTokenPayload
  try {
    payload = JSON.parse(base64UrlDecode(parts[1]).toString("utf8")) as CaptchaTokenPayload
  } catch {
    return null
  }
  if (payload.purpose !== "captcha") return null
  if (typeof payload.cid !== "string" || typeof payload.jti !== "string") return null
  if (typeof payload.exp !== "number") return null

  const at = now ?? nowMs()
  const expiresAtMs = payload.exp * 1000
  if (expiresAtMs <= at) return null

  // Single-use: reject jtis already burned by an earlier verification.
  const burnedAt = usedTokens.get(payload.jti)
  if (burnedAt !== undefined) {
    if (burnedAt > at) return null
    usedTokens.delete(payload.jti)
  }
  usedTokens.set(payload.jti, expiresAtMs)
  pruneUsedTokens(at)

  return payload.cid
}

/** Convenience guard for protected routes: true when `token` is a live captcha token. */
export function isCaptchaTokenValid(token: unknown): boolean {
  return verifyCaptchaToken(token) !== null
}

/** Test hook: drops all stored challenges and burned token ids. */
export function resetCaptchaStoreForTests(): void {
  challenges.clear()
  usedTokens.clear()
}
