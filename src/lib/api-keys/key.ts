import { createHash, randomBytes } from "node:crypto"

/**
 * API key primitives — generation, hashing, parsing, and scope checks.
 *
 * Server-only module. The plaintext key is returned exactly once at creation;
 * only its SHA-256 hash and a short display prefix are ever persisted.
 *
 * Key format: `sk_<env>_<secret>` where env is `live` or `test` and the secret
 * is 32 random bytes encoded as unpadded base64url (~43 chars). The full key
 * is ~52 characters, e.g. `sk_live_9f3k...`. See docs/api/key-management.md.
 */

export const API_KEY_ENVIRONMENTS = ["live", "test"] as const
export type ApiKeyEnvironment = (typeof API_KEY_ENVIRONMENTS)[number]

/**
 * Coarse-grained permission scopes, ordered weakest → strongest. `admin`
 * implies every other scope; `write` implies `read`. Unknown scopes in a
 * stored record are ignored rather than failing verification.
 */
export const API_KEY_SCOPES = ["read", "write", "admin"] as const
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number]

const SCOPE_RANK: Record<ApiKeyScope, number> = { read: 0, write: 1, admin: 2 }

const SECRET_BYTES = 32
const KEY_PATTERN = /^sk_(live|test)_([A-Za-z0-9_-]{20,128})$/
/** First N characters of the full key kept for lookup and display. */
export const KEY_PREFIX_LENGTH = 12

export type GeneratedApiKey = {
  /** Full plaintext key — shown to the caller once, never stored. */
  key: string
  /** First `KEY_PREFIX_LENGTH` chars (`sk_live_ab…`) — safe to store/display. */
  prefix: string
  environment: ApiKeyEnvironment
}

/** Generate a new API key. `randomBytes` is injectable for tests. */
export function generateApiKey(
  environment: ApiKeyEnvironment = "live",
  random: (size: number) => Buffer = randomBytes,
): GeneratedApiKey {
  const secret = random(SECRET_BYTES).toString("base64url")
  const key = `sk_${environment}_${secret}`
  return { key, prefix: key.slice(0, KEY_PREFIX_LENGTH), environment }
}

/**
 * SHA-256 hex digest of the full key. SHA-256 (not a password KDF) is correct
 * here because API keys carry ~256 bits of entropy — there is nothing to
 * brute-force, and a fast hash keeps per-request verification cheap. Timing-
 * safe comparison happens at verification time against stored records.
 */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex")
}

/** Parse a presented key into environment + secret, or null if malformed. */
export function parseApiKey(
  key: string,
): { environment: ApiKeyEnvironment; secret: string; prefix: string } | null {
  const match = KEY_PATTERN.exec(key.trim())
  if (!match) return null
  const environment = match[1] as ApiKeyEnvironment
  return { environment, secret: match[2], prefix: key.trim().slice(0, KEY_PREFIX_LENGTH) }
}

/** True when `presented` is one of `granted` scopes (or a stronger one). */
export function hasScope(granted: readonly string[], required: ApiKeyScope): boolean {
  let best = -1
  for (const scope of granted) {
    const rank = SCOPE_RANK[scope as ApiKeyScope]
    if (rank !== undefined && rank > best) best = rank
  }
  return best >= SCOPE_RANK[required]
}

/** Validate the shape of a scope list at creation time. */
export function normalizeScopes(scopes: readonly string[]): ApiKeyScope[] {
  const out = new Set<ApiKeyScope>()
  for (const scope of scopes) {
    if ((API_KEY_SCOPES as readonly string[]).includes(scope)) {
      out.add(scope as ApiKeyScope)
    }
  }
  if (out.size === 0) out.add("read")
  return [...out]
}

export function isKeyExpired(expiresAt: Date | null | undefined, now: Date = new Date()): boolean {
  return expiresAt != null && expiresAt.getTime() <= now.getTime()
}
