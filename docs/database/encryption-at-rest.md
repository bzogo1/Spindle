# Database encryption at rest

This document covers what encryption-at-rest means for Spindle's Postgres
database, what the application can and cannot control, and how to verify the
current posture.

**Verification:** `node scripts/db/encryption/verify-encryption.mjs`
(add `--dry-run` to inspect configuration and the schema without touching a
database, `--strict` to fail on warnings).

## Threat model

"Encryption at rest" protects data in three distinct places, and they need
different controls:

| Layer                   | What protects it today                            | Owner                    |
| ----------------------- | ------------------------------------------------- | ------------------------ |
| Postgres data directory | Host/volume disk encryption (see below)           | Infrastructure           |
| Sensitive column values | Application-level or `pgcrypto` column encryption | Application + migrations |
| Backup artifacts        | Backup encryption + storage encryption            | `scripts/db/backup`      |

Postgres itself (community edition, which this project runs —
`postgres:17-alpine` in `compose.yaml` and `infra/origin/compose.yaml`) has
**no native transparent data encryption (TDE)**. There is no
`ssl`/`encrypt` server setting that encrypts heap files; every "TDE" claim
for self-managed Postgres is really disk/volume encryption underneath it.

## What the application can and cannot control

**Cannot control:**

- Whether the underlying disk, volume, or cloud block storage is encrypted.
  Postgres writes plaintext pages to the data directory; if the filesystem is
  compromised, every row is readable regardless of `sslmode` or column
  encryption choices made in SQL.
- Managed-database provider internals (not applicable today — production is a
  self-managed Hetzner box per `infra/origin/compose.yaml`, but the same rule
  holds if we ever move to RDS/Cloud SQL/Neon).
- Key custody for column-level encryption. Whoever holds the passphrase holds
  the data.

**Can control:**

- `sslmode` / TLS parameters on `DATABASE_URL` and `DIRECT_URL` (encrypts data
  **in transit**, not at rest — but equally important; see below).
- Column-level encryption for genuinely sensitive fields via `pgcrypto` or
  application-level envelope encryption.
