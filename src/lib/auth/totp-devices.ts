/**
 * Trusted-device store for TOTP two-factor authentication.
 *
 * A "trusted device" is a browser profile (identified by the versioned
 * fingerprint digest produced by `src/lib/device/fingerprint-client.ts` and
 * validated by `parseDeviceFingerprint` in `./fingerprint`) that the user has
 * explicitly marked as safe to skip the second factor on. Trusting is always
 * an affirmative user action from an authenticated session — never inferred.
 *
 * TRUST MODEL (documented choice):
 *  - Trust is bound to the fingerprint HASH, not the session. Sessions rotate
 *    on every refresh, so keying trust to `sid` would expire it immediately.
 *    The fingerprint is the stable device identity already used by
 *    `/api/auth/fingerprint` for login alerts.
 *  - A trusted device SKIPS the TOTP challenge entirely on subsequent
 *    sign-ins that present the same fingerprint — this is the standard
 *    "remember this device" trade-off (like GitHub/Google). The password is
 *    still required; only the second factor is bypassed.
 *  - Because the fingerprint is a soft signal (browser updates can shift it),
 *    a drifted fingerprint simply falls back to the normal TOTP challenge —
 *    trust degrades safely, it never hard-fails.
 *  - Fingerprints are low-entropy digests, not secrets: possession of one is
 *    NOT sufficient to sign in (the password step still gates), but it IS
 *    sufficient to skip 2FA. Users can revoke any device at any time; revoke
 *    is per (userId, fingerprint) and `revokeAll` is the panic button.
 *
 * INTEGRATION POINT (verify-login is owned elsewhere — do NOT wire there
 * blindly): the password sign-in route (`/api/auth/signin` or the backend's
 * `signIn`) is where `totp_required` is decided. To consume this store, that
 * flow must:
 *    1. accept an optional `fingerprint` (`fp1:<hex>`) in the sign-in body,
 *       falling back to nothing when absent (clients already compute it via
 *       `getDeviceFingerprint()`), and
 *    2. before returning `totp_required`, call
 *       {@link isTrustedTotpDevice}(userId, fingerprint) — when true, issue
 *       tokens directly and call {@link markTrustedDeviceUsed}.
 *  The TOTP challenge/verify-login path stays unchanged: a trusted device
 *  simply never reaches it.
 *
 * Like `MemoryDeviceFingerprintStore` this is a DEVELOPMENT store: records
 * live in a bounded in-memory map inside one process and are lost on restart.
 * Production MUST persist them behind the same `TrustedDeviceStore` seam
 * (see prisma/AUTH-SCHEMA.md). Only the fingerprint digest is stored — never
 * raw signals, IPs, or user agents.
 */

import { randomUUID } from "node:crypto"

import { parseDeviceFingerprint } from "@/lib/auth/fingerprint"

export type TrustedTotpDevice = {
  id: string
  userId: string
  /** User-supplied or default display label (e.g. "Work laptop"). */
  label: string
  /** Normalized versioned digest, e.g. `"fp1:9f86d0…"`. Never echoed raw to clients beyond `fingerprintVersion`. */
  fingerprintHash: string
  /** Algorithm version parsed from the digest prefix, e.g. `"fp1"`. */
  fingerprintVersion: string
  /** Access-token `sid` of the session that created the trust record. */
  sessionId: string
  createdAt: string
  lastUsedAt: string
  revokedAt: string | null
}

export type TrustDeviceInput = {
  userId: string
  /** Raw `fp1:<hex>` digest; validated and normalized here. */
  fingerprintHash: string
  /** `sid` of the session performing the trust action. */
  sessionId: string
  label?: string
}

export interface TrustedDeviceStore {
  /**
   * Marks a fingerprint as trusted for the user. Idempotent per
   * (userId, fingerprintHash): re-trusting an active device refreshes
   * `lastUsedAt` and the label; re-trusting a revoked device reactivates the
   * same record (clearing `revokedAt`) so history is preserved.
   * Throws `TypeError` on a malformed fingerprint digest.
   */
  trust(input: TrustDeviceInput): TrustedTotpDevice
  /** Active (non-revoked) devices for the user, newest first. */
  listActive(userId: string): TrustedTotpDevice[]
  /** Revokes one device owned by the user. Returns false when absent/foreign. */
  revoke(userId: string, deviceId: string): boolean
  /** Revokes every active device for the user. Returns the count revoked. */
  revokeAll(userId: string): number
  /** The active record for a fingerprint, or null. */
  findActiveByFingerprint(userId: string, fingerprintHash: string): TrustedTotpDevice | null
  /** Bumps `lastUsedAt` on an active record (called on trusted sign-ins). */
  markUsed(deviceId: string): void
  /** Drops every record for the user (e.g. on 2FA disable). Returns count. */
  clearForUser(userId: string): number
  /** Test/reset hook: empties the store. */
  clear(): void
}

export const DEFAULT_TRUSTED_DEVICE_CAPACITY = 5000
export const MAX_DEVICE_LABEL_LENGTH = 60
export const DEFAULT_DEVICE_LABEL = "Trusted device"

