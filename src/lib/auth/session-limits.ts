import { z } from "zod"

/**
 * Concurrent session limits.
 *
 * Caps how many active auth sessions a single user may hold at once. When a
 * new session is minted and the user is already at the cap, the OLDEST active
 * session(s) are revoked so the newest sign-in always survives.
 *
 * ENFORCEMENT POINT: `MemoryAuthBackend.issueTokens` in
 * `src/lib/auth/backend.ts` — the single funnel every session-creation path
 * flows through (password sign-in, TOTP verify, refresh-token rotation,
 * OAuth callback, passwordless/magic-link verify, signup auto sign-in). No
 * route needs to opt in; all flows get the cap for free.
 *
 * STORE SEAM: limits live in a bounded in-memory map inside one process and
 * are lost on restart — same trade-off as {@link MemoryAuthBackend} and
 * {@link MemorySecurityPolicyStore}. `getSessionLimitStore` /
 * `setSessionLimitStoreForTests` is the single seam where a durable backend
 * (Prisma) plugs in — see prisma/AUTH-SCHEMA.md.
 *
 * LIMIT SEMANTICS: the stored value is the maximum number of *concurrent
 * active* sessions. `0` ({@link UNLIMITED_SESSION_LIMIT}) means no cap.
 * Users who never saved a limit get {@link DEFAULT_SESSION_LIMIT}.
 */

/** Sessions allowed per user when no explicit limit is stored. */
export const DEFAULT_SESSION_LIMIT = 5
/** Smallest meaningful cap (1 = single active session). */
export const MIN_SESSION_LIMIT = 1
/** Largest configurable cap; keeps abuse bounded. */
export const MAX_SESSION_LIMIT = 50
/** Stored value meaning "no limit". */
export const UNLIMITED_SESSION_LIMIT = 0

/** PUT body schema for `/api/auth/session-limits`. */
export const sessionLimitSchema = z
  .object({
    limit: z.number().int().min(UNLIMITED_SESSION_LIMIT).max(MAX_SESSION_LIMIT),
  })
  .strict()

/**
 * Minimal session descriptor the eviction planner needs. Structurally
 * compatible with `StoredSession` in backend.ts — kept dependency-free so
 * the planner is unit-testable without the backend.
 */
export interface SessionDescriptor {
  id: string
  /** Epoch ms when the session was created. */
  createdAt: number
  /** Epoch ms when revoked, or null while active. */
  revokedAt: number | null
  /** Epoch ms when the refresh token expires. */
  expiresAt: number
}

export interface SessionLimitStore {
  /** Effective limit for a user: stored value, else {@link DEFAULT_SESSION_LIMIT}. */
  getLimit(userId: string): number
  /** The user's explicitly stored limit, or null when unset. */
  getStoredLimit(userId: string): number | null
  /** Stores a limit (0 = unlimited) and returns the effective value. */
  setLimit(userId: string, limit: number): number
}

/**
 * In-memory limit store keyed by user id. Bounded by the number of users who
 * ever save a limit — acceptable for the dev seam.
 */
export class MemorySessionLimitStore implements SessionLimitStore {
  private limits = new Map<string, number>()

  getLimit(userId: string): number {
    return this.limits.get(userId) ?? DEFAULT_SESSION_LIMIT
  }

  getStoredLimit(userId: string): number | null {
    return this.limits.get(userId) ?? null
  }

  setLimit(userId: string, limit: number): number {
    this.limits.set(userId, limit)
    return limit
  }
}

let sessionLimitStore: SessionLimitStore = new MemorySessionLimitStore()

/** Single seam for the limit store (swap for a durable backend in prod). */
export function getSessionLimitStore(): SessionLimitStore {
  return sessionLimitStore
}

/** Test hook: replaces the limit store. */
export function setSessionLimitStoreForTests(next: SessionLimitStore | undefined): void {
  sessionLimitStore = next ?? new MemorySessionLimitStore()
}

/**
 * Pure eviction planner: given a user's sessions and their effective limit,
 * returns the ids of the sessions to revoke — oldest first — so the active
 * count drops to at most `limit`. Revoked and expired sessions never count.
 *
 * `preserveId` marks a session that must survive even when its `createdAt`
 * ties with older sessions (the session being minted right now). It still
 * counts toward the limit; only eviction candidacy is excluded.
 *
 * Returns `[]` when `limit` is {@link UNLIMITED_SESSION_LIMIT} or when the
 * user is already within the cap.
 */
export function planSessionEvictions(
  sessions: readonly SessionDescriptor[],
  limit: number,
  options: { now?: number; preserveId?: string } = {},
): string[] {
  if (limit <= UNLIMITED_SESSION_LIMIT) return []
  const now = options.now ?? Date.now()

  const active = sessions.filter((s) => s.revokedAt === null && s.expiresAt > now)
  const overflow = active.length - limit
  if (overflow <= 0) return []

  const candidates = active
    .filter((s) => s.id !== options.preserveId)
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  return candidates.slice(0, Math.min(overflow, candidates.length)).map((s) => s.id)
}
