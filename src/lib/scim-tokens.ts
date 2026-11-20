import { createHash, randomBytes, randomUUID } from "node:crypto"

/**
 * SCIM bearer-token store — DEVELOPMENT seam.
 *
 * In-memory, per-process store of workspace-scoped SCIM provisioning tokens.
 * Like {@link MemoryAuthBackend} this loses state on restart and does not
 * scale past one process; production MUST persist these rows (hashed, same
 * as here — the plaintext is only ever returned once at creation).
 *
 * Security notes:
 *  - Tokens look like `spim_<43 base64url chars>` (~256 bits of entropy).
 *  - Only the SHA-256 hash is stored; {@link listScimTokens} therefore cannot
 *    leak secrets and shows only a short display `prefix`.
 *  - {@link createScimToken} returns the plaintext token exactly once — the
 *    route layer must surface it in that single response and never again.
 *  - The store is bounded ({@link MAX_SCIM_TOKENS}); when full, the oldest
 *    token (insertion order) is evicted so memory cannot grow unbounded.
 */

const MAX_SCIM_TOKENS = 500
const TOKEN_BYTES = 32
export const SCIM_TOKEN_PREFIX = "spim_"

export type ScimTokenInfo = {
  id: string
  workspaceId: string
  /** Optional human label set at creation time (e.g. "Okta prod"). */
  label: string | null
  /** First characters of the plaintext token — safe to display in lists. */
  prefix: string
  createdAt: string
  /** ISO timestamp of the last successful {@link authenticateScimToken}. */
  lastUsedAt: string | null
}

type StoredScimToken = ScimTokenInfo & {
  /** sha256 hex of the full plaintext token. The secret itself is never kept. */
  tokenHash: string
}

const tokens = new Map<string, StoredScimToken>() // id -> record, insertion order
let counter = 0

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex")
}

function publicInfo(record: StoredScimToken): ScimTokenInfo {
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    label: record.label,
    prefix: record.prefix,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
  }
}

export type CreatedScimToken = ScimTokenInfo & {
  /**
   * Plaintext bearer token. Shown to the caller ONCE — it is not stored and
   * cannot be recovered afterwards.
   */
  token: string
}

/**
 * Creates a SCIM token for `workspaceId`. Returns the plaintext `token`
 * exactly once alongside its safe-to-display metadata.
 */
export function createScimToken(
  workspaceId: string,
  label?: string | null,
  now?: number,
): CreatedScimToken {
  counter += 1
  const secret = randomBytes(TOKEN_BYTES).toString("base64url")
  const token = `${SCIM_TOKEN_PREFIX}${secret}`
  const createdAt = new Date(now ?? Date.now()).toISOString()
  const trimmedLabel = label?.trim() || null

  const record: StoredScimToken = {
    id: `sct_${counter.toString(36)}_${randomUUID().slice(0, 8)}`,
    workspaceId,
    label: trimmedLabel,
    prefix: token.slice(0, SCIM_TOKEN_PREFIX.length + 8),
    createdAt,
    lastUsedAt: null,
    tokenHash: hashToken(token),
  }

  // Bound the store: evict the oldest entries (Map iterates in insertion
  // order and records are only ever appended, never reordered).
  tokens.set(record.id, record)
  while (tokens.size > MAX_SCIM_TOKENS) {
    const oldest = tokens.keys().next()
    if (oldest.done) break
    tokens.delete(oldest.value)
  }

  return { ...publicInfo(record), token }
}

/** Metadata for every live token of a workspace, newest first. Never secrets. */
export function listScimTokens(workspaceId: string): ScimTokenInfo[] {
  const result: ScimTokenInfo[] = []
  for (const record of tokens.values()) {
    if (record.workspaceId === workspaceId) result.push(publicInfo(record))
  }
  return result.reverse()
}

/**
 * Revokes the token `id` when it belongs to `workspaceId`. Returns false for
 * unknown ids and for tokens owned by a different workspace (so a caller
 * cannot probe other workspaces' token ids).
 */
export function revokeScimToken(workspaceId: string, id: string): boolean {
  const record = tokens.get(id)
  if (!record || record.workspaceId !== workspaceId) return false
  tokens.delete(id)
  return true
}

/**
 * Resolves a raw `Authorization: Bearer` value to its workspace. Returns null
 * for missing/forged/unknown tokens. Updates `lastUsedAt` on success.
 */
export function authenticateScimToken(
  raw: string,
): { workspaceId: string; tokenId: string } | null {
  const token = raw.trim()
  if (!token) return null
  const hash = hashToken(token)
  for (const record of tokens.values()) {
    if (record.tokenHash !== hash) continue
    record.lastUsedAt = new Date().toISOString()
    return { workspaceId: record.workspaceId, tokenId: record.id }
  }
  return null
}

/** TEST-ONLY: clears all stored tokens. */
export function resetScimTokensForTests(): void {
  tokens.clear()
  counter = 0
}
