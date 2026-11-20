# API Key Security

Design and operational guidance for the API key system implemented in
`src/lib/api-keys/`. Usage/lifecycle docs: [docs/api/key-management.md](../api/key-management.md).

## Threat model

API keys authenticate machine callers (CI, scripts, integrations). The risks:

- **Key leakage** — keys end up in logs, tickets, shell history, or committed
  files. Mitigate with prefix-only display, never logging the secret portion,
  and the leak-guard sanitiser in `src/lib/secrets/leak-guard.ts`.
- **Database breach** — if the key store is exfiltrated, plaintext keys must
  not be recoverable.
- **Offline brute force** — irrelevant in practice: keys carry ~256 bits of
  CSPRNG entropy, so a fast hash is safe _and_ desirable for per-request
  verification latency.

## Storage: hash, never plaintext

Only two derived values are persisted per key:

| Field     | Content                             | Purpose                            |
| --------- | ----------------------------------- | ---------------------------------- |
| `prefix`  | first 12 chars, e.g. `sk_live_ab3X` | lookup index + safe display        |
| `keyHash` | SHA-256 hex of the full key         | verification via `timingSafeEqual` |

**Why SHA-256 and not argon2/bcrypt:** those KDFs exist to slow down guessing
of _low-entropy_ secrets (passwords). An API key has ~256 bits of entropy —
there is nothing to brute-force — so a memory-hard KDF would only add latency
to every authenticated request for zero security gain. SHA-256 gives a
deterministic, fast digest; `timingSafeEqual` in `verifyApiKey` prevents
timing oracles on hash comparison. (The codebase already uses scrypt for
passwords in `src/lib/auth/password.ts` — the right tool for the wrong job
here.)

## Scopes

`read` < `write` < `admin` — hierarchical. `admin` implies all; `write`
implies `read`. Scopes are coarse on purpose: fine-grained per-endpoint
permissions belong in the route handlers that call `recordHasScope`.

## Lifecycle policy

- **Expiry**: prefer `ttlMs` for automation keys; non-expiring keys
  (`expiresAt: null`) should be reserved for long-lived integrations and
  reviewed periodically.
- **Rotation**: rotate on suspected exposure, on personnel change, and on a
  schedule (e.g. 90 days for CI keys). `rotateApiKey` preserves name, scopes,
  owner, and remaining TTL.
- **Revocation**: `revokedAt` is permanent — verification returns `"revoked"`.
  There is no un-revoke; issue a new key.
- **Test vs live**: `sk_test_` keys should be rejected by production-only
  endpoints. Check `record.environment` after verification.

## Verification notes

- Malformed keys are rejected before any store lookup (cheap path).
- Prefix lookup narrows candidates; hash comparison is constant-time.
- `lastUsedAt` is stamped on success — use it to find stale keys for cleanup.
- Never log the presented key or `keyHash`; log `record.id`/`prefix` only.
  The shared sanitiser (`src/lib/logger.ts`, `leak-guard.ts`) already redacts
  `Bearer …` and `*API_KEY*` patterns.

## Storage backends

`ApiKeyStore` is deliberately Prisma-free. `JsonlApiKeyStore` writes
`.spindle/api-keys.jsonl` (gitignore-worthy; treat as secret material —
hashes only, but still sensitive metadata). For production, implement
`ApiKeyStore` over Prisma/Postgres with an index on `prefix`; the file store
rewrites the whole file per mutation and is not suitable beyond demo scale.
