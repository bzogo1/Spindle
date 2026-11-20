# Runbook — database backups

`backup` takes a `pg_dump` snapshot of the Spindle Postgres database into a
local backup directory, optionally encrypts the artifact, and prunes old
artifacts down to a retention count. It is the scheduled counterpart to the
pre-migration backup inside `scripts/db/migrate.mjs` — that one is a
point-in-time safety net before `migrate deploy`; this one is the retention
pipeline that keeps a restorable history.

Script: `scripts/db/backup/backup.ts` (shared helpers in
`scripts/db/backup/lib.ts`)

## When to run it

- **On a schedule** — daily at minimum for staging/production. Wire it into
  cron or your scheduler (see "Scheduling" below). A backup that only runs
  when someone remembers is not a backup strategy.
- **Before any risky operation** — large data imports, manual schema edits,
  or anything `scripts/db/migrate.mjs` does not cover.
- **After changing the backup pipeline** — run `--dry-run` first, then a real
  run, then prove the artifact restores with
  `docs/runbooks/database-restore-test.md`.

## Prerequisites

- `pg_dump` on `PATH` (same major version as the server). Override with
  `BACKUP_PG_DUMP` if it lives elsewhere.
- `DATABASE_URL` / `DIRECT_URL` set (env or `.env`/`.env.local`). The dump
  connects with `DIRECT_URL`, falling back to `DATABASE_URL` — the same order
  `migrate.mjs` uses.
- For `--encrypt openssl`: `openssl` on `PATH` (override `BACKUP_OPENSSL`).
- For `--encrypt gpg`: `gpg` on `PATH` (override `BACKUP_GPG`).
- For encryption: a passphrase via `BACKUP_ENCRYPTION_PASSPHRASE` or
  `BACKUP_ENCRYPTION_KEY_FILE` (path to a file whose contents are the
  passphrase — preferred for schedulers so the secret stays out of crontab
  and process listings).
- Node dependencies installed (`npm install`) — the script runs under `tsx`.

## Usage

```bash
# Dry run — prints the full plan, touches nothing, needs no database:
npx tsx scripts/db/backup/backup.ts --dry-run

# Default: custom-format dump into backups/, keep newest 14:
npx tsx scripts/db/backup/backup.ts

# Plain SQL dump, custom dir, keep 30:
npx tsx scripts/db/backup/backup.ts --format plain --backup-dir /mnt/backups --keep 30

# Encrypted dump (openssl AES-256-CBC, passphrase from env or key file):
npx tsx scripts/db/backup/backup.ts --encrypt openssl

# Encrypted dump (gpg symmetric AES256):
npx tsx scripts/db/backup/backup.ts --encrypt gpg

# CI/scheduler mode — greppable [backup] lines, missing DATABASE_URL is fatal:
npx tsx scripts/db/backup/backup.ts --ci
```

Options:

| Flag                 | Default                             | Purpose                                                     |
| -------------------- | ----------------------------------- | ----------------------------------------------------------- |
| `--dry-run`          | off                                 | Print the plan; execute nothing                             |
| `--ci`               | off                                 | Greppable output; missing `DATABASE_URL` fails preflight    |
| `--format <fmt>`     | `custom` (env `BACKUP_FORMAT`)      | `custom` → `pg_restore`; `plain` → `psql`                   |
| `--backup-dir <dir>` | `backups/` (env `BACKUP_DIR`)       | Output directory; resolved relative to repo root            |
| `--keep <n>`         | `14` (env `BACKUP_RETENTION_COUNT`) | Newest artifacts retained after pruning                     |
| `--encrypt <mode>`   | `none` (env `BACKUP_ENCRYPT`)       | `none`, `openssl` (AES-256-CBC + PBKDF2), or `gpg` (AES256) |
| `--no-prune`         | off                                 | Skip retention pruning                                      |
| `--help`, `-h`       | —                                   | Show usage                                                  |

## What the script does

1. **Preflight** — verifies the database URL, `pg_dump`, and (when encrypting)
   the cipher binary and passphrase. `--ci` makes a missing URL fatal.
2. **pg_dump** — `pg_dump --format=<custom|plain> --no-password --file <path>
<url>`. Custom dumps are written as `spindle-<timestamp>.dump`, plain as
   `spindle-<timestamp>.sql`. The backup dir gets a local `.gitignore`
   (`*` + `!.gitignore`) so artifacts never reach git — same approach as
   `migrate.mjs`.
3. **Encrypt** (optional) — the plaintext artifact is encrypted to
   `<name>.enc` (openssl) or `<name>.gpg` (gpg) and then **deleted**; only
   ciphertext remains. The openssl passphrase is passed via an environment
   variable, never on the command line; gpg reads it from fd 0.
