import { randomUUID } from "node:crypto"

import type { NextResponse } from "next/server"

import { isAdminEmail } from "@/lib/admin"
import type { AuthUser } from "@/lib/auth/backend"
import { getServerEnv } from "@/lib/env.server"
import { createAccessToken, signAuthToken } from "@/lib/auth/token-codec"

/**
 * Admin impersonation sessions.
 *
 * DESIGN
 * ------
 * Starting an impersonation does NOT create a backend session for the target
 * (the `AuthBackend` seam has no "session for user X with constraints" API,
 * and `createSessionForUser` would mint a full 30-day refreshable session —
 * far too powerful for a support tool). Instead we mint a SHORT-LIVED access
 * token (purpose `"access"`, 30 min) whose `sid` is `imp_<recordId>` and whose
 * `uid`/`email`/`name` are the TARGET user's. Only the `spindle_at` cookie is
 * replaced; the admin's `spindle_rt` refresh cookie is left untouched, so:
 *
 *  - the impersonated session cannot refresh (its sid matches no backend
 *    session), and the impersonation dies with the token's `exp`;
 *  - when the impersonation token expires, `/api/auth/session` falls back to
 *    the admin's still-valid refresh cookie and silently restores the admin
 *    session — the time-box is enforced by the JWT itself;
 *  - stopping impersonation re-mints a normal admin access token from the
 *    admin claims stored on the record; the admin's real session is never
 *    destroyed.
 *
 * The record (`MemoryImpersonationStore`) is the audit trail: every start and
 * end (manual stop, expiry, invalidation) is a row with admin identity,
 * target identity, timestamps, and end reason. Like the rest of the auth
 * layer this is a DEVELOPMENT store — production must persist it (see
 * prisma/AUTH-SCHEMA.md).
 *
 * ESCALATION GUARDS (enforced here and in the routes):
 *  - target cannot be the admin themselves (self-impersonation);
 *  - target cannot be an admin (`isAdminEmail`) — an impersonated admin
 *    session would carry admin rights;
 *  - an impersonated session cannot start a new impersonation: the routes
 *    re-resolve the caller's email from the backend and `isAdminEmail`
 *    rejects non-admin targets, and only one active record per admin is
 *    allowed anyway;
 *  - admin surfaces (`/api/admin/*`, `/app/admin/*`) re-check `isAdminEmail`
 *    on every request, so the impersonated session loses admin access for
 *    its duration — impersonation shows what the user actually sees.
 */

export const IMPERSONATION_TTL_MS = 30 * 60 * 1000 // 30 minutes

/**
 * httpOnly cookie holding the impersonation record id. Read by the status and
 * stop routes; never exposed to client JS (the UI learns state via
 * GET .../status).
 */
export const IMPERSONATION_COOKIE = "spindle_imp"

export type ImpersonationEndReason = "stopped" | "expired" | "invalidated"

export type ImpersonationRecord = {
  id: string
  /** Admin who started the session. */
  adminUserId: string
  adminEmail: string
  adminName: string | null
  /** `sid` claim of the admin's access token — used to restore their session. */
  adminSessionId: string
  /** Target user being impersonated. */
  targetUserId: string
  targetEmail: string
  targetName: string | null
  startedAt: string
  /** ISO timestamp when the impersonation token expires (startedAt + TTL). */
  expiresAt: string
  endedAt: string | null
  endReason: ImpersonationEndReason | null
}

export type NewImpersonationInput = {
  adminUserId: string
  adminEmail: string
  adminName: string | null
  adminSessionId: string
  target: AuthUser
  now?: number
}

export type CreateImpersonationResult =
  | { ok: true; record: ImpersonationRecord; accessToken: string }
  | {
      ok: false
      reason: "self" | "admin_target" | "already_active"
      message: string
    }

/**
 * Bounded in-memory store for impersonation records. Records double as the
 * audit log — there is no separate event stream because every state
 * transition is already captured on the record itself.
 */
export class MemoryImpersonationStore {
  private records = new Map<string, ImpersonationRecord>()

  constructor(private readonly capacity = 500) {}

