import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  API_KEY_SCOPES,
  JsonlApiKeyStore,
  createApiKey,
  generateApiKey,
  hashApiKey,
  hasScope,
  isKeyExpired,
  normalizeScopes,
  parseApiKey,
  recordHasScope,
  revokeApiKey,
  rotateApiKey,
  verifyApiKey,
  type ApiKeyStore,
} from "./index"

describe("generateApiKey", () => {
  it("produces sk_<env>_<secret> keys with a stable prefix", () => {
    const { key, prefix, environment } = generateApiKey("live")
    expect(environment).toBe("live")
    expect(key).toMatch(/^sk_live_[A-Za-z0-9_-]{40,}$/)
    expect(prefix).toBe(key.slice(0, 12))
    expect(prefix.startsWith("sk_live_")).toBe(true)
  })

  it("supports test environment", () => {
    expect(generateApiKey("test").key).toMatch(/^sk_test_/)
  })

  it("generates unique keys", () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateApiKey().key))
    expect(keys.size).toBe(50)
  })
})

describe("hashApiKey / parseApiKey", () => {
  it("hashes deterministically to 64-char hex", () => {
    const key = generateApiKey().key
    expect(hashApiKey(key)).toBe(hashApiKey(key))
    expect(hashApiKey(key)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashApiKey(key)).not.toContain(key.slice(-8))
  })

  it("parses valid keys and rejects malformed ones", () => {
    const { key } = generateApiKey("test")
    const parsed = parseApiKey(`  ${key}  `)
    expect(parsed?.environment).toBe("test")
    expect(parsed?.secret.length).toBeGreaterThan(20)
    expect(parsed?.prefix).toBe(key.slice(0, 12))

    for (const bad of [
      "",
      "sk_live_short",
      "pk_live_abc",
      "sk_staging_" + "a".repeat(40),
      "Bearer x",
    ]) {
      expect(parseApiKey(bad)).toBeNull()
    }
  })
})

describe("scopes", () => {
  it("orders read < write < admin", () => {
    expect(hasScope(["read"], "read")).toBe(true)
    expect(hasScope(["read"], "write")).toBe(false)
    expect(hasScope(["write"], "read")).toBe(true)
    expect(hasScope(["write"], "write")).toBe(true)
    expect(hasScope(["admin"], "write")).toBe(true)
    expect(hasScope(["admin"], "admin")).toBe(true)
    expect(hasScope([], "read")).toBe(false)
    expect(hasScope(["bogus"], "read")).toBe(false)
  })

  it("normalizeScopes drops unknown scopes and defaults to read", () => {
    expect(normalizeScopes(["write", "nope"])).toEqual(["write"])
    expect(normalizeScopes([])).toEqual(["read"])
    expect(normalizeScopes(API_KEY_SCOPES)).toEqual([...API_KEY_SCOPES])
  })
})

describe("isKeyExpired", () => {
  it("compares against now", () => {
    const now = new Date("2025-01-01T00:00:00Z")
    expect(isKeyExpired(new Date("2024-12-31T23:59:59Z"), now)).toBe(true)
    expect(isKeyExpired(new Date("2025-01-01T00:00:01Z"), now)).toBe(false)
    expect(isKeyExpired(null, now)).toBe(false)
    expect(isKeyExpired(undefined, now)).toBe(false)
  })
})

