# Log retention

How long each class of Spindle log lives, where it lives, and what enforces
the limit. Companion to [log-aggregation.md](./log-aggregation.md) (how logs
reach a queryable store) — this document is about **how long they are kept**.

Retention is enforced at three layers, and each layer owns a different set of
files:

| Layer                     | Owns                                                                                                  | Mechanism                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Docker `json-file` driver | container stdout/stderr (`*-json.log` under `/var/lib/docker/containers/`)                            | `max-size` × `max-file` rotation — size-based, automatic              |
| Central store             | shipped app logs                                                                                      | Loki `retention_period` / Vector disk buffer (see log-aggregation.md) |
| Host filesystem           | log files the driver doesn't manage: audit JSONL, spooled JSONL, access/deploy logs, backup artifacts | `scripts/retention/enforce.mjs` + `scripts/retention/policy.json`     |

Never point the enforcement script at Docker's `*-json.log` files — the
driver owns those, and deleting the active file corrupts the container's log
stream. The script's default policy only matches repo-relative paths.

## Per-source retention policy

| Source                               | Where it lives                                                                                                      | Retention                                                                                                                                            | Justification                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App JSON logs (pino stdout)          | container stdout → Docker json-file → optional ship.mjs → Loki                                                      | Driver rotation locally (see below); **14 days** in Loki                                                                                             | SLO windows are 28d rolling (`docs/slo/service-level-objectives.md`); 14d hot + shipped history covers incident investigation. Local spool copies: compress after 7d, delete after 30d — the store is the record.                                                                                                                                       |
| nginx / edge access logs             | `logs/nginx/` on the host (Cloudflare edge logs stay in Cloudflare)                                                 | compress after 7d, **delete after 90d**, keep newest 1                                                                                               | 90d = 28d SLO window + quarter (`docs/resilience/disaster-recovery.md` drill cadence) + investigation margin. `keepNewest` protects the active file.                                                                                                                                                                                                    |
| Postgres logs                        | container stdout → Docker json-file (postgres:17-alpine logs to stderr)                                             | Driver rotation only                                                                                                                                 | Postgres emits little; `log_min_messages` defaults keep volume low. Query-level signals live in `scripts/db/monitoring/` rules, not log retention.                                                                                                                                                                                                      |
| Deploy logs                          | `logs/deploy/` on the deploy host; GitHub Actions artifacts in CI                                                   | compress after 14d, **delete after 90d**                                                                                                             | Release history of record is `scripts/deploy/rollback.mjs` records + Actions artifacts; local logs are debugging aids. 90d matches the quarterly DR drill.                                                                                                                                                                                              |
| Secret access audit                  | `.spindle/secret-access-audit.jsonl*`                                                                               | compress after 30d, **delete after 365d** (local floor ≥ 90d)                                                                                        | Contract in `docs/security/secret-access-audit.md`: keep ≥ 90 days locally to cover the longest rotation max-age (`docs/runbooks/secrets-rotation.md`: B2/Edge HMAC/LLM/Postgres/Worker = 90d, Session = 30d; Resend provider overlap = 180d is covered by the shipped copy + quarterly store export). Names and actors only, but treated as sensitive. |
| Shipper spool (`ship.mjs` file sink) | `logs/ship.jsonl*` (default `--out`; rotated `.1`/`.2` siblings) or `logs/ship/` if `--out` points into a directory | rotate at 100 MB × 3 (shipper), compress after 7d, delete after 30d                                                                                  | Spool is a buffer for Loki/Vector, not the record. At-least-once delivery means gaps self-heal on the next batch.                                                                                                                                                                                                                                       |
| Backup artifacts                     | `backups/spindle-*`                                                                                                 | **count-based**: newest 14 (`--keep` / `BACKUP_RETENTION_COUNT`, 30 in the cron example) owned by `scripts/db/backup/backup.ts`; age safety net 400d | RPO ≤ 24h and count retention are defined in `docs/resilience/disaster-recovery.md` and `docs/runbooks/database-backup.md`. The 400d rule only stops a forgotten cron from accumulating dumps forever; `keepNewest: 14` is a second guard. Do **not** shorten this — restore drills pick the oldest retained artifact once a year.                      |

## Docker `json-file` driver recommendations

`infra/origin/compose.yaml` already sets a shared logging anchor:

```yaml
x-logging: &logging
  driver: json-file
  options:
    max-size: "20m"
    max-file: "5"
```

