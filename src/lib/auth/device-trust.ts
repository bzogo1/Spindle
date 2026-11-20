/**
 * Device-trust grants — the account-level "I trust this device" layer.
 *
 * This is DISTINCT from `totp-devices.ts` (task 7), which is narrowly scoped
 * to skipping the TOTP challenge when 2FA is enabled. A device-trust grant is
 * a broader, user-managed statement: "this fingerprint belongs to a device I
 * recognize." Trusted devices get REDUCED FRICTION at sign-in — see
 * {@link DEVICE_TRUST_BENEFITS} for the exact checks the integration points
 * may soften.
 *
 * TRUST MODEL (documented choice):
 *  - Trust is bound to the fingerprint HASH (`fp1:<hex>` produced by
 *    `src/lib/device/fingerprint-client.ts`), never to a session id —
 *    sessions rotate on every refresh. Same binding rationale as
 *    `totp-devices.ts`.
 *  - Granting trust requires an authenticated session AND a fingerprint the
 *    session itself registered via `/api/auth/fingerprint` (enforced by the
 *    API route, mirroring the TOTP trust route). The access token carries no
 *    `auth_time`, so "recently authenticated" cannot be proven from the
 *    token alone — routes document this and a follow-up can add a
 *    password/TOTP re-check without changing the store.
 *  - Trust EXPIRES: every grant carries `expiresAt` (default
 *    {@link DEVICE_TRUST_TTL_MS} = 30 days). Expired grants simply stop
 *    matching — they degrade to "untrusted", never to an error. Re-granting
 *    the same fingerprint reactivates the record and extends expiry.
 *  - Revocation is per (userId, grantId); `revokeAll` is the panic button.
 *    Like fingerprints themselves, trust is a SOFT signal: a drifted
 *    fingerprint falls back to full checks.
 *
 * PRIVACY: only the versioned digest is stored — never raw device signals,
 * IPs, or user agents. The digest is already a one-way hash, but clients are
 * still only ever shown {@link maskFingerprintHash} output (version + a few
 * hex chars); the full digest is never echoed by the API.
 *
 * INTEGRATION POINTS (owned elsewhere — do NOT wire blindly):
 *  1. Suspicious-login alerts (`src/lib/auth/login-alerts.ts`): sign-in
 *     routes call `evaluateSuccessfulSignIn`. When the sign-in request
 *     carries a `fingerprint` (`fp1:<hex>`), the route should first call
 *     {@link checkDeviceTrust}(userId, fingerprint); for a trusted device it
 *     may skip `new_device`/`new_ip` alert kinds (velocity/brute_force are
 *     account-level and should still fire) — or annotate the audit metadata
 *     with `deviceTrust: "trusted"`.
 *  2. 2FA skip eligibility: `isTrustedTotpDevice` (totp-devices.ts) remains
 *     the gate for skipping TOTP. A device-trust grant MAY be used by the
 *     sign-in flow to decide whether to OFFER "trust this device" after a
 *     successful TOTP verify, or (policy-dependent) to relax which checks
 *     apply. It must never bypass the password step.
 *  3. `markDeviceTrustSeen` should be called on sign-ins that matched a
 *     grant so `lastSeenAt` reflects real use.
 *
 * Like `MemoryDeviceFingerprintStore`/`MemoryTrustedDeviceStore` this is a
 * DEVELOPMENT store: records live in a bounded in-memory map inside one
 * process and are lost on restart. Production MUST persist them behind the
 * same `DeviceTrustStore` seam (see prisma/AUTH-SCHEMA.md).
 */

import { randomUUID } from "node:crypto"

import { parseDeviceFingerprint } from "@/lib/auth/fingerprint"
import { normalizeDeviceLabel } from "@/lib/auth/totp-devices"

/**
 * Trust levels. `"standard"` is the only level today: it marks the device as
 * user-recognized so sign-in friction checks (login alerts, future step-up
 * prompts) can be reduced. The field exists so a future `"elevated"` level
 * (e.g. longer TTL, broader bypasses) can be added without a schema change.
 */
export type DeviceTrustLevel = "standard"

/**
 * What a standard trust grant is documented to reduce at sign-in time.
 * Consumers (sign-in routes, owned elsewhere) read this list — keep it in
 * sync with the module docs above.
 */
export const DEVICE_TRUST_BENEFITS = [
  /** `new_device`/`new_ip` suspicious-login alerts may be suppressed. */
  "login_alerts_suppressed",
  /** The sign-in flow may treat the device as recognized for step-up prompts. */
  "recognized_device",
] as const

export type DeviceTrustBenefit = (typeof DEVICE_TRUST_BENEFITS)[number]

/** Default grant lifetime: 30 days. */
export const DEVICE_TRUST_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** Bounds for a caller-supplied TTL override (1 hour .. 1 year). */
export const MIN_TRUST_TTL_MS = 60 * 60 * 1000
export const MAX_TRUST_TTL_MS = 366 * 24 * 60 * 60 * 1000
export const DEFAULT_TRUST_LABEL = "Trusted device"
export const MAX_TRUST_LABEL_LENGTH = 60

