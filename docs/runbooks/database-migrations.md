# Runbook — database migrations

This runbook covers the automated migration pipeline in
[`scripts/db/migrate.mjs`](../../scripts/db/migrate.mjs). It wraps the raw
Prisma commands (`npm run db:migrate`, `npm run db:deploy`) with a backup
hook, verification queries, and a drift check so a deploy is never a single
unverifiable step.

## Pipeline

`scripts/db/migrate.mjs` runs five stages, in order, and stops at the first
hard failure:

1. **Preflight** — checks the Prisma CLI is installed and that
   `DATABASE_URL` (or `DIRECT_URL`) is resolvable. Outside production and
   outside `--ci` mode, a missing `DATABASE_URL` falls back to the compose
   database (`postgresql://spindle:spindle@localhost:5432/spindle`), matching
   `src/lib/database-url.ts` / `prisma7.config.ts`. Missing URLs are warnings
   locally but fatal in `--ci` mode, which never uses the localhost fallback.
2. **Pre-migration backup** — runs `pg_dump` against `DIRECT_URL` (falling
   back to `DATABASE_URL`) into `backups/spindle-<timestamp>.dump`
   (`--format=custom`) or `.sql` (`--format=plain`). The script plants a
   `.gitignore` inside `backups/` on first use so dumps are never committed.
   If the dump fails, the pipeline aborts **before** `migrate deploy`.
   Skip explicitly with `--skip-backup` (e.g. ephemeral CI databases).
3. **`prisma migrate deploy`** — applies pending migrations from
   `prisma/migrations`. Schema and config resolution are unchanged; the
   script shells out to `node_modules/.bin/prisma`, which loads
   `prisma7.config.ts` exactly like `npm run db:deploy`.
4. **Post-migration verification** — connects with `pg` and asserts:
   - no rows in `_prisma_migrations` with `finished_at IS NULL` (failed or
     interrupted migrations),
   - every model table parsed from `prisma/schema.prisma` (`@@map` names)
     exists in `information_schema.tables`.
     Skip with `--no-verify`.
5. **Drift check** — runs `prisma migrate status` **and** compares
   `_prisma_migrations` against the directories in `prisma/migrations`.
   Drift in either direction (applied-but-not-on-disk, or on-disk-but-not-
   applied) is a failure. Run this on every deploy and in CI.

## Usage

```bash
# Local deploy against the compose database (backup included)
node scripts/db/migrate.mjs

# Inspect every command without touching a database
node scripts/db/migrate.mjs --dry-run

# CI / production deploy: machine-readable output, fail-fast
node scripts/db/migrate.mjs --ci

# Ephemeral database where a pg_dump is pointless
node scripts/db/migrate.mjs --skip-backup --no-verify --ci
```

### Options and environment

| Flag / env               | Default         | Purpose                                                |
| ------------------------ | --------------- | ------------------------------------------------------ |
| `--dry-run`              | off             | Print every command and query; execute nothing         |
| `--ci`                   | off             | `[migrate]`-prefixed output, strict preflight          |
| `--skip-backup`          | off             | Skip the pg_dump stage                                 |
| `--no-verify`            | off             | Skip verification queries                              |
| `--backup-dir <dir>`     | `backups/`      | Dump destination (`--backup-dir=<dir>` also works)     |
| `--format custom\|plain` | `custom`        | pg_dump format (`--format=<custom\|plain>` also works) |
| `DATABASE_URL`           | from env/dotenv | Runtime connection string                              |
| `DIRECT_URL`             | `DATABASE_URL`  | Direct (non-pooled) URL for pg_dump/migrate            |
| `MIGRATE_PG_DUMP`        | `pg_dump`       | Path to the pg_dump binary                             |
| `MIGRATE_BACKUP_DIR`     | `backups/`      | Same as `--backup-dir`                                 |
| `MIGRATE_BACKUP_FORMAT`  | `custom`        | Same as `--format`                                     |

Exit codes: `0` success, `1` any stage failure. In CI mode the last line is
`[migrate] finished successfully in <n>s` or `[migrate] finished with <n>
failure(s)`.

## When to use what

- **Local development** — keep using `npm run db:migrate`
  (`prisma migrate dev`) to author and test migrations interactively. The
  pipeline script is for applying already-committed migrations.
- **Staging / production deploys** — run `node scripts/db/migrate.mjs --ci`
  from the release job. It produces a restorable dump before touching the
  schema and fails loudly on drift.
- **PR / CI smoke checks** — `node scripts/db/migrate.mjs --dry-run` needs
  no database and verifies the script, Prisma CLI, and schema parsing are
  wired correctly.

## Backup notes

- Dumps land in `backups/` at the repo root (override with `--backup-dir`).
  A generated `.gitignore` keeps them out of commits; verify with
  `git status` after a run.
- `pg_dump` must match the server's major version. In containers, install
  the Postgres client tools or set `MIGRATE_PG_DUMP` to the correct binary.
- The dump contains full data. Treat `backups/` like a secret: it is never
  uploaded by CI artifacts unless you explicitly configure that.
- To roll back, restore with
  `pg_restore --clean --if-exists --dbname "$DIRECT_URL" backups/<file>.dump`
  (custom format) or `psql "$DIRECT_URL" -f backups/<file>.sql` (plain).

## Failure playbook

| Symptom                                          | Meaning / action                                                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `backup failed — aborting before migrate deploy` | Fix `pg_dump` (missing binary, version mismatch, bad `DIRECT_URL`); nothing was migrated                                  |
| `prisma migrate deploy exited N`                 | Read the Prisma output above; common causes: failed migration SQL, lock timeout, missing `_prisma_migrations` permissions |
| `migration(s) never finished`                    | A previous deploy was interrupted. Inspect `_prisma_migrations`, resolve manually per Prisma docs, then re-run            |
| `expected tables missing`                        | Migration applied but schema incomplete — likely a partially failed deploy; restore backup and investigate                |
| `drift:`                                         | Database and `prisma/migrations` disagree. Never hand-edit `_prisma_migrations`; reconcile via a new migration or restore |
