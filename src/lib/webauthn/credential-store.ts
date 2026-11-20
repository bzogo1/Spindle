/**
 * In-memory WebAuthn credential (security key) store.
 *
 * Stores the public half of each registered credential: the credential id,
 * the COSE-encoded EC2/P-256 public key, the authenticator signature
 * counter, transports, and lifecycle timestamps. Private keys never leave
 * the authenticator.
 *
 * Credential ids are globally unique (authenticator-generated random
 * strings), so `findActiveByCredentialId` looks up across users — the
 * assertion ceremony proves possession, and the route layer still scopes
 * management operations by userId.
 *
 * Like the challenge store this is a DEVELOPMENT store: records live in a
 * bounded in-memory map inside one process and are lost on restart.
 * Production MUST persist credentials behind the same
 * `WebAuthnCredentialStore` seam (see prisma/AUTH-SCHEMA.md).
 */

import { DEFAULT_CREDENTIAL_KIND } from "./types"
import type { CredentialKind, CredentialView, StoredCredential } from "./types"

export const MAX_CREDENTIAL_LABEL_LENGTH = 60
export const DEFAULT_CREDENTIAL_LABEL = "Security key"

/** Sanitizes a user-supplied label: trim, collapse whitespace, cap length. */
export function normalizeCredentialLabel(
  raw: unknown,
  fallback = DEFAULT_CREDENTIAL_LABEL,
): string {
  if (typeof raw !== "string") return fallback
  const cleaned = raw.trim().replace(/\s+/g, " ").slice(0, MAX_CREDENTIAL_LABEL_LENGTH)
  return cleaned.length > 0 ? cleaned : fallback
}

export interface WebAuthnCredentialStore {
  /** Inserts a credential. Throws TypeError when the id is already registered. */
  save(input: {
    userId: string
    credentialId: string
    publicKeyCose: string
    counter: number
    transports: string[]
    aaguid: string | null
    /** "passkey" for resident-key registrations, else "security-key". */
    kind?: CredentialKind
    label?: string
  }): StoredCredential
  /** Active credentials for the user, newest first. */
  listActive(userId: string): StoredCredential[]
  /** Active credential by id across all users (assertion lookup), or null. */
  findActiveByCredentialId(credentialId: string): StoredCredential | null
  /** Active credential owned by the user, or null. */
  findActiveForUser(userId: string, credentialId: string): StoredCredential | null
  /** Renames a credential owned by the user. Returns null when absent/foreign. */
  rename(userId: string, credentialId: string, label: string): StoredCredential | null
  /** Revokes a credential owned by the user. Returns false when absent/foreign. */
  revoke(userId: string, credentialId: string): boolean
  /** Records a successful assertion: bumps counter + lastUsedAt. */
  touch(credentialId: string, counter: number): void
  /** Drops every record for the user. Returns count. */
  clearForUser(userId: string): number
  /** Test/reset hook. */
  clear(): void
}

export const CREDENTIAL_CAPACITY = 50_000

export class MemoryCredentialStore implements WebAuthnCredentialStore {
  private records = new Map<string, StoredCredential>()

  constructor(private readonly capacity = CREDENTIAL_CAPACITY) {}

  save(input: {
    userId: string
    credentialId: string
    publicKeyCose: string
    counter: number
    transports: string[]
    aaguid: string | null
    kind?: CredentialKind
    label?: string
  }): StoredCredential {
    if (this.records.has(input.credentialId)) {
      throw new TypeError(`Credential id already registered: ${input.credentialId}`)
    }
    const now = new Date().toISOString()
    const record: StoredCredential = {
      id: input.credentialId,
      userId: input.userId,
      label: normalizeCredentialLabel(
        input.label,
        input.kind === "passkey" ? "Passkey" : DEFAULT_CREDENTIAL_LABEL,
      ),
      publicKeyCose: input.publicKeyCose,
      counter: input.counter,
      transports: [...input.transports],
      aaguid: input.aaguid,
      kind: input.kind ?? DEFAULT_CREDENTIAL_KIND,
      createdAt: now,
      lastUsedAt: now,
      revokedAt: null,
    }
    this.records.set(record.id, record)
    this.evictIfNeeded()
    return record
  }

  private evictIfNeeded(): void {
    // Eviction prefers revoked records first, then oldest-created actives.
    while (this.records.size > this.capacity) {
      let victim: string | null = null
      for (const [key, record] of this.records) {
        if (record.revokedAt !== null) {
          victim = key
          break
        }
      }
      if (victim === null) {
        let oldest: StoredCredential | null = null
        for (const record of this.records.values()) {
          if (
            record.revokedAt === null &&
            (oldest === null || record.createdAt < oldest.createdAt)
          ) {
            oldest = record
          }
        }
        victim = oldest?.id ?? null
      }
      if (victim === null) break
      this.records.delete(victim)
    }
  }

  listActive(userId: string): StoredCredential[] {
    return [...this.records.values()]
      .filter((record) => record.userId === userId && record.revokedAt === null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  findActiveByCredentialId(credentialId: string): StoredCredential | null {
    const record = this.records.get(credentialId)
    return record && record.revokedAt === null ? record : null
  }

  findActiveForUser(userId: string, credentialId: string): StoredCredential | null {
    const record = this.findActiveByCredentialId(credentialId)
    return record && record.userId === userId ? record : null
  }

  rename(userId: string, credentialId: string, label: string): StoredCredential | null {
    const record = this.findActiveForUser(userId, credentialId)
    if (!record) return null
    record.label = normalizeCredentialLabel(
      label,
      record.kind === "passkey" ? "Passkey" : DEFAULT_CREDENTIAL_LABEL,
    )
    return record
  }

  revoke(userId: string, credentialId: string): boolean {
    const record = this.findActiveForUser(userId, credentialId)
    if (!record) return false
    record.revokedAt = new Date().toISOString()
    return true
  }

  touch(credentialId: string, counter: number): void {
    const record = this.records.get(credentialId)
    if (!record || record.revokedAt !== null) return
    record.counter = counter
    record.lastUsedAt = new Date().toISOString()
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

let store: WebAuthnCredentialStore = new MemoryCredentialStore()

/** Single seam for the credential store (swap for durable storage in prod). */
export function getCredentialStore(): WebAuthnCredentialStore {
  return store
}

/** Test hook: replaces the store. */
export function setCredentialStoreForTests(next: WebAuthnCredentialStore | undefined): void {
  store = next ?? new MemoryCredentialStore()
}

export type { CredentialView }