export type DeviceTrustGrant = {
  id: string
  userId: string
  /** User-supplied or default display label (e.g. "Work laptop"). */
  label: string
  /** Normalized versioned digest, e.g. `"fp1:9f86d0…"`. Never echoed raw to clients. */
  fingerprintHash: string
  /** Algorithm version parsed from the digest prefix, e.g. `"fp1"`. */
  fingerprintVersion: string
  /** Trust level — see {@link DeviceTrustLevel}. */
  level: DeviceTrustLevel
  /** Access-token `sid` of the session that created (or last renewed) the grant. */
  grantedBySessionId: string
  /** ISO timestamp of the FIRST grant; preserved across re-grants. */
  grantedAt: string
  /** ISO timestamp when trust lapses; re-granting extends it. */
  expiresAt: string
  /** Last time a sign-in matched this grant. */
  lastSeenAt: string
  revokedAt: string | null
}

export type GrantDeviceTrustInput = {
  userId: string
  /** Raw `fp1:<hex>` digest; validated and normalized here. */
  fingerprintHash: string
  /** `sid` of the session performing the grant. */
  sessionId: string
  label?: string
  /** Optional TTL override in ms; clamped to [MIN, MAX]. Defaults to 30d. */
  ttlMs?: number
  level?: DeviceTrustLevel
}

export interface DeviceTrustStore {
  /**
   * Grants (or renews) trust for a fingerprint. Idempotent per
   * (userId, fingerprintHash): re-granting an active device refreshes
   * `expiresAt`/`lastSeenAt` and the label; re-granting a revoked or expired
   * device reactivates the SAME record (history preserved, `grantedAt`
   * kept). Throws `TypeError` on a malformed fingerprint digest.
   */
  grant(input: GrantDeviceTrustInput): DeviceTrustGrant
  /** Active, unexpired, non-revoked grants for the user, newest first. */
  listActive(userId: string, now?: number): DeviceTrustGrant[]
  /** Revokes one grant owned by the user. Returns false when absent/foreign. */
  revoke(userId: string, grantId: string): boolean
  /** Revokes every active grant for the user. Returns the count revoked. */
  revokeAll(userId: string, now?: number): number
  /** The active, unexpired grant for a fingerprint, or null. */
  findActiveByFingerprint(
    userId: string,
    fingerprintHash: string,
    now?: number,
  ): DeviceTrustGrant | null
  /** Bumps `lastSeenAt` on an active grant (called on trusted sign-ins). */
  markSeen(grantId: string, now?: number): void
  /** Drops every record for the user (e.g. on account deletion). Returns count. */
  clearForUser(userId: string): number
  /** Test/reset hook: empties the store. */
  clear(): void
}

export const DEFAULT_DEVICE_TRUST_CAPACITY = 5000

function clampTtl(ttlMs: number | undefined): number {
  if (ttlMs === undefined || !Number.isFinite(ttlMs)) return DEVICE_TRUST_TTL_MS
  return Math.min(Math.max(ttlMs, MIN_TRUST_TTL_MS), MAX_TRUST_TTL_MS)
}

function isActive(record: DeviceTrustGrant, now: number): boolean {
  return record.revokedAt === null && Date.parse(record.expiresAt) > now
}

function deviceKey(userId: string, fingerprintHash: string): string {
  // Unit-separator avoids ambiguity if ids ever contain spaces.
  return userId + "\u001f" + fingerprintHash
}

/**
 * Bounded in-memory store keyed by (userId, fingerprintHash) — one record
 * per fingerprint per user, so re-granting updates rather than duplicates.
 * When the store exceeds `capacity` the oldest-touched records are evicted.
 */
export class MemoryDeviceTrustStore implements DeviceTrustStore {
  private records = new Map<string, DeviceTrustGrant>()

  constructor(private readonly capacity = DEFAULT_DEVICE_TRUST_CAPACITY) {}

  grant(input: GrantDeviceTrustInput): DeviceTrustGrant {
    // The store does not trust callers: re-validate and normalize the digest
    // so only well-formed `version:hex` values are ever persisted or matched.
    const parsed = parseDeviceFingerprint(input.fingerprintHash)
    if (!parsed) {
      throw new TypeError(
        `Invalid device fingerprint hash (expected "<version>:<hex>"): ${String(input.fingerprintHash).slice(0, 32)}`,
      )
    }
    const fingerprintHash = `${parsed.version}:${parsed.hash}`
    const now = Date.now()
    const nowIso = new Date(now).toISOString()
    const expiresAt = new Date(now + clampTtl(input.ttlMs)).toISOString()
    const label = normalizeDeviceLabel(input.label)

    const key = deviceKey(input.userId, fingerprintHash)
    const existing = this.records.get(key)

    let record: DeviceTrustGrant
    if (existing) {
      record = {
        ...existing,
        label,
        fingerprintVersion: parsed.version,
        level: input.level ?? existing.level ?? "standard",
        grantedBySessionId: input.sessionId,
        expiresAt,
        lastSeenAt: nowIso,
        revokedAt: null,
      }
      // Re-insert to refresh recency for capacity eviction.
      this.records.delete(key)
      this.records.set(key, record)
    } else {
      record = {
        id: randomUUID(),
        userId: input.userId,
        label,
        fingerprintHash,
        fingerprintVersion: parsed.version,
        level: input.level ?? "standard",
        grantedBySessionId: input.sessionId,
        grantedAt: nowIso,
        expiresAt,
        lastSeenAt: nowIso,
        revokedAt: null,
      }
      this.records.set(key, record)
      this.evictIfNeeded()
    }
    return record
  }

