import {
  decodeBase64Url,
  encodeBase64Url,
  signWithKeyring,
  verifyWithKeyring,
  type Keyring,
} from "./keyring"

/** Claims carried by a signed session token. Keep the payload small. */
export type SessionClaims = {
  sub: string
  iat: number
  exp: number
  [claim: string]: unknown
}

export type SessionVerification =
  | { ok: true; claims: SessionClaims; key: "current" | "previous" }
  | { ok: false; reason: "malformed" | "expired" | "invalid-signature" }

export type SignSessionOptions = {
  keyring: Keyring
  now?: number
  ttlSeconds?: number
}

const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7
const TOKEN_SEGMENT = /^[A-Za-z0-9_-]+$/

/**
 * Signs a session token as `<payload>.<signature>`. The current key signs; the
 * previous key only verifies, which is what makes a session-secret rotation
 * safe while old tokens are still in flight.
 */
export function signSession(
  claims: Omit<SessionClaims, "iat" | "exp"> & Partial<Pick<SessionClaims, "iat" | "exp">>,
  options: SignSessionOptions,
): string {
  const now = options.now ?? Math.floor(Date.now() / 1000)
  const iat = claims.iat ?? now
  const exp = claims.exp ?? iat + (options.ttlSeconds ?? DEFAULT_TTL_SECONDS)

  if (!claims.sub) throw new Error("Session claims require a subject.")
  if (exp <= iat) throw new Error("Session expiry must be after the issue time.")

  const payload = encodeBase64Url(JSON.stringify({ ...claims, iat, exp }))
  return `${payload}.${signWithKeyring(options.keyring, payload)}`
}

/**
 * Verifies a session token against the current key and, during a rotation
 * window, the previous key. The returned `key` name is safe to log.
 */
export function verifySession(
  token: string,
  options: { keyring: Keyring; now?: number },
): SessionVerification {
  const parts = token.split(".")
  if (parts.length !== 2) return { ok: false, reason: "malformed" }

  const [payload, signature] = parts
  if (!payload || !signature || !TOKEN_SEGMENT.test(payload) || !TOKEN_SEGMENT.test(signature)) {
    return { ok: false, reason: "malformed" }
  }

  const key = verifyWithKeyring(options.keyring, payload, signature)
  if (!key) return { ok: false, reason: "invalid-signature" }

  const decoded = decodeBase64Url(payload)
  if (!decoded) return { ok: false, reason: "malformed" }

  let parsed: unknown
  try {
    parsed = JSON.parse(decoded)
  } catch {
    return { ok: false, reason: "malformed" }
  }

  if (!isSessionClaims(parsed)) return { ok: false, reason: "malformed" }

  const now = options.now ?? Math.floor(Date.now() / 1000)
  if (parsed.exp <= now) return { ok: false, reason: "expired" }

  return { ok: true, claims: parsed, key }
}

function isSessionClaims(value: unknown): value is SessionClaims {
  if (typeof value !== "object" || value === null) return false

  const claims = value as Record<string, unknown>

  return (
    typeof claims.sub === "string" &&
    claims.sub.length > 0 &&
    typeof claims.iat === "number" &&
    Number.isFinite(claims.iat) &&
    typeof claims.exp === "number" &&
    Number.isFinite(claims.exp)
  )
}
