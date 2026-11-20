# Runbook — database restore testing

`restore-test` proves that backups actually restore. It takes a backup file
(produced by `scripts/db/backup` or any `pg_dump` output), restores it into a
throwaway **scratch database** on the same Postgres server, runs verification
queries against the restored data, then drops the scratch database. The real
database is never touched.

Script: `scripts/db/restore-test/restore-test.mjs`

## When to run it

- **After every backup-format or pipeline change** — if the backup script or
  `pg_dump` flags change, re-run a restore test before trusting the new output.
- **After a restore rehearsal** — quarterly at minimum, and before any
  disaster-recovery drill or migration that relies on backups.
- **In CI on a schedule** — see "CI integration" below. A weekly cron against
  staging is the cheapest meaningful cadence; monthly is acceptable for a small
  dataset.
- **After a backup failure alert** — always confirm the newest artifact restores
  before assuming the backup chain is intact.

A restore test that has never been run against a real artifact is not evidence
that backups work. Run it.

## Prerequisites

- Postgres client binaries on `PATH`: `pg_restore` and `psql` (same major
  version as the server, ideally). Override with `RESTORE_TEST_PG_RESTORE` /
  `RESTORE_TEST_PSQL` if they live elsewhere.
- `DATABASE_URL` / `DIRECT_URL` set (env or `.env`/`.env.local`) pointing at the
  **same server** the scratch database will be created on. The database name in
  the URL is irrelevant — the script swaps it for the scratch name.
- A role that can `CREATE DATABASE` / `DROP DATABASE`. Locally this is the
  `spindle` superuser from `compose.yaml`.
- Node dependencies installed (`npm install`) — the script uses the `pg` package
  and the repo's Prisma CLI.

## Usage

```bash
# Dry run — prints the full plan, touches nothing, needs no database or backup:
node scripts/db/restore-test/restore-test.mjs --dry-run

# Restore the newest backup found in backups/ (or --backup-dir):
node scripts/db/restore-test/restore-test.mjs

# Explicit file:
node scripts/db/restore-test/restore-test.mjs --file backups/spindle-2026-11-20.dump

# Keep the scratch database for inspection after a successful run:
node scripts/db/restore-test/restore-test.mjs --keep
```

Options:

| Flag                  | Default                                    | Purpose                                                             |
| --------------------- | ------------------------------------------ | ------------------------------------------------------------------- |
| `--file <path>`       | newest in backup dir                       | Explicit backup file                                                |
| `--backup-dir <dir>`  | `backups/` (env `RESTORE_TEST_BACKUP_DIR`) | Where to scan for `*.dump`/`*.backup`/`*.pgdump`/`*.sql`/`*.sql.gz` |
| `--scratch-db <name>` | `spindle_restore_test_<timestamp>`         | Scratch database name                                               |
| `--admin-db <name>`   | `postgres` (env `RESTORE_TEST_ADMIN_DB`)   | DB used for `CREATE`/`DROP DATABASE`; falls back to the source DB   |
| `--format <fmt>`      | auto from extension                        | `custom` (pg_restore) or `plain` (psql)                             |
| `--keep`              | off                                        | Don't drop the scratch DB afterwards                                |
| `--no-verify`         | off                                        | Skip verification queries                                           |
| `--dry-run`           | off                                        | Print the plan without executing anything                           |

## What the script does

1. **Preflight** — validates the scratch DB name, checks the Prisma CLI and
   `DATABASE_URL`/`DIRECT_URL`.
2. **Select backup** — picks `--file`, or the most recently modified matching
   file in `--backup-dir`. Format is detected from the extension:
   `.dump`/`.backup`/`.pgdump` → `pg_restore` (custom format),
   `.sql` → `psql`, `.sql.gz` → `gzip -dc | psql` (plain format).
3. **Create scratch DB** — `CREATE DATABASE <scratch>` via a `pg` connection to
   the admin database (default `postgres`), falling back to the source database
   if the admin DB is unreachable.
4. **Restore** —
   - custom: `pg_restore --no-owner --no-privileges --dbname <scratch-url> <file>`
   - plain: `psql -v ON_ERROR_STOP=1 -f <file> <scratch-url>`
   - plain gzipped: `gzip -dc <file> | psql <scratch-url>`
