# Runbook — database monitoring alerts

This runbook covers the alert checker in
[`scripts/db/monitoring/check.mjs`](../../scripts/db/monitoring/check.mjs) and
the rule definitions in
[`scripts/db/monitoring/rules.json`](../../scripts/db/monitoring/rules.json).
It needs no external alertmanager: the script prints a JSON report and can
POST it to any generic webhook.

## How it works

`check.mjs` evaluates every rule in `rules.json` and assigns each a status:

| Status     | Meaning                                                           |
| ---------- | ----------------------------------------------------------------- |
| `ok`       | Value is below both thresholds.                                   |
| `warning`  | Value crossed the rule's `warn` threshold.                        |
| `critical` | Value crossed the rule's `critical` threshold (or `whenEmpty`).   |
| `skipped`  | The rule could not be measured (no DB, no replicas, missing dir). |
| `error`    | The measurement itself failed (bad query, unreachable database).  |

Rule types:

- **`sql`** — runs `query` against `DATABASE_URL` via `pg` and compares the
  first column of the first row. `NULL` → `skipped`.
- **`sql-path`** — query returns a filesystem path; the checker `statfs`es it
  and compares the used fraction. Only works when the checker runs on the DB
  host (or a host sharing the mount); otherwise `skipped`.
- **`file`** — scans a directory (default `backups/`, override with the rule's
  `pathEnv`/`pathDefault`) and measures file ages. Works with no database.

`--dry-run` never connects to a database: rules with a `demo` value in
`rules.json` are evaluated against that sample data and marked `[demo]`.

## Usage

```bash
# Evaluate everything (connects via DATABASE_URL from env/.env.local/.env)
node scripts/db/monitoring/check.mjs

# Sample-data evaluation, no database touched — safe anywhere
node scripts/db/monitoring/check.mjs --dry-run

# Machine-readable report only
node scripts/db/monitoring/check.mjs --json > report.json

# Cron-friendly: one [monitor] line per rule, exit 1 on warning+
node scripts/db/monitoring/check.mjs --ci

# Only specific rules
node scripts/db/monitoring/check.mjs --only backup-staleness,disk-usage

# Custom rules file
node scripts/db/monitoring/check.mjs --rules path/to/rules.json
```

Exit codes: `0` all `ok`/`skipped` (or `--dry-run`), `1` at least one
`warning`/`critical`/`error`, `2` usage error.

Environment variables: `DATABASE_URL` (same dotenv resolution as
`scripts/db/migrate.mjs`), `MONITOR_BACKUP_DIR` (file-rule directory),
`MONITOR_WEBHOOK_URL` / `MONITOR_WEBHOOK_TOKEN` (see below).

## Alert catalogue

Each rule maps to a runbook anchor below. "Suggested thresholds" are the
values shipped in `rules.json`; tune per environment.

| Rule id                        | Severity | Metric                          | Warn  | Critical | Type     |
| ------------------------------ | -------- | ------------------------------- | ----- | -------- | -------- |
| `connection-pool-saturation`   | critical | active conns / max_connections  | 75%   | 90%      | sql      |
| `idle-in-transaction-sessions` | warning  | sessions `idle in transaction`  | 5     | 20       | sql      |
| `long-running-queries`         | warning  | oldest active query age         | 120 s | 600 s    | sql      |
| `replication-lag`              | warning  | max standby replay lag          | 60 s  | 300 s    | sql      |
| `disk-usage`                   | critical | used fraction of data_directory | 80%   | 90%      | sql-path |
| `dead-tuple-ratio`             | warning  | dead / total tuples             | 20%   | 40%      | sql      |
| `failed-migrations`            | critical | unfinished `_prisma_migrations` | —     | any > 0  | sql      |
| `backup-staleness`             | critical | age of newest backup file       | 26 h  | 50 h     | file     |

Suggested cron cadence: every 5 minutes for `sql` rules is cheap (seven
small catalog queries); `file` rules can run less often.

```cron
*/5 * * * * cd /srv/spindle && node scripts/db/monitoring/check.mjs --ci
```

## Notifications

The JSON report is self-describing and safe to pipe anywhere:

```json
{
  "type": "database-monitoring",
  "generatedAt": "…",
  "dryRun": false,
  "database": { "connected": true, "url": "postgresql://***@host/db" },
  "summary": { "ok": 5, "warning": 1, "critical": 1, "skipped": 1, "error": 0 },
  "alerts": [ { "id": "…", "status": "critical", "value": …, "runbook": "…" } ]
}
```