  /**
   * Newest-first snapshot of all records (audit view / tests). Stamps lazy
   * expiry first so a record past `expiresAt` never shows `endReason: null`
   * in history views — consistent with `getActive`/the finders.
   */
  list(now = Date.now()): ImpersonationRecord[] {
    for (const record of this.records.values()) {
      this.expireIfStale(record, now)
    }
    return [...this.records.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  }

  get(id: string): ImpersonationRecord | null {
    return this.records.get(id) ?? null
  }

  /**
   * Stamps `endReason: "expired"` on a live record whose `expiresAt` has
   * passed. Every read path that can observe a record goes through this so
   * expired rows never linger as "active" in `list()`/audit views.
   */
  private expireIfStale(record: ImpersonationRecord, now: number): boolean {
    if (record.endReason === null && new Date(record.expiresAt).getTime() <= now) {
      record.endedAt = new Date(now).toISOString()
      record.endReason = "expired"
      return true
    }
    return false
  }

  /** Record if it exists and has not ended/expired; lazily closes expiry. */
  getActive(id: string, now = Date.now()): ImpersonationRecord | null {
    const record = this.records.get(id)
    if (!record) return null
    if (this.expireIfStale(record, now)) return null
    return record.endReason === null ? record : null
  }

  /** The admin's currently active impersonation, if any. */
  findActiveByAdmin(adminUserId: string, now = Date.now()): ImpersonationRecord | null {
    for (const record of this.records.values()) {
      if (record.adminUserId !== adminUserId) continue
      if (this.expireIfStale(record, now)) continue
      if (record.endReason === null) return record
    }
    return null
  }

  /** The impersonation a target session is currently living under, if any. */
  findActiveByTarget(targetUserId: string, now = Date.now()): ImpersonationRecord | null {
    for (const record of this.records.values()) {
      if (record.targetUserId !== targetUserId) continue
      if (this.expireIfStale(record, now)) continue
      if (record.endReason === null) return record
    }
    return null
  }

  create(input: NewImpersonationInput): ImpersonationRecord {
    const now = input.now ?? Date.now()
    const record: ImpersonationRecord = {
      id: `imp_${randomUUID()}`,
      adminUserId: input.adminUserId,
      adminEmail: input.adminEmail,
      adminName: input.adminName,
      adminSessionId: input.adminSessionId,
      targetUserId: input.target.id,
      targetEmail: input.target.email,
      targetName: input.target.name,
      startedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + IMPERSONATION_TTL_MS).toISOString(),
      endedAt: null,
      endReason: null,
    }
    this.records.set(record.id, record)
    // Bounded like the audit log: drop the oldest ended records first.
    if (this.records.size > this.capacity) {
      const evictable = [...this.records.values()]
        .filter((r) => r.endReason !== null)
        .sort((a, b) => (a.endedAt ?? "").localeCompare(b.endedAt ?? ""))
      for (const victim of evictable.slice(0, this.records.size - this.capacity)) {
        this.records.delete(victim.id)
      }
    }
    return record
  }

  /** Marks a record ended; returns the updated record or null if unknown. */
  end(id: string, reason: ImpersonationEndReason, now = Date.now()): ImpersonationRecord | null {
    const record = this.records.get(id)
    if (!record || record.endReason !== null) return record ?? null
    record.endedAt = new Date(now).toISOString()
    record.endReason = reason
    return record
  }

  /** Test/reset hook. */
  clear(): void {
    this.records.clear()
  }
}

let store: MemoryImpersonationStore | undefined

/** Single seam for the impersonation store (swap for durable storage in prod). */
export function getImpersonationStore(): MemoryImpersonationStore {
  store ??= new MemoryImpersonationStore()
  return store
}

