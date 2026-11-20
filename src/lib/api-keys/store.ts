import { randomUUID, timingSafeEqual } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

import {
  generateApiKey,
  hashApiKey,
  hasScope,
  isKeyExpired,
  normalizeScopes,
  parseApiKey,
  type ApiKeyEnvironment,
  type ApiKeyScope,
  type GeneratedApiKey,
} from "./key"

/**
 * API key storage + lifecycle service.
 *
 * Prisma-free by design: `ApiKeyStore` is the persistence seam. The reference
 * implementation `JsonlApiKeyStore` keeps one JSON object per line at a file
 * path — adequate for demos, scripts, and single-node deployments. A Prisma
 * adapter implementing the same interface is a drop-in replacement.
 *
 * Only the SHA-256 hash and a 12-char display prefix are ever persisted —
 * see docs/security/api-keys.md for the rationale.
 */

export type ApiKeyRecord = {
  id: string
  /** Short display prefix, e.g. `sk_live_Ab3xY9`. Safe to show in UIs/logs. */
  prefix: string
  name: string
  ownerId?: string
  environment: ApiKeyEnvironment
  scopes: ApiKeyScope[]
  /** SHA-256 hex of the full key. The plaintext is never stored. */
  keyHash: string
  createdAt: Date
  expiresAt: Date | null
  lastUsedAt: Date | null
  revokedAt: Date | null
}

export type CreateApiKeyInput = {
  name: string
  ownerId?: string
  environment?: ApiKeyEnvironment
  scopes?: readonly string[]
  /** TTL in milliseconds; omit for a non-expiring key. */
  ttlMs?: number
}

export type CreateApiKeyResult = {
  record: ApiKeyRecord
  /** Plaintext key — return to the caller once; it cannot be recovered later. */
  key: string
}

export type VerifyApiKeyResult =
  | { ok: true; record: ApiKeyRecord }
  | { ok: false; reason: "malformed" | "unknown" | "revoked" | "expired" }

export type ApiKeyStore = {
  create(record: ApiKeyRecord): Promise<void> | void
  get(id: string): Promise<ApiKeyRecord | null> | ApiKeyRecord | null
  findByPrefix(prefix: string): Promise<ApiKeyRecord[]> | ApiKeyRecord[]
  update(record: ApiKeyRecord): Promise<void> | void
}

const STORE_FILE_VERSION = 1

/**
 * JSONL-backed store for demos and scripts. Loads the file once at
 * construction, keeps records in memory, and rewrites the file on every
 * mutation (fine at demo scale). Path defaults to
 * `<cwd>/.spindle/api-keys.jsonl`, matching the secret-audit log convention.
 */
export class JsonlApiKeyStore implements ApiKeyStore {
  private readonly path: string
  private records = new Map<string, ApiKeyRecord>()
  private loaded = false

  constructor(path?: string) {
    this.path = resolve(path ?? `${process.cwd()}/.spindle/api-keys.jsonl`)
  }

  private load(): void {
    if (this.loaded) return
    this.loaded = true
    let raw: string
    try {
      raw = readFileSync(this.path, "utf8")
    } catch {
      return // missing file = empty store
    }
    for (const line of raw.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const parsed = JSON.parse(trimmed) as { version?: number; record?: ApiKeyRecord }
        if (parsed.version !== STORE_FILE_VERSION || !parsed.record?.id) continue
        this.records.set(parsed.record.id, reviveRecord(parsed.record))
      } catch {
        // Skip corrupt lines rather than failing the whole store.
      }
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const body = [...this.records.values()]
      .map((record) => JSON.stringify({ version: STORE_FILE_VERSION, record }))
      .join("\n")
    writeFileSync(this.path, body ? `${body}\n` : "", "utf8")
  }

  create(record: ApiKeyRecord): void {
    this.load()
    this.records.set(record.id, record)
    this.persist()
  }

  get(id: string): ApiKeyRecord | null {
    this.load()
    return this.records.get(id) ?? null
  }