The `DATABASE_URL` password is stripped before the URL appears in the
report. `alerts` contains every evaluated rule; filter on `status` for
firing alerts only.

### Direct webhook

```bash
MONITOR_WEBHOOK_URL=https://hooks.example.com/db \
MONITOR_WEBHOOK_TOKEN=… \
node scripts/db/monitoring/check.mjs --ci
```

or per-invocation: `--webhook https://…`. The script POSTs the full report
as `application/json` with an optional `Authorization: Bearer` header. In
`--dry-run` it prints what it would POST and sends nothing.

### Via `scripts/deploy/notify.ts`

The deploy notifier
([`scripts/deploy/notify.ts`](../../scripts/deploy/notify.ts)) only accepts
deploy-shaped events (`started|succeeded|failed|rolled-back`), so it cannot
carry the per-rule payload. The supported pattern is to treat a firing
monitor run as a `failed` event and attach the report summary as the error:

```bash
node scripts/db/monitoring/check.mjs --json > /tmp/db-monitor.json
if [ $? -ne 0 ]; then
  SUMMARY=$(node -e 'const r=require("/tmp/db-monitor.json");console.log(Object.entries(r.summary).filter(([k,n])=>n>0&&!["ok","skipped"].includes(k)).map(([k,n])=>`${k}=${n}`).join(" "))')
  FIRING=$(node -e 'const r=require("/tmp/db-monitor.json");console.log(r.alerts.filter(a=>["warning","critical","error"].includes(a.status)).map(a=>`${a.id}:${a.status}`).join(", "))')
  npx tsx scripts/deploy/notify.ts --event failed \
    --error "database-monitoring: $SUMMARY — $FIRING (report: /tmp/db-monitor.json)" \
    --channels webhook,email,console
fi
```

This reuses the notifier's `webhook` (`DEPLOY_NOTIFY_WEBHOOK_URL`),
`email` (`RESEND_API_KEY`), and `console` channels without any changes to
that script. For richer per-alert routing, prefer `--webhook` above.

## Per-alert runbooks

### connection-pool-saturation

Fires when `count(pg_stat_activity) / max_connections` exceeds 75% (warn) or
90% (critical).

1. Identify the holders:
   `SELECT application_name, state, count(*) FROM pg_stat_activity GROUP BY 1,2 ORDER BY 3 DESC;`
2. Check for connection leaks in app logs — PrismaPg pools per process, so
   many replicas × large pool size can exhaust `max_connections` even at
   modest traffic. Lower `connection_limit` in `DATABASE_URL` or raise
   `max_connections`.
3. Look for `idle` connections accumulating: they are usually pooled
   clients between requests, but a growing count with no traffic is a leak.
4. If saturation is brief and self-heals, consider raising `warn` to 0.85.

### idle-in-transaction-sessions

Sessions in `idle in transaction` state pin locks and block autovacuum.

1. Find them:
   `SELECT pid, application_name, now() - state_change AS idle_for, left(query, 200) FROM pg_stat_activity WHERE state = 'idle in transaction' ORDER BY state_change;`
2. Match `application_name`/query text to the offending code path — usually
   a request handler that opened a transaction and returned early.
3. Terminate runaway sessions if needed:
   `SELECT pg_terminate_backend(<pid>);` — only after confirming the
   transaction is abandoned.
4. Prevention: keep transactions short; never hold a transaction across
   external calls (email, S3, HTTP).

### long-running-queries

Oldest `state = 'active'` query exceeds 120 s (warn) / 600 s (critical).
This rule uses `pg_stat_activity`, so it works even without
`pg_stat_statements`.

1. Identify the query:
   `SELECT pid, now() - query_start AS age, left(query, 300) FROM pg_stat_activity WHERE state = 'active' AND pid <> pg_backend_pid() ORDER BY query_start;`
2. Check `pg_stat_activity.wait_event` — `Lock` means lock contention (see
   `idle-in-transaction-sessions`); `IO`/`LWLock` suggests resource
   saturation (see `disk-usage`).
3. For recurring slow queries, enable `pg_stat_statements` and add a
   mean-exec-time rule to `rules.json`.
4. If the query is a runaway migration or report, `pg_cancel_backend(pid)`
   stops it without dropping the connection; `pg_terminate_backend` is the
   escalation.

### replication-lag