5. **Verify** —
   - every model table parsed from `prisma/schema.prisma` exists in `public`;
   - `SELECT COUNT(*)` on each expected table (row counts are printed);
   - if `_prisma_migrations` exists, applied/finished migrations are checked
     against `prisma/migrations` (drift is a warning — the backup may be older
     than the current schema);
   - `prisma migrate status` is run with `DATABASE_URL`/`DIRECT_URL` pointed at
     the scratch database.
6. **Teardown** — `DROP DATABASE IF EXISTS <scratch> WITH (FORCE)`, unless
   `--keep` was passed. Teardown runs even when verification fails.

## Pass criteria

The run exits 0 only if **all** of the following hold:

- `pg_restore`/`psql` exits 0 (or the restore step is otherwise clean);
- every table expected from `prisma/schema.prisma` is present in the restored
  `public` schema;
- every expected-table row count query succeeds;
- no `_prisma_migrations` row is stuck with `finished_at IS NULL`.

Warnings (not failures): missing `_prisma_migrations`, migrations in the backup
that no longer exist locally, `prisma migrate status` non-zero exit.

A non-zero exit means the backup is **not restorable as-is** — treat it as a
backup-pipeline bug, not a test bug. Capture the output and fix the backup step
before the next scheduled backup.

## Common failures

| Symptom                                          | Likely cause                                                                                                                            |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `could not connect to admin database "postgres"` | Managed Postgres without a `postgres` db — the script falls back to the source DB; if that also fails, the role lacks `CREATE DATABASE` |
| `pg_restore`/`psql: command not found`           | Client binaries not installed; install `postgresql-client` matching the server major version                                            |
| `CREATE DATABASE ... failed: permission denied`  | Role needs `CREATEDB`; use a superuser or grant it                                                                                      |
| expected tables missing after restore            | Backup was taken mid-migration or from the wrong database — re-run `scripts/db/backup` and retest                                       |
| `_prisma_migrations table not found` (warning)   | Backup predates Prisma migrations or is a partial dump — investigate before relying on it                                               |

## CI integration sketch

Run on a schedule (e.g. weekly) against a seeded staging database. Do **not**
run it against production data in CI unless the scratch database lives on a
dedicated CI Postgres service.

```yaml
# .github/workflows/restore-test.yml (sketch)
name: restore-test
on:
  schedule:
    - cron: "0 4 * * 1" # Mondays 04:00 UTC
  workflow_dispatch:

jobs:
  restore-test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17-alpine
        env:
          POSTGRES_USER: spindle
          POSTGRES_PASSWORD: spindle
          POSTGRES_DB: spindle
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U spindle -d spindle"
          --health-interval 5s --health-timeout 5s --health-retries 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - name: Install Postgres client tools
        run: sudo apt-get update && sudo apt-get install -y postgresql-client-17
      - name: Seed schema
        run: npx prisma migrate deploy
        env:
          DATABASE_URL: postgresql://spindle:spindle@localhost:5432/spindle
          DIRECT_URL: postgresql://spindle:spindle@localhost:5432/spindle
      - name: Take a backup
        run: npx tsx scripts/db/backup/backup.ts --backup-dir backups
        env:
          DATABASE_URL: postgresql://spindle:spindle@localhost:5432/spindle
          DIRECT_URL: postgresql://spindle:spindle@localhost:5432/spindle
      - name: Restore test
        run: node scripts/db/restore-test/restore-test.mjs --backup-dir backups
        env:
          DATABASE_URL: postgresql://spindle:spindle@localhost:5432/spindle
          DIRECT_URL: postgresql://spindle:spindle@localhost:5432/spindle
```

Notes for CI:

- The scratch database is created and dropped on the same service container —
  no extra infrastructure needed.
- Keep `--dry-run` as a PR-time smoke check: it validates argument parsing and
  plan generation without a database.
- If backups are stored off-box (S3, etc.), add a download step and pass
  `--file` instead of `--backup-dir`.
- Upload the script's stdout as a workflow artifact on failure — it contains
  the table counts that make the failure diagnosable.

## Local smoke check

```bash
node scripts/db/restore-test/restore-test.mjs --dry-run
```

This must exit 0 and print the plan (create → restore → verify → drop) without
requiring `DATABASE_URL`, `psql`, or a real backup file.