/** Test hook: replaces the store. */
export function setImpersonationStoreForTests(next: MemoryImpersonationStore | undefined): void {
  store = next
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * Client-safe view of an impersonation record. Strips admin identity and
 * audit internals (`adminUserId`, `adminEmail`, `adminName`,
 * `adminSessionId`) — safe to return to the impersonated (target) session,
 * which must never learn which admin is behind the session.
 */
export function serializeImpersonationRecord(record: ImpersonationRecord) {
  return {
    id: record.id,
    targetEmail: record.targetEmail,
    targetName: record.targetName,
    startedAt: record.startedAt,
    expiresAt: record.expiresAt,
    endedAt: record.endedAt,
    endReason: record.endReason,
  }
}

/** Admin-facing variant that additionally exposes `adminEmail` for audit. */
export function serializeImpersonationRecordForAdmin(record: ImpersonationRecord) {
  return { ...serializeImpersonationRecord(record), adminEmail: record.adminEmail }
}

// ---------------------------------------------------------------------------
// Session minting
// ---------------------------------------------------------------------------

/**
 * Mints the short-lived access token that powers the impersonated session.
 * `sid` is `imp_<recordId>` — deliberately NOT a backend session id, so the
 * token can never be refreshed into a persistent session.
 */
export function mintImpersonationAccessToken(
  record: ImpersonationRecord,
  target: AuthUser,
): { token: string; expiresAt: Date } {
  const exp = Math.floor(new Date(record.expiresAt).getTime() / 1000)
  return {
    token: signAuthToken({
      purpose: "access",
      sid: record.id,
      uid: target.id,
      email: target.email,
      name: target.name,
      exp,
    }),
    expiresAt: new Date(exp * 1000),
  }
}

/**
 * Re-mints a normal access token for the admin from the claims captured when
 * impersonation started. The admin's refresh cookie was never touched, so
 * their session continues seamlessly once this cookie is set.
 */
export function mintAdminRestoreToken(record: ImpersonationRecord): {
  token: string
  expiresAt: Date
} {
  return createAccessToken({
    sid: record.adminSessionId,
    uid: record.adminUserId,
    email: record.adminEmail,
    name: record.adminName,
  })
}

// ---------------------------------------------------------------------------
// Cookie plumbing (mirrors lib/auth/http.ts cookieBase — kept local because
// http.ts is outside this feature's ownership)
// ---------------------------------------------------------------------------

function cookieBase() {
  const secure = getServerEnv().NODE_ENV === "production"
  return { httpOnly: true, secure, sameSite: "lax" as const, path: "/" }
}

/**
 * Writes the impersonation cookies: `spindle_at` becomes the target's
 * short-lived token and `spindle_imp` marks the active record. The admin's
 * `spindle_rt` is intentionally left alone.
 */
export function applyImpersonationCookies(
  response: NextResponse,
  input: { accessToken: string; recordId: string },
): NextResponse {
  const base = cookieBase()
  response.cookies.set("spindle_at", input.accessToken, { ...base, path: "/" })
  response.cookies.set(IMPERSONATION_COOKIE, input.recordId, { ...base, path: "/" })
  return response
}

/**
 * Restores the admin session cookies: fresh admin access token + clears the
 * impersonation marker. Refresh cookie untouched (it never changed).
 */
export function applyAdminRestoreCookies(
  response: NextResponse,
  input: { accessToken: string },
): NextResponse {
  const base = cookieBase()
  response.cookies.set("spindle_at", input.accessToken, { ...base, path: "/" })
  response.cookies.set(IMPERSONATION_COOKIE, "", { ...base, path: "/", maxAge: 0 })
  return response
}

/** Clears only the impersonation marker (e.g. status found it stale). */
export function clearImpersonationMarker(response: NextResponse): NextResponse {
  response.cookies.set(IMPERSONATION_COOKIE, "", {
    ...cookieBase(),
    path: "/",
    maxAge: 0,
  })
  return response
}

// ---------------------------------------------------------------------------
// Start validation
// ---------------------------------------------------------------------------

/**
 * Validates and records a new impersonation. Returns the record plus the
 * minted access token, or a typed failure the route maps to HTTP status.
 */
export function startImpersonation(input: NewImpersonationInput): CreateImpersonationResult {
  const { adminUserId, target } = input
  if (target.id === adminUserId) {
    return {
      ok: false,
      reason: "self",
      message: "You cannot impersonate your own account.",
    }
  }
  if (isAdminEmail(target.email)) {
    return {
      ok: false,
      reason: "admin_target",
      message: "Admin accounts cannot be impersonated.",
    }
  }
  const store = getImpersonationStore()
  if (store.findActiveByAdmin(adminUserId)) {
    return {
      ok: false,
      reason: "already_active",
      message: "An impersonation session is already active. Stop it first.",
    }
  }
  const record = store.create(input)
  const { token } = mintImpersonationAccessToken(record, target)
  return { ok: true, record, accessToken: token }
}