4. **Prune** — artifacts matching `spindle-*` with a recognized backup
   extension are sorted by mtime and everything past `--keep` is deleted.
   This also counts pre-migration backups written by `migrate.mjs` (same
   prefix and directory), so retention applies to the whole backup dir.

## Artifact naming and compatibility

| Produced by         | Filename                             | Restorable via                               |
| ------------------- | ------------------------------------ | -------------------------------------------- |
| `--format custom`   | `spindle-<ts>.dump`                  | `restore-test.mjs` auto-detects (pg_restore) |
| `--format plain`    | `spindle-<ts>.sql`                   | `restore-test.mjs` auto-detects (psql)       |
| `--encrypt openssl` | `spindle-<ts>.dump.enc` / `.sql.enc` | decrypt first, then `restore-test --file`    |
| `--encrypt gpg`     | `spindle-<ts>.dump.gpg` / `.sql.gpg` | `gpg -d` first, then `restore-test --file`   |

Encrypted artifacts are intentionally **not** auto-detected by
`restore-test.mjs` — decrypt them to a `.dump`/`.sql` file first:

```bash
# openssl
openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_ENCRYPTION_PASSPHRASE \
  -in backups/spindle-2026-11-20T04-00-00-000Z.dump.enc -out /tmp/restore.dump

# gpg
gpg --batch --yes --pinentry-mode loopback --passphrase-fd 0 -d \
  backups/spindle-2026-11-20T04-00-00-000Z.dump.gpg > /tmp/restore.dump

node scripts/db/restore-test/restore-test.mjs --file /tmp/restore.dump
```

The monitoring `backup-staleness` rule (`scripts/db/monitoring/rules.json`)
matches `.dump`/`.sql` plus `.gz`/`.enc`/`.gpg` variants, so encrypted
artifacts still satisfy freshness checks.

## Pass criteria

- Exit 0 and `pg_dump` reports success; the artifact exists in the backup
  dir.
- With `--encrypt`, only the `.enc`/`.gpg` file remains — the plaintext was
  removed.
- `backups/` contains at most `--keep` `spindle-*` artifacts afterwards.

A non-zero exit means **no usable backup was produced** — check the `pg_dump`
output above the failure line. `pg_dump` failures here are backup-pipeline
bugs; fix them before the next scheduled run.

## Scheduling

Cron example (daily 03:30, encrypted, keep 30):

```cron
30 3 * * * cd /srv/spindle && BACKUP_ENCRYPTION_KEY_FILE=/run/secrets/db-backup-pass BACKUP_ENCRYPT=openssl BACKUP_RETENTION_COUNT=30 npx tsx scripts/db/backup/backup.ts --ci >> /var/log/spindle-backup.log 2>&1
```

Notes:

- `--ci` gives one greppable `[backup]` line per message — pipe the log into
  your alerting.
- Prefer `BACKUP_ENCRYPTION_KEY_FILE` over `BACKUP_ENCRYPTION_PASSPHRASE` in
  cron so the passphrase is not visible in `crontab -l` or `ps`.
- On hosts without `tsx` on PATH, use the repo's `node_modules/.bin/tsx` or
  `npm exec tsx -- scripts/db/backup/backup.ts`.
- Backups written to `backups/` are local to the repo checkout. For real
  disaster recovery, sync the directory off-box (object storage, second host)
  — this script does not upload anywhere.
- The monitoring `backup-staleness` rule alerts when the newest artifact in
  `MONITOR_BACKUP_DIR` (default `backups/`) is older than 26h (critical 50h);
  see `docs/runbooks/database-monitoring.md`.

## Common failures

| Symptom                                             | Likely cause                                                                                       |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `pg_dump binary "pg_dump" not found on PATH`        | Postgres client tools not installed; install `postgresql-client` matching the server major version |
| `pg_dump exited 1`                                  | Bad credentials, unreachable host, or version mismatch — run `pg_dump --version` and check the URL |
| `no encryption passphrase`                          | Set `BACKUP_ENCRYPTION_PASSPHRASE` or `BACKUP_ENCRYPTION_KEY_FILE`                                 |
| `openssl`/`gpg exited … plaintext backup left at …` | Cipher failed mid-run; the unencrypted dump is still on disk — remove it manually after fixing     |
| restore-test finds no backup                        | Backup dir empty or artifacts are encrypted — decrypt first (see above)                            |

## Relationship to other scripts

- `scripts/db/migrate.mjs` — takes its own pre-migration `pg_dump` into the
  same `backups/` dir before `prisma migrate deploy`. Those artifacts count
  toward this script's retention.
- `scripts/db/restore-test/restore-test.mjs` — proves artifacts restore;
  run it after pipeline changes and on a schedule.
- `scripts/db/monitoring/check.mjs` — `backup-staleness` file rule watches
  the same directory.
