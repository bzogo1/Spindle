/**
 * Server-side device-fingerprint store.
 *
 * Pairs with `src/lib/device/fingerprint-client.ts`: the browser computes a
 * versioned, hashed digest of low-entropy device signals (raw signals never
 * leave the client) and POSTs only the digest to `/api/auth/fingerprint`.
 * This module keeps a per-session record so the auth layer can distinguish
 * "same device as last sign-in" (`known`) from "first time we see this
 * device for this user" (`new`) or "a different device than before"
 * (`changed`). Matches are a SOFT signal — fingerprints drift with browser
 * updates, zoom, and devtools docking, so callers must not hard-fail on
 * `changed`.
 *
 * Like {@link MemoryAuthAuditLog} this is a DEVELOPMENT store: records live
 * in a bounded in-memory map inside one process and are lost on restart.
 * It exists so the mechanism is exercisable in dev and tests; production
 * MUST persist records behind the same `DeviceFingerprintStore` seam (see
 * prisma/AUTH-SCHEMA.md).
 *
 * Privacy: only the already-hashed digest (`fp1:<hex>`) is stored — never
 * raw signals, IPs are not stored here (audit events carry those), and no
 * PII is accepted.
 */

export type DeviceFingerprintMatch =
  /** First fingerprint ever registered for this user. */
  | "new"
  /** Hash matches a fingerprint this user has registered before. */
  | "known"
  /** User has fingerprints on file, but this hash is not among them. */
  | "changed"

export type DeviceFingerprintRecord = {
  userId: string
  /** Access-token session id (`sid`) the fingerprint was registered under. */
  sessionId: string
  /** Latest versioned digest, e.g. `"fp1:9f86d0…"`. */
  hash: string
  /** Algorithm version parsed from the digest prefix, e.g. `"fp1"`. */
  version: string
  /** Every distinct digest seen for this session (bounded by capacity). */
  hashes: string[]
  firstSeenAt: string
  lastSeenAt: string
  /** Number of registrations for this session record. */
  seenCount: number
}

export type RegisterDeviceFingerprintInput = {
  userId: string
  sessionId: string
  hash: string
}

export type RegisterDeviceFingerprintResult = {
  match: DeviceFingerprintMatch
  record: DeviceFingerprintRecord
}

export interface DeviceFingerprintStore {
  /**
   * Upserts the session's fingerprint record and reports how the digest
   * compares to everything this user has registered before.
   *
   * `input.hash` must be a versioned digest (`<version>:<hex>`, see
   * {@link parseDeviceFingerprint}); it is validated and normalized
   * (lowercased) here so callers cannot smuggle malformed or mixed-case
   * values into the store. Throws `TypeError` on invalid input.
   */
  register(input: RegisterDeviceFingerprintInput): RegisterDeviceFingerprintResult
  getForSession(sessionId: string): DeviceFingerprintRecord | null
  listForUser(userId: string): DeviceFingerprintRecord[]
  /** Drops one session's record (e.g. on sign-out). Returns true if present. */
  removeSession(sessionId: string): boolean
  /** Test/reset hook: empties the store. */
  clear(): void
}

export const DEFAULT_FINGERPRINT_CAPACITY = 5000
/** Cap on distinct digests remembered per session record. */
const MAX_HASHES_PER_SESSION = 8

/**
 * Parses a client-supplied fingerprint into `{ version, hash }`, or null
 * when malformed. Accepts `<version>:<hex-digest>` where the version is a
 * short lowercase token (`fp1`, future `fp2`, …) and the digest is 16–128
 * hex chars (SHA-256 hex is 64; the FNV fallback is 16). Anything else —
 * missing prefix, non-hex, absurd length — is rejected rather than stored.
 */
export function parseDeviceFingerprint(raw: unknown): { version: string; hash: string } | null {
  if (typeof raw !== "string") return null
  const match = /^([a-z0-9]{1,16}):([0-9a-f]{16,128})$/i.exec(raw.trim())
  if (!match) return null
  return { version: match[1].toLowerCase(), hash: match[2].toLowerCase() }
}

