# API Key Management

How API keys are generated, scoped, verified, rotated, and revoked in Spindle.
Implementation lives in `src/lib/api-keys/` (`key.ts` primitives, `store.ts`
lifecycle + storage). Security rationale is in
[docs/security/api-keys.md](../security/api-keys.md).

## Key format

```
sk_<environment>_<secret>
```

- `environment`: `live` or `test` — test keys are for staging/dev and should be
  rejected by production endpoints that care.
- `secret`: 32 random bytes, unpadded base64url (~43 chars, ~256 bits entropy).
- The first 12 characters (`sk_live_ab3X…`) are stored as the **prefix** for
  lookup and display. The full key is ~52 chars.

The plaintext key is shown **once** at creation and is never recoverable.

## Lifecycle

### Create

```ts
import { JsonlApiKeyStore, createApiKey } from "@/lib/api-keys"

const store = new JsonlApiKeyStore() // or inject a Prisma-backed ApiKeyStore
const { record, key } = await createApiKey(store, {
  name: "ci-deploy",
  ownerId: "user_123",
  environment: "live",
  scopes: ["read", "write"],
  ttlMs: 90 * 24 * 60 * 60 * 1000, // optional expiry
})
// Hand `key` to the caller once. `record` has id, prefix, scopes, expiry —
// never the plaintext.
```

### Verify (per request)

```ts
const result = await verifyApiKey(
  store,
  req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "",
)
if (!result.ok) {
  // reason: "malformed" | "unknown" | "revoked" | "expired"
  return new Response("Unauthorized", { status: 401 })
}
const { record } = result
if (!recordHasScope(record, "write")) return new Response("Forbidden", { status: 403 })
```

Verification is: parse → find candidates by prefix → SHA-256 the presented key
→ `timingSafeEqual` against stored hashes → reject revoked/expired → stamp
`lastUsedAt`. Unknown keys cost one prefix lookup + hash; malformed keys cost
nothing.

### Rotate

```ts
const rotated = await rotateApiKey(store, record.id)
// rotated.created.key — new plaintext, same name/scopes/owner, remaining TTL preserved
// old key is revoked immediately (returns 401 "revoked" on next use)
```

Preferred flow: create the replacement, deploy it, then revoke the old key —
or use `rotateApiKey` for a single-call swap when a brief overlap isn't needed.
For zero-downtime rotation, call `createApiKey` twice and revoke the old key
after the new one is deployed.

### Revoke

```ts
await revokeApiKey(store, record.id) // idempotent-safe; sets revokedAt
```

Revoked keys fail verification with reason `"revoked"`. There is no un-revoke;
create a new key instead.

## Scopes

Coarse-grained, ordered: `read` < `write` < `admin`. A key with `admin`
satisfies every scope check; `write` satisfies `read`. Unknown scopes in a
stored record are ignored. `normalizeScopes` drops unknown values at creation
and defaults to `["read"]` when nothing valid is given.

Scope checks are done by the caller via `recordHasScope(record, required)` —
the module does not enforce endpoint-level authorization itself.

## Storage

`ApiKeyStore` is a Prisma-free interface (`create`/`get`/`findByPrefix`/
`update`). The reference `JsonlApiKeyStore` persists to
`.spindle/api-keys.jsonl` (one JSON object per line, `{version, record}`) —
load-once + write-through, adequate for demos, scripts, and single-node use.
A Prisma `ApiKey` model implementing the same interface is a drop-in
replacement; only the SHA-256 hash and prefix are ever stored.

See [docs/security/api-keys.md](../security/api-keys.md) for the hashing
rationale and operational guidance.