/** Sanitizes a user-supplied label: trim, collapse whitespace, cap length. */
export function normalizeDeviceLabel(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_DEVICE_LABEL
  const cleaned = raw.trim().replace(/\s+/g, " ").slice(0, MAX_DEVICE_LABEL_LENGTH)
  return cleaned.length > 0 ? cleaned : DEFAULT_DEVICE_LABEL
}

function deviceKey(userId: string, fingerprintHash: string): string {
  // Unit-separator avoids ambiguity if ids ever contain spaces.
  return userId + "\u001f" + fingerprintHash
}

/**
 * Bounded in-memory store keyed by (userId, fingerprintHash) — one record
 * per fingerprint per user, so re-trusting updates rather than duplicates.
 * When the store exceeds `capacity` the oldest-touched records are evicted.
 */
export class MemoryTrustedDeviceStore implements TrustedDeviceStore {
  private records = new Map<string, TrustedTotpDevice>()

  constructor(private readonly capacity = DEFAULT_TRUSTED_DEVICE_CAPACITY) {}

  trust(input: TrustDeviceInput): TrustedTotpDevice {
    // The store does not trust callers: re-validate and normalize the digest
    // so only well-formed `version:hex` values are ever persisted or matched.
    const parsed = parseDeviceFingerprint(input.fingerprintHash)
    if (!parsed) {
      throw new TypeError(
        `Invalid device fingerprint hash (expected "<version>:<hex>"): ${String(input.fingerprintHash).slice(0, 32)}`,
      )
    }
    const fingerprintHash = `${parsed.version}:${parsed.hash}`
    const now = new Date().toISOString()
    const label = normalizeDeviceLabel(input.label)

    const key = deviceKey(input.userId, fingerprintHash)
    const existing = this.records.get(key)

    let record: TrustedTotpDevice
    if (existing) {
      record = {
        ...existing,
        label,
        sessionId: input.sessionId,
        lastUsedAt: now,
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
        sessionId: input.sessionId,
        createdAt: now,
        lastUsedAt: now,
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

  listActive(userId: string): TrustedTotpDevice[] {
    return [...this.records.values()]
      .filter((record) => record.userId === userId && record.revokedAt === null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  revoke(userId: string, deviceId: string): boolean {
    for (const record of this.records.values()) {
      if (record.userId === userId && record.id === deviceId && record.revokedAt === null) {
        record.revokedAt = new Date().toISOString()
        return true
      }
    }
    return false
  }

  revokeAll(userId: string): number {
    const now = new Date().toISOString()
    let count = 0
    for (const record of this.records.values()) {
      if (record.userId === userId && record.revokedAt === null) {
        record.revokedAt = now
        count += 1
      }
    }
    return count
  }

  findActiveByFingerprint(userId: string, fingerprintHash: string): TrustedTotpDevice | null {
    const parsed = parseDeviceFingerprint(fingerprintHash)
    if (!parsed) return null
    const normalized = `${parsed.version}:${parsed.hash}`
    const keyed = this.records.get(deviceKey(userId, normalized))
    if (keyed && keyed.revokedAt === null) return keyed
    // Fallback scan keeps lookups correct even if a future store layout
    // stops keying records by fingerprint.
    return (
      [...this.records.values()].find(
        (record) =>
          record.userId === userId &&
          record.fingerprintHash === normalized &&
          record.revokedAt === null,
      ) ?? null
    )
  }

  markUsed(deviceId: string): void {
    for (const record of this.records.values()) {
      if (record.id === deviceId && record.revokedAt === null) {
        record.lastUsedAt = new Date().toISOString()
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

let store: TrustedDeviceStore = new MemoryTrustedDeviceStore()

/** Single seam for the trusted-device store (swap for durable storage in prod). */
export function getTrustedDeviceStore(): TrustedDeviceStore {
  return store
}

/** Test hook: replaces the store. */
export function setTrustedDeviceStoreForTests(next: TrustedDeviceStore | undefined): void {
  store = next ?? new MemoryTrustedDeviceStore()
}

/**
 * Skip-challenge predicate for the sign-in flow. Returns true when the user
 * has an ACTIVE trusted-device record for this fingerprint — the caller
 * (password sign-in, see module docs) should then issue tokens directly and
 * call {@link markTrustedDeviceUsedByFingerprint} instead of returning a
 * TOTP challenge.
 */
export function isTrustedTotpDevice(
  userId: string,
  fingerprintHash: string,
): TrustedTotpDevice | null {
  return getTrustedDeviceStore().findActiveByFingerprint(userId, fingerprintHash)
}

/** Records a trusted-device sign-in so `lastUsedAt` reflects real use. */
export function markTrustedDeviceUsedByFingerprint(userId: string, fingerprintHash: string): void {
  const device = isTrustedTotpDevice(userId, fingerprintHash)
  if (device) getTrustedDeviceStore().markUsed(device.id)
}