function recordKey(userId: string, sessionId: string): string {
  // Unit-separator avoids ambiguity if ids ever contain spaces.
  return userId + "\u001f" + sessionId
}

/**
 * Bounded in-memory fingerprint store keyed by (userId, sessionId). When the
 * store exceeds `capacity` the oldest-touched records are evicted.
 */
export class MemoryDeviceFingerprintStore implements DeviceFingerprintStore {
  private records = new Map<string, DeviceFingerprintRecord>()

  constructor(private readonly capacity = DEFAULT_FINGERPRINT_CAPACITY) {}

  register(input: RegisterDeviceFingerprintInput): RegisterDeviceFingerprintResult {
    // The store does not trust callers: re-validate and normalize the digest
    // so only well-formed `version:hex` values are ever persisted or matched.
    const parsed = parseDeviceFingerprint(input.hash)
    if (!parsed) {
      throw new TypeError(
        `Invalid device fingerprint hash (expected "<version>:<hex>"): ${String(input.hash).slice(0, 32)}`,
      )
    }
    const hash = `${parsed.version}:${parsed.hash}`

    const key = recordKey(input.userId, input.sessionId)
    const now = new Date().toISOString()

    // Match BEFORE mutating: compare against every digest this user has
    // on file (across all sessions), including this session's previous ones.
    let seenByUser = false
    let known = false
    for (const record of this.records.values()) {
      if (record.userId !== input.userId) continue
      seenByUser = true
      if (record.hashes.includes(hash)) {
        known = true
        break
      }
    }
    const match: DeviceFingerprintMatch = !seenByUser ? "new" : known ? "known" : "changed"

    const existing = this.records.get(key)
    let record: DeviceFingerprintRecord
    if (existing) {
      record = {
        ...existing,
        hash,
        version: parsed.version,
        hashes: existing.hashes.includes(hash)
          ? existing.hashes
          : [...existing.hashes, hash].slice(-MAX_HASHES_PER_SESSION),
        lastSeenAt: now,
        seenCount: existing.seenCount + 1,
      }
      // Re-insert to refresh recency for capacity eviction.
      this.records.delete(key)
      this.records.set(key, record)
    } else {
      record = {
        userId: input.userId,
        sessionId: input.sessionId,
        hash,
        version: parsed.version,
        hashes: [hash],
        firstSeenAt: now,
        lastSeenAt: now,
        seenCount: 1,
      }
      this.records.set(key, record)
      this.evictIfNeeded()
    }
    return { match, record }
  }

  private evictIfNeeded(): void {
    while (this.records.size > this.capacity) {
      const oldest = this.records.keys().next().value
      if (oldest === undefined) break
      this.records.delete(oldest)
    }
  }

  getForSession(sessionId: string): DeviceFingerprintRecord | null {
    for (const record of this.records.values()) {
      if (record.sessionId === sessionId) return record
    }
    return null
  }

  listForUser(userId: string): DeviceFingerprintRecord[] {
    return [...this.records.values()].filter((record) => record.userId === userId)
  }

  removeSession(sessionId: string): boolean {
    for (const [key, record] of this.records) {
      if (record.sessionId === sessionId) {
        this.records.delete(key)
        return true
      }
    }
    return false
  }

  clear(): void {
    this.records.clear()
  }

  get size(): number {
    return this.records.size
  }
}

let fingerprintStore: DeviceFingerprintStore = new MemoryDeviceFingerprintStore()

/** Single seam for the fingerprint store (swap for durable storage in prod). */
export function getDeviceFingerprintStore(): DeviceFingerprintStore {
  return fingerprintStore
}

/** Test hook: replaces the fingerprint store. */
export function setDeviceFingerprintStoreForTests(next: DeviceFingerprintStore | undefined): void {
  fingerprintStore = next ?? new MemoryDeviceFingerprintStore()
}