That is **100 MB per container** — reasonable for the origin stack. If you
compose your own overlay or run additional log-producing sidecars (e.g. an
nginx reverse proxy or a second shipper), apply these rules:

| Service class               | `max-size` | `max-file` | Ceiling | Notes                                                                                                            |
| --------------------------- | ---------- | ---------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| app / worker (chatty pino)  | `20m`      | `5`        | 100 MB  | matches origin compose; pair with ship.mjs so nothing important lives only here                                  |
| postgres / valkey (quiet)   | `20m`      | `5`        | 100 MB  | low volume means the ceiling may span months — acceptable; size-based rotation is the only option with json-file |
| nginx / access-log sidecar  | `50m`      | `5`        | 250 MB  | access logs are higher volume; keep ceiling small anyway since `logs/nginx/` is the durable copy                 |
| log shipper / one-shot jobs | `10m`      | `3`        | 30 MB   | shippers emit stats lines only                                                                                   |

Guidelines:

- **Never set `max-file: "0"`** (unlimited) — one runaway loop can fill the
  host disk.
- json-file rotation is **size-based, not time-based**: a quiet container's
  "5 files" may cover months while a chatty one's cover hours. That is fine
  for container stdout because Loki holds the durable copy; it is _not_ fine
  for the audit log, which is why `.spindle/` is a mounted file the script
  manages by age.
- Alternatives (`local` driver with `compress` + time-based `max-file`,
  `journald`, `syslog`, `fluentd`/`loki` drivers) all work, but `json-file`
  is what the checked-in compose uses and what `ship.mjs --file` can tail
  directly. If you switch drivers, update the shipper command accordingly.

## Running the enforcer

`scripts/retention/enforce.mjs` is dependency-free Node. It reads
`scripts/retention/policy.json`, expands each rule's glob `match` patterns
relative to `--root` (default: repo root), and for every matched file:

- **compresses** (`gzip` → `<file>.gz`) when mtime age ≥ `compressAfterDays`,
- **deletes** when age ≥ `deleteAfterDays` (applies to `.gz` files too),
- never deletes the newest `keepNewest` matches.

A file past both thresholds is deleted outright (compression would be wasted
work). Age is mtime-based, so it is safe against live files — only files
already older than the threshold are touched.

```bash
# See what would happen (cron-safe dry run)
node scripts/retention/enforce.mjs --dry-run

# Exercise the engine on a throwaway fixture tree
node scripts/retention/enforce.mjs --demo

# Apply for real — suggested cron, daily at 04:15
15 4 * * * cd /srv/spindle && node scripts/retention/enforce.mjs >> /var/log/spindle-retention.log 2>&1

# Different root / policy / machine-readable output
node scripts/retention/enforce.mjs --root /var/log/spindle --config scripts/retention/policy.json --json
```

Env equivalents: `RETENTION_CONFIG`, `RETENTION_ROOT`, `RETENTION_DRY_RUN`.

Exit codes: `0` clean (including dry-run), `1` one or more files failed,
`2` usage/policy error. Run `--dry-run` after editing `policy.json` before
enabling the cron.

### Policy file format

```jsonc
{
  "version": 1,
  "rules": [
    {
      "name": "my-logs",
      "match": ["logs/**/*.log*"], // glob; '**' crosses directories, '*' stays in one segment
      "exclude": ["*.gz", "active.log"], // optional; matched against path and basename
      "compressAfterDays": 7, // optional: gzip older files
      "deleteAfterDays": 30, // optional: delete older files
      "keepNewest": 1, // optional: newest N matches are never deleted
    },
  ],
}
```

At least one of `compressAfterDays`/`deleteAfterDays` is required per rule.
Absolute patterns (e.g. `/var/log/nginx/*.log`) are supported with
`--root /` or as-is; relative patterns resolve against `--root`.

## What this policy deliberately does not cover

- **Loki/Vector retention** — configured in the store (`limits_config.
retention_period`, compactor), documented in log-aggregation.md. The
  enforcer cannot reach inside Loki.
- **GitHub Actions artifacts** — retention is a repo/org setting; deploy
  logs of record live there.
- **Cloudflare edge logs** — retained in the Cloudflare dashboard/logpull
  per the Zero Trust plan, not on this host.
- **Postgres data itself** — `pg_dump` artifacts are covered above; the live
  database has no log-style retention.