  findByPrefix(prefix: string): ApiKeyRecord[] {
    this.load()
    return [...this.records.values()].filter((record) => record.prefix === prefix)
  }

  update(record: ApiKeyRecord): void {
    this.load()
    this.records.set(record.id, record)
    this.persist()
  }
}

function reviveRecord(record: ApiKeyRecord): ApiKeyRecord {
  return {
    ...record,
    createdAt: new Date(record.createdAt),
    expiresAt: record.expiresAt ? new Date(record.expiresAt) : null,
    lastUsedAt: record.lastUsedAt ? new Date(record.lastUsedAt) : null,
    revokedAt: record.revokedAt ? new Date(record.revokedAt) : null,
  }
}

/** Timing-safe hex comparison that tolerates different lengths. */
function hashEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8")
  const bufB = Buffer.from(b, "utf8")
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
}

/** Create a key: generates the secret, stores only its hash, returns plaintext once. */
export async function createApiKey(
  store: ApiKeyStore,
  input: CreateApiKeyInput,
  now: Date = new Date(),
): Promise<CreateApiKeyResult> {
  if (!input.name?.trim()) throw new Error("API key name is required")
  const generated: GeneratedApiKey = generateApiKey(input.environment ?? "live")
  const record: ApiKeyRecord = {
    id: randomUUID(),
    prefix: generated.prefix,
    name: input.name.trim(),
    ownerId: input.ownerId,
    environment: generated.environment,
    scopes: normalizeScopes(input.scopes ?? ["read"]),
    keyHash: hashApiKey(generated.key),
    createdAt: now,
    expiresAt: input.ttlMs ? new Date(now.getTime() + input.ttlMs) : null,
    lastUsedAt: null,
    revokedAt: null,
  }
  await store.create(record)
  return { record, key: generated.key }
}

/** Verify a presented plaintext key against the store. Updates lastUsedAt on success. */
export async function verifyApiKey(
  store: ApiKeyStore,
  presentedKey: string,
  now: Date = new Date(),
): Promise<VerifyApiKeyResult> {
  const parsed = parseApiKey(presentedKey)
  if (!parsed) return { ok: false, reason: "malformed" }

  const candidates = await store.findByPrefix(parsed.prefix)
  const presentedHash = hashApiKey(presentedKey.trim())
  const match = candidates.find((record) => hashEquals(record.keyHash, presentedHash))
  if (!match) return { ok: false, reason: "unknown" }
  if (match.revokedAt) return { ok: false, reason: "revoked" }
  if (isKeyExpired(match.expiresAt, now)) return { ok: false, reason: "expired" }

  const updated: ApiKeyRecord = { ...match, lastUsedAt: now }
  await store.update(updated)
  return { ok: true, record: updated }
}

/** Revoke a key by id. Returns the updated record, or null if not found. */
export async function revokeApiKey(
  store: ApiKeyStore,
  id: string,
  now: Date = new Date(),
): Promise<ApiKeyRecord | null> {
  const record = await store.get(id)
  if (!record) return null
  const updated: ApiKeyRecord = { ...record, revokedAt: now }
  await store.update(updated)
  return updated
}

/** Rotate = create a replacement key with the same metadata, then revoke the old one. */
export async function rotateApiKey(
  store: ApiKeyStore,
  id: string,
  now: Date = new Date(),
): Promise<{ created: CreateApiKeyResult; revoked: ApiKeyRecord } | null> {
  const old = await store.get(id)
  if (!old) return null
  const created = await createApiKey(
    store,
    {
      name: old.name,
      ownerId: old.ownerId,
      environment: old.environment,
      scopes: old.scopes,
      // Carry over remaining TTL so rotation doesn't silently extend expiry.
      ttlMs: old.expiresAt ? old.expiresAt.getTime() - now.getTime() : undefined,
    },
    now,
  )
  const revoked = await revokeApiKey(store, id, now)
  return { created, revoked: revoked ?? old }
}

/** True when `record` grants `required` scope. */
export function recordHasScope(record: ApiKeyRecord, required: ApiKeyScope): boolean {
  return hasScope(record.scopes, required)
}