**Stubbed alert.** On a single-node deployment `pg_stat_replication` is
empty and the rule reports `skipped` — that is expected, not a failure. When
a standby exists, lag is the max `replay_lag` across replicas.

1. Confirm replicas exist:
   `SELECT application_name, state, replay_lag FROM pg_stat_replication;`
2. Check the replica's own health (disk, CPU, network) — lag is usually a
   downstream problem.
3. If the primary is WAL-bloated, check `pg_wal` size and replication slot
   retention (`pg_replication_slots`).
4. For managed Postgres, check the provider's replica-lag metric first;
   this rule is a fallback signal.

### disk-usage

Used fraction of the filesystem holding `data_directory` exceeds 80% (warn)
/ 90% (critical). The checker `statfs`es the path returned by
`SHOW data_directory`, so it must run on the DB host (or a host with the
same mount). On a remote DB it reports `skipped` — run the checker on the
database host, or monitor the volume with node-level tooling.

1. Check headroom: `df -h <data_directory>` and inside Postgres
   `SELECT pg_size_pretty(pg_database_size(current_database()));`
2. Find the growth: table bloat (see `dead-tuple-ratio`), WAL accumulation
   (`pg_wal` directory size), or unpruned backups/logs on the same volume.
3. At >90%, Postgres can fail writes. Free space immediately: drop stale
   backups off-volume, run `VACUUM FULL` only as a last resort (it needs
   free space equal to the table size).
4. WAL: `SELECT pg_size_pretty(sum(size)) FROM pg_ls_waldir();` — archive
   or remove old segments if archiving is stuck.

### dead-tuple-ratio (bloat)

`sum(n_dead_tup) / sum(n_live_tup + n_dead_tup)` across user tables exceeds
20% (warn) / 40% (critical) — autovacuum is behind.

1. Find the worst tables:
   `SELECT relname, n_live_tup, n_dead_tup, last_autovacuum, last_autoanalyze FROM pg_stat_user_tables ORDER BY n_dead_tup DESC LIMIT 10;`
2. Check autovacuum is running: `SELECT * FROM pg_stat_activity WHERE query LIKE 'autovacuum%';`
   and `SHOW autovacuum;`.
3. One-off fix: `VACUUM (VERBOSE) <table>;` — never `VACUUM FULL` in
   production without a maintenance window (it rewrites the table and needs
   ~2× disk).
4. Chronic bloat: tune `autovacuum_vacuum_scale_factor` per-table for hot
   tables, and investigate update-heavy write patterns.

### failed-migrations

Any row in `_prisma_migrations` with `finished_at IS NULL` is critical — a
deploy was interrupted or a migration failed.

1. Inspect:
   `SELECT migration_name, started_at, finished_at, rolled_back_at, logs FROM _prisma_migrations WHERE finished_at IS NULL;`
2. Follow [`database-migrations.md`](database-migrations.md): resolve the
   failed SQL manually or `prisma migrate resolve`, then re-run
   `node scripts/db/migrate.mjs --ci`.
3. Never hand-edit `_prisma_migrations` to hide the row — reconcile via a
   new migration or restore the pre-migration backup.

### backup-staleness

Age of the newest file in `MONITOR_BACKUP_DIR` (default `backups/`) exceeds
26 h (warn) / 50 h (critical) — assumes a daily backup cadence; adjust
thresholds to your schedule. An existing-but-empty directory is critical; a
missing directory is `skipped` (backups may live elsewhere — set
`MONITOR_BACKUP_DIR`).

1. Check whether the backup job ran: look at cron/CI logs for
   `scripts/db/backup/` or `pg_dump` invocations.
2. Verify the dump is restorable, not just present — schedule periodic
   `scripts/db/restore-test/` runs.
3. Check disk space on the backup target (see `disk-usage`); a full disk
   silently breaks `pg_dump`.
4. Retention: keep enough dumps to roll back past the last known-good
   deploy; the file rule only watches freshness, not count.

## Adding rules

Edit `rules.json` — no code changes needed for `sql`, `sql-path`, and `file`
types. Supported fields: `id`, `title`, `description`, `severity`, `type`,
`requiresDb`, `query`, `pathEnv`, `pathDefault`, `pattern`, `metric`
(`newestAgeHours` | `oldestAgeHours` | `fileCount`), `unit`, `op`, `warn`,
`critical`, `whenEmpty`, `demo`, `message` (`{value}`/`{warn}`/`{critical}`
placeholders), `runbook`.
