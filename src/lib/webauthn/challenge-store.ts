/**
 * In-memory WebAuthn challenge store.
 *
 * Challenges are single-use, TTL-bound, and bound to (userId, purpose) so a
 * registration challenge can never be replayed as an authentication
 * challenge (or vice versa). `consume` is atomic: it returns the challenge
 * exactly once, then marks it consumed — replay attempts fail.
 *
 * Like the trusted-device store this is a DEVELOPMENT store: records live
 * in a bounded in-memory map inside one process and are lost on restart.
 * Production MUST persist challenges (DB or Redis) behind the same
 * `WebAuthnChallengeStore` seam. Only hashes would be needed at rest since
 * challenges are already random, but the plaintext is stored for parity
 * with the parse-once flow.
 */

import { randomBytes, randomUUID } from "node:crypto"

import type { ChallengePurpose, CredentialKind, StoredChallenge } from "./types"

export const CHALLENGE_TTL_MS = 5 * 60 * 1000
export const CHALLENGE_CAPACITY = 10_000

export interface WebAuthnChallengeStore {
  /** Issues a fresh challenge for (userId, purpose); returns the stored record. */
  issue(input: {
    userId: string
    purpose: ChallengePurpose
    /** Register-purpose flavour: "passkey" marks a resident-key ceremony. */
    kind?: CredentialKind
  }): StoredChallenge
  /**
   * Atomically consumes a challenge by id. Returns the record only when it
   * exists, is unconsumed, unexpired, and belongs to (userId, purpose).
   *
   * Anonymous challenges: `issue` accepts `userId: ""` for the
   * unauthenticated authentication begin (discoverable-credential sign-in,
   * where the owner is unknown until the assertion arrives). Such a record
   * may be consumed under ANY userId — but still only for its own purpose,
   * still single-use, still TTL-bound. The assertion's signature is what
   * proves identity; the challenge only proves freshness.
   *
   * A mismatched consume does NOT burn the challenge (avoids a DoS where an
   * attacker with a leaked id could invalidate a victim's in-flight flow).
   */
  consume(id: string, userId: string, purpose: ChallengePurpose): StoredChallenge | null
  /** Test/reset hook: empties the store. */
  clear(): void
}

export class MemoryChallengeStore implements WebAuthnChallengeStore {
  private records = new Map<string, StoredChallenge>()

  constructor(
    private readonly ttlMs = CHALLENGE_TTL_MS,
    private readonly capacity = CHALLENGE_CAPACITY,
    private readonly now: () => number = () => Date.now(),
  ) {}

  issue(input: {
    userId: string
    purpose: ChallengePurpose
    kind?: CredentialKind
  }): StoredChallenge {
    const at = this.now()
    this.prune(at)
    const record: StoredChallenge = {
      id: randomUUID(),
      userId: input.userId,
      purpose: input.purpose,
      ...(input.kind ? { kind: input.kind } : {}),
      challenge: randomBytes(32).toString("base64url"),
      createdAt: new Date(at).toISOString(),
      expiresAt: new Date(at + this.ttlMs).toISOString(),
      consumedAt: null,
    }
    this.records.set(record.id, record)
    this.evictIfNeeded()
    return record
  }

  consume(id: string, userId: string, purpose: ChallengePurpose): StoredChallenge | null {
    const record = this.records.get(id)
    if (!record) return null
    if (record.userId !== "" && record.userId !== userId) return null
    if (record.purpose !== purpose) return null
    if (record.consumedAt !== null) return null
    if (this.now() > Date.parse(record.expiresAt)) return null
    record.consumedAt = new Date(this.now()).toISOString()
    return record
  }

  private prune(at: number): void {
    if (this.records.size < this.capacity) return
    for (const [key, record] of this.records) {
      if (record.consumedAt !== null || Date.parse(record.expiresAt) <= at) {
        this.records.delete(key)
      }
    }
  }

  private evictIfNeeded(): void {
    while (this.records.size > this.capacity) {
      const oldest = this.records.keys().next().value
      if (oldest === undefined) break
      this.records.delete(oldest)
    }
  }

  clear(): void {
    this.records.clear()
  }
}

let store: WebAuthnChallengeStore = new MemoryChallengeStore()

/** Single seam for the challenge store (swap for durable storage in prod). */
export function getChallengeStore(): WebAuthnChallengeStore {
  return store
}

/** Test hook: replaces the store. */
export function setChallengeStoreForTests(next: WebAuthnChallengeStore | undefined): void {
  store = next ?? new MemoryChallengeStore()
}