  private evictIfNeeded(): void {
    while (this.records.size > this.capacity) {
      const oldest = this.records.keys().next().value
      if (oldest === undefined) break
      this.records.delete(oldest)
    }
  }

  listActive(userId: string, now = Date.now()): DeviceTrustGrant[] {
    return [...this.records.values()]
      .filter((record) => record.userId === userId && isActive(record, now))
      .sort((a, b) => b.grantedAt.localeCompare(a.grantedAt))
  }

  revoke(userId: string, grantId: string): boolean {
    for (const record of this.records.values()) {
      if (record.userId === userId && record.id === grantId && record.revokedAt === null) {
        record.revokedAt = new Date().toISOString()
        return true
      }
    }
    return false
  }

  revokeAll(userId: string, now = Date.now()): number {
    const nowIso = new Date(now).toISOString()
    let count = 0
    for (const record of this.records.values()) {
      if (record.userId === userId && isActive(record, now)) {
        record.revokedAt = nowIso
        count += 1
      }
    }
    return count
  }

  findActiveByFingerprint(
    userId: string,
    fingerprintHash: string,
    now = Date.now(),
  ): DeviceTrustGrant | null {
    const parsed = parseDeviceFingerprint(fingerprintHash)
    if (!parsed) return null
    const normalized = `${parsed.version}:${parsed.hash}`
    const keyed = this.records.get(deviceKey(userId, normalized))
    if (keyed && isActive(keyed, now)) return keyed
    // Fallback scan keeps lookups correct even if a future store layout
    // stops keying records by fingerprint.
    return (
      [...this.records.values()].find(
        (record) =>
          record.userId === userId &&
          record.fingerprintHash === normalized &&
          isActive(record, now),
      ) ?? null
    )
  }

  markSeen(grantId: string, now = Date.now()): void {
    for (const record of this.records.values()) {
      if (record.id === grantId && isActive(record, now)) {
        record.lastSeenAt = new Date(now).toISOString()
        return
      }
    }
  }

  clearForUser(userId: string): number {
    let count = 0
    for (const [key, record] of this.records) {
      if (record.userId === userId) {
        this.records.delete(key)
        count += 1
      }
    }
    return count
  }

  clear(): void {
    this.records.clear()
  }

  get size(): number {
    return this.records.size
  }
}

let store: DeviceTrustStore = new MemoryDeviceTrustStore()

/** Single seam for the device-trust store (swap for durable storage in prod). */
export function getDeviceTrustStore(): DeviceTrustStore {
  return store
}

/** Test hook: replaces the store. */
export function setDeviceTrustStoreForTests(next: DeviceTrustStore | undefined): void {
  store = next ?? new MemoryDeviceTrustStore()
}

/**
 * Sign-in integration predicate: returns the active trust grant for this
 * (user, fingerprint) pair, or null when the device is untrusted, the grant
 * was revoked, or it expired. Callers use the result to decide which
 * friction checks to reduce — see {@link DEVICE_TRUST_BENEFITS} and the
 * module docs for the exact integration points.
 */
export function checkDeviceTrust(
  userId: string,
  fingerprintHash: string,
  now?: number,
): DeviceTrustGrant | null {
  return getDeviceTrustStore().findActiveByFingerprint(userId, fingerprintHash, now)
}

/** Convenience boolean form of {@link checkDeviceTrust}. */
export function isDeviceTrusted(userId: string, fingerprintHash: string, now?: number): boolean {
  return checkDeviceTrust(userId, fingerprintHash, now) !== null
}

/** Records a trusted-device sign-in so `lastSeenAt` reflects real use. */
export function markDeviceTrustSeen(userId: string, fingerprintHash: string, now?: number): void {
  const grant = checkDeviceTrust(userId, fingerprintHash, now)
  if (grant) getDeviceTrustStore().markSeen(grant.id, now)
}

/**
 * Display-safe fingerprint rendering: `"fp1:9f86d0…f2a1"`. Returns null for
 * malformed input. The full digest never leaves the server — API payloads
 * must use this (or the version alone) when identifying a device to clients.
 */
export function maskFingerprintHash(raw: string): string | null {
  const parsed = parseDeviceFingerprint(raw)
  if (!parsed) return null
  const head = parsed.hash.slice(0, 6)
  const tail = parsed.hash.slice(-4)
  return `${parsed.version}:${head}…${tail}`
}
