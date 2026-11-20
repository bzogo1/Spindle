# Database indexing strategy

Scope: indexes declared in [`prisma/schema.prisma`](../../prisma/schema.prisma)
and created by migrations under [`prisma/migrations/`](../../prisma/migrations).
This document records _why_ each index exists, which query patterns it serves,
and the write-amplification cost of keeping it.

## Guiding principles

- **Index what queries touch, not what looks indexable.** Every index below is
  tied to a concrete access pattern found in `src/` or in the documented auth
  roadmap (`prisma/AUTH-SCHEMA.md`). Speculative indexes are deferred until the
  query that needs them lands.
- **Let Prisma generate names.** Index names follow Prisma's
  `<table>_<columns>_idx` convention unless `map:` is set. The migration SQL
  uses `CREATE INDEX IF NOT EXISTS` so re-running is safe; `CONCURRENTLY` is
  deliberately **not** used because Prisma applies migrations inside a
  transaction.
- **Foreign keys get indexes.** Postgres does not auto-index the referencing
  side of a relation. Every `userId`-style FK added to the schema should ship
  with a matching `@@index` in the same migration that creates the table.

## Current schema (single `users` table)

| Index                  | Columns      | Kind                                           | Serves                                                                                                                                                |
| ---------------------- | ------------ | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users_pkey`           | `id`         | PK (init migration)                            | `findUnique`/`findFirst` by id; session→user lookups                                                                                                  |
| `users_email_key`      | `email`      | UNIQUE (init migration)                        | `upsert`/`findUnique` by email — sign-in, sign-up, seed (`prisma/seed.ts`), and the email→id lookup the auth layer performs on every credential check |
| `users_created_at_idx` | `created_at` | btree (`20261120050000_user_created_at_index`) | Chronological user listing / "recent signups" sorts; range filters on signup date for admin and referral/usage reporting                              |

### `users_created_at_idx` rationale

`created_at` is the only sortable/filterable column on `users` today
(`updated_at` changes on every write and is never a listing key; `name` is
free-text and not queried). App surfaces that list or rank users — admin
member lists, referral attribution, usage dashboards — order by signup time.
The index turns `ORDER BY created_at` (and `created_at >= ?` windows) into an
index scan instead of a sort over the full table.

**Cost:** one extra btree on a low-write table. Every `INSERT` and every
`UPDATE` that touches `created_at` (never — it is set once) pays one index
insert; `updated_at` changes do not touch this index. Storage is roughly
one entry per user. Acceptable.

### What was deliberately _not_ indexed

- `users.name` — no `where`/`orderBy` on name exists in `src/`; site search
  is client-side (`src/lib/search/`). Add a trigram/`ILIKE`-appropriate index
  only if server-side user search lands.
- `users.updated_at` — no query orders or ranges on it.

## Planned auth models (`prisma/AUTH-SCHEMA.md`)

The auth follow-up adds `auth_sessions`, `auth_one_time_tokens`, and
`user_backup_codes`. Their required indexes are already specified in that
document and must ship with the models:

- `auth_sessions.user_id` — FK index; session lookup/cleanup by user.
- `auth_one_time_tokens.token_hash` — UNIQUE; single-use token redemption.
- `auth_one_time_tokens (email, kind)` — magic-link/reset/verify lookups.
- `user_backup_codes.user_id` — FK index.
- `auth_oauth_identities (provider, provider_uid)` — UNIQUE if OAuth ships.

Note: session _expiry_ sweeps (`expires_at < now()`) and token _consumption_
checks will want `(expires_at)` / `(consumed_at)` access once cleanup jobs
exist; add those indexes with the job that runs them, not before.

## Migration conventions

- Hand-written migrations live in `prisma/migrations/<UTC-timestamp>_<slug>/migration.sql`
  and must sort after existing directories.
- Use plain `CREATE [UNIQUE] INDEX IF NOT EXISTS`; never `CONCURRENTLY`
  (Prisma wraps migrations in a transaction) and never drop-then-create on a
  live table without a maintenance window.
- Apply via `node scripts/db/migrate.mjs` (backup → `migrate deploy` →
  verification → drift check) — see `docs/runbooks/database-migrations.md`.