- Backup encryption via the backup pipeline (`--encrypt openssl|gpg`, see
  [Backup encryption](#backup-encryption)).
- Verification posture via `scripts/db/encryption/verify-encryption.mjs`.

## Postgres-level options

### 1. Disk / volume encryption (the primary "at rest" control)

Because Postgres has no TDE, disk encryption is the real at-rest defence:

- **Self-managed host (current production):** enable LUKS full-disk
  encryption on the Hetzner box before provisioning, or encrypt the
  `postgres-data` Docker volume's backing filesystem. `infra/host/bootstrap.sh`
  is the place to codify this; until it is, treat the volume as plaintext at
  rest and rely on host access controls plus backup encryption.
- **Cloud-managed Postgres (if adopted):** use the provider's encrypted
  volumes/snapshots (AWS RDS storage encryption, Cloud SQL encryption,
  Neon/… all encrypt by default). Verify the setting in the provider console —
  it is a platform control, not something `pg` can check.
- **Local dev (`compose.yaml`):** the named volume `spindle-postgres` is
  plaintext. Acceptable for development; do not copy production dumps into
  it without considering sensitivity.

Disk encryption is transparent to Postgres — no schema or code changes, and
`pgcrypto` is unnecessary for this layer.

### 2. Column-level encryption with `pgcrypto`

For fields where a database dump (or a rogue `SELECT *`) must not reveal
plaintext, encrypt individual columns:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "users"
  ADD COLUMN "email_enc" bytea;

-- Write path (parameterized via Prisma $executeRaw or a wrapper):
--   UPDATE users SET email_enc = pgp_sym_encrypt($1, $2) WHERE id = $3
-- Read path:
--   SELECT pgp_sym_decrypt(email_enc, $1) AS email FROM users WHERE id = $2
```

**Caveats — read before adopting:**

- **No equality search.** `pgp_sym_encrypt` is non-deterministic; you cannot
  `WHERE email_enc = ...` or keep a unique index on the ciphertext. Login
  lookups, `@@unique` constraints, and `findUnique` break. Deterministic
  encryption (`pgp_sym_encrypt` cannot do this; you'd need a separate HMAC
  blind-index column) reintroduces a dictionary-attack surface.
- **Key management is on us.** The passphrase must live in the secret store
  (Infisical — same place as `DATABASE_URL`), be rotatable, and never appear
  in migrations, code, or logs. See `docs/runbooks/secrets-rotation.md`.
- **Not for password hashes.** bcrypt/argon2 output is already one-way;
  encrypting it with pgcrypto adds a key-management burden for zero security
  gain. The schema scanner in the verify script explicitly excludes `*hash*`
  fields.
- **Prefer app-level envelope encryption** for new high-risk fields when
  feasible (encrypt in the service layer, store `bytea`, keep keys in KMS /
  Infisical). It keeps crypto out of SQL and works the same on any Postgres.

### 3. What Prisma does (and doesn't) do

- Prisma has **no at-rest encryption feature**. `prisma-client` +
  `@prisma/adapter-pg` pass the connection string straight to `pg`; data
  pages are whatever Postgres writes.
- For column-level crypto you must bypass Prisma's typed API for those columns
  (`$queryRaw`/`$executeRaw`) or maintain a parallel encrypted column the
  client never reads directly.
- Prisma Migrate **can** run `CREATE EXTENSION pgcrypto` inside a migration,
  but the extension only provides functions — the encrypt/decrypt calls still
  have to come from application code.

## TLS in transit (`sslmode`)

`sslmode` controls encryption **between the app and Postgres**, not at rest,
but a plaintext connection on a shared network is a far more common finding
than unencrypted disks. Semantics for `pg` (used by `@prisma/adapter-pg` via
`src/lib/db.ts`):

| `sslmode`     | Behaviour                        | Recommendation         |
| ------------- | -------------------------------- | ---------------------- |
| `disable`     | Plaintext always                 | Never for remote hosts |
| `allow`       | TLS only if server asks          | Never                  |
| `prefer`      | TLS if available, else plaintext | Never for remote hosts |
| `require`     | TLS required, cert not verified  | Minimum for remote     |
| `verify-ca`   | TLS + CA verification            | Good                   |
| `verify-full` | TLS + CA + hostname verification | **Target for remote**  |

Current enforcement, in `src/lib/db/pool.ts` (`resolveSslConfig`):

- If `DATABASE_URL` already contains `sslmode`/`ssl`/`sslcert`/`sslkey`/
  `sslrootcert`/`sslcrl`, `pg` parses them and the pool does not override.
- Otherwise `DATABASE_SSL` decides: `disable` → plaintext, `require` → TLS
  without cert verification, `verify`/`verify-full` → verified TLS.
- With neither set: **production + non-local host gets verified TLS**;
  development/test get plaintext (matching the compose Postgres, which has
  no TLS listener).

Operational guidance:

- **Local/compose:** no `sslmode` needed — the database is loopback-only and
  plaintext inside the compose network is acceptable (same trust boundary as
  the Docker socket proxy pattern).
- **Self-managed production (`infra/origin`):** app→postgres traffic never
  leaves the `spindle` bridge network, so TLS adds little; if Postgres is ever
  exposed beyond the compose network, terminate TLS (stunnel/pgbouncer or
  `ssl=on` in `postgresql.conf` with certs) and set
  `sslmode=verify-full&sslrootcert=...` in Infisical's `DATABASE_URL`.
- **Managed Postgres:** always `sslmode=verify-full` with the provider's CA
  bundle as `sslrootcert`. `sslmode=require` alone is vulnerable to
  man-in-the-middle.
- `DIRECT_URL` (used by `prisma migrate`, `pg_dump`, restore-test) needs the
  same treatment — it is a second connection string, not covered by the
  runtime pool logic.

## Backup encryption

`pg_dump` output — custom format included — is **not encrypted**. Anyone with
the dump file and the database password hash material can read every row.
Backups therefore need their own encryption layer; disk encryption on the
backup target does not cover dumps copied off-box.

The backup library (`scripts/db/backup/lib.ts`) already supports this:

| Env var                        | Purpose                                                    |
| ------------------------------ | ---------------------------------------------------------- |
| `BACKUP_ENCRYPT`               | `none` (default), `openssl`, or `gpg`                      |
| `BACKUP_ENCRYPTION_PASSPHRASE` | Passphrase for openssl/gpg symmetric encryption            |
| `BACKUP_ENCRYPTION_KEY_FILE`   | File containing the passphrase (preferred over inline env) |

Recommended production posture:

1. Set `BACKUP_ENCRYPT=openssl` (or `gpg` if GPG is already the org standard)
   and store the passphrase in Infisical under the backup/deploy secret path —
   **not** in `.env` files committed anywhere.
2. Encrypt **before** the artifact leaves the host: the encrypt step wraps
   `pg_dump` output in the backup script, so the file on disk and in any
   off-box sync (B2, rsync) is ciphertext.
3. Verify restores still work: `scripts/db/restore-test/restore-test.mjs`
   must be able to decrypt — check whether it accepts `--encrypt` artifacts
   or whether decryption is a manual pre-step; if the latter, document the
   decrypt command in the restore runbook.
4. Treat backup encryption keys with the same rotation policy as
   `DATABASE_URL` (`docs/runbooks/secrets-rotation.md`, 90-day Postgres
   credential rotation; key material should rotate on the same cadence or on
   suspected exposure).

Note the distinction: `BACKUP_ENCRYPT` protects the **dump file**. It does not
protect the live database, and it does not replace column-level encryption
for fields that must stay confidential even inside a legitimate restore.

## Recommended pgcrypto usage pattern

The current schema (`prisma/schema.prisma`) has one model, `User`, whose only
sensitive-looking field is `email` (PII, not a secret). As auth work lands
(DEV-18/DEV-20 per the schema comment), expect `passwordHash`,
`refreshToken`/`sessionToken`, `emailVerificationToken`, etc.

Recommended pattern for **secret-bearing** columns (tokens, API keys,
recovery codes):

1. Migration adds `bytea` columns alongside (or replacing) plaintext ones:

   ```sql
   CREATE EXTENSION IF NOT EXISTS pgcrypto;
   ALTER TABLE "users" ADD COLUMN "refresh_token_enc" bytea;
   ```

2. Application code encrypts on write / decrypts on read via
   `pgp_sym_encrypt`/`pgp_sym_decrypt` with the passphrase from Infisical —
   never hardcoded, never logged. Prisma `$queryRaw`/`$executeRaw` or a thin
   repository wrapper owns these queries; generated types stay clean.
3. Keep an HMAC blind-index column (`hmac(email, key)`) **only** if equality
   lookup is required; document the trade-off (deterministic → dictionary
   attackable).
4. `email` itself is a judgement call: encrypt it if compliance requires it,
   but expect login-by-email flows to need the blind-index pattern. Many
   apps keep email plaintext and rely on disk encryption + column encryption
   only for credentials/tokens.

## Verification checklist

Run before each release and after any infra/secrets change:

- [ ] `node scripts/db/encryption/verify-encryption.mjs` passes with no
      failures (`--strict` in CI if warnings should block).
- [ ] `DATABASE_URL` and `DIRECT_URL` both carry an explicit `sslmode`
      (`verify-full` recommended) or `ssl*` params for remote hosts.
- [ ] Production host disk/volume encryption confirmed (LUKS on the Hetzner
      box, or provider storage encryption if managed Postgres is adopted).
- [ ] `BACKUP_ENCRYPT` set to `openssl`/`gpg` in production with the
      passphrase in Infisical; a recent encrypted backup exists.
- [ ] Restore drill decrypts and restores the latest encrypted backup
      (`docs/runbooks/database-restore-test.md`).
- [ ] Any new sensitive schema field is either covered by disk encryption +
      access controls, or has a documented column-level encryption decision
      (pgcrypto vs app-level vs plaintext-with-justification).
- [ ] `pgcrypto` installed via migration **only** when column-level crypto is
      actually used — an unused extension is attack surface, not protection.