describe("JsonlApiKeyStore + lifecycle", () => {
  let dir: string
  let path: string
  let store: JsonlApiKeyStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "api-keys-"))
    path = join(dir, "keys.jsonl")
    store = new JsonlApiKeyStore(path)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("creates a key, stores only hash+prefix, and verifies it", async () => {
    const { record, key } = await createApiKey(store, { name: "ci", scopes: ["write"] })
    expect(record.scopes).toEqual(["write"])
    expect(record.keyHash).toMatch(/^[0-9a-f]{64}$/)
    expect(record.keyHash).not.toContain(key)
    expect(record.expiresAt).toBeNull()
    expect(record.revokedAt).toBeNull()

    const result = await verifyApiKey(store, key)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.record.id).toBe(record.id)
      expect(result.record.lastUsedAt).not.toBeNull()
      expect(recordHasScope(result.record, "read")).toBe(true)
      expect(recordHasScope(result.record, "admin")).toBe(false)
    }
  })

  it("rejects malformed, unknown, revoked, and expired keys", async () => {
    const { record, key } = await createApiKey(store, { name: "svc" })
    expect(await verifyApiKey(store, "not-a-key")).toEqual({ ok: false, reason: "malformed" })
    expect(await verifyApiKey(store, "sk_live_" + "A".repeat(43))).toEqual({
      ok: false,
      reason: "unknown",
    })

    await revokeApiKey(store, record.id)
    expect(await verifyApiKey(store, key)).toEqual({ ok: false, reason: "revoked" })

    const expired = await createApiKey(store, { name: "old", ttlMs: -1000 })
    expect(await verifyApiKey(store, expired.key)).toEqual({ ok: false, reason: "expired" })

    expect(await revokeApiKey(store, "missing-id")).toBeNull()
  })

  it("requires a name", async () => {
    await expect(createApiKey(store, { name: "  " })).rejects.toThrow(/name/i)
  })

  it("sets expiresAt from ttlMs", async () => {
    const now = new Date("2025-06-01T00:00:00Z")
    const { record } = await createApiKey(store, { name: "t", ttlMs: 60_000 }, now)
    expect(record.expiresAt?.toISOString()).toBe("2025-06-01T00:01:00.000Z")
  })

  it("persists across store instances (JSONL reload)", async () => {
    const { record, key } = await createApiKey(store, { name: "persist" })
    const reloaded = new JsonlApiKeyStore(path)
    expect(reloaded.get(record.id)?.name).toBe("persist")
    const result = await verifyApiKey(reloaded, key)
    expect(result.ok).toBe(true)
  })

  it("skips corrupt lines on load", async () => {
    writeFileSync(
      path,
      `${JSON.stringify({ version: 1, record: { id: "x" } })}\nnot-json\n`,
      "utf8",
    )
    const reloaded = new JsonlApiKeyStore(path)
    expect(reloaded.get("x")).not.toBeNull()
  })

  it("rotates: new key works with same scopes, old key revoked", async () => {
    const { record, key: oldKey } = await createApiKey(store, {
      name: "rotate-me",
      scopes: ["admin"],
      ttlMs: 60_000,
    })
    const rotated = await rotateApiKey(store, record.id)
    expect(rotated).not.toBeNull()
    if (!rotated) return
    expect(rotated.created.key).not.toBe(oldKey)
    expect(rotated.created.record.scopes).toEqual(["admin"])
    expect(rotated.revoked.revokedAt).not.toBeNull()

    expect((await verifyApiKey(store, oldKey)).ok).toBe(false)
    const fresh = await verifyApiKey(store, rotated.created.key)
    expect(fresh.ok).toBe(true)
    if (fresh.ok) expect(recordHasScope(fresh.record, "admin")).toBe(true)

    expect(await rotateApiKey(store, "nope")).toBeNull()
  })

  it("findByPrefix returns only matching records", async () => {
    const a = await createApiKey(store, { name: "a" })
    await createApiKey(store, { name: "b" })
    const found = await store.findByPrefix(a.record.prefix)
    expect(found).toHaveLength(1)
    expect(found[0]?.id).toBe(a.record.id)
  })

  it("works with a minimal in-memory ApiKeyStore", async () => {
    const memory = new Map<string, import("./index").ApiKeyRecord>()
    const memStore: ApiKeyStore = {
      create: (r) => void memory.set(r.id, r),
      get: (id) => memory.get(id) ?? null,
      findByPrefix: (p) => [...memory.values()].filter((r) => r.prefix === p),
      update: (r) => void memory.set(r.id, r),
    }
    const { key } = await createApiKey(memStore, { name: "mem" })
    expect((await verifyApiKey(memStore, key)).ok).toBe(true)
  })
})
