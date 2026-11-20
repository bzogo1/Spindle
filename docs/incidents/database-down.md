# Playbook — database down / degraded

Postgres is unreachable, refusing connections, or critically degraded. The DB
is a single point of failure by design (ADR 0001 §6): writes fail, sessions
and file sync stall, the app 5xxs.

## Severity

**SEV1** when Postgres is down or unreachable — writes fail for all users.
**SEV2** for critical-level monitor rules that don't fully stop service
(`connection-pool-saturation` ≥ 90%, `disk-usage` ≥ 90%).

## Detection signals

- `scripts/db/monitoring/check.mjs` firing rules from
  `scripts/db/monitoring/rules.json` — run it directly:

  ```bash
  node scripts/db/monitoring/check.mjs --only connection-pool-saturation,disk-usage,failed-migrations
  ```

  Rule → severity mapping is in `docs/runbooks/database-monitoring.md`
  §"Alert catalogue" and routed via `docs/alerts/routing.json` (`db-monitor`
  source: `connection-pool-saturation`, `disk-usage`, `failed-migrations`,
  `backup-staleness` → `db-critical`; warnings → `db-warning`).

- App errors in Sentry (`src/sentry.server.config.ts` — error events unsampled).
- `docker compose ps` on the host shows `postgres` unhealthy
  (`docs/runbooks/hosting.md` §2).
- `_prisma_migrations` rows with `finished_at IS NULL` → escalate to
  `migration-failure.md`.

## Immediate steps

1. **Confirm scope.** On the host:

   ```bash
   sudo docker compose --env-file host.env ps postgres
   sudo docker compose --env-file host.env logs --tail 200 postgres
   ```

   Then from an admin machine run the monitor above with `DATABASE_URL` set.
   `status: error` means the checker couldn't measure — the DB is likely down;
   `skipped` on `disk-usage` means run the checker on the DB host.

2. **Postgres container down/crash-looping.**
   `sudo docker compose --env-file host.env up -d --wait postgres`. If it
   crash-loops, read the logs: common causes are corrupted data dir (→ step 5)
   or disk full (→ `disk-usage` below).

3. **Connection pool saturation** (`connection-pool-saturation` critical).
   Follow `docs/runbooks/database-monitoring.md` §"connection-pool-saturation":
   identify holders with the `pg_stat_activity` query there, check for
   connection leaks, lower `connection_limit` in `DATABASE_URL` or raise
   `max_connections`. Each app/worker replica pools per process — many
   replicas × large pool exhausts `max_connections`.

4. **Disk full** (`disk-usage` ≥ 90% critical). At >90% Postgres can fail
   writes — free space **immediately** per
   `docs/runbooks/database-monitoring.md` §"disk-usage": drop stale backups
   off-volume, check `pg_wal` size and unpruned logs. `VACUUM FULL` only as a
   last resort (needs ~2× table size free).

5. **Data corruption / unrecoverable Postgres.** Restore path:
   `docs/runbooks/database-restore-test.md` proves artifacts restore into a
   scratch DB; for a real restore, stop writes, `pg_restore`/`psql` the newest
   artifact from `backups/` (see `docs/runbooks/database-backup.md` for
   artifact naming and decrypting `.enc`/`.gpg` files), run
   `node scripts/db/migrate.mjs --ci` to reconcile schema, redeploy.
   RTO ≤ 4 h, RPO ≤ 24 h per `docs/resilience/disaster-recovery.md` — note the
   known gap: `backups/` is repo-local until synced off-box.

6. **Verify.** `node scripts/db/monitoring/check.mjs` all-ok (or expected
   `skipped`), app smoke: sign in, load a project page, confirm writes.

## Comms template

```text
[SEV1] Database degraded/down — Postgres <status> since <time UTC>.
Impact: <writes failing | reads degraded | pool saturated>. Monitor rule:
<rule-id>=<status>. IC: <name>. Next update in 15 min.
```

## Postmortem checklist

- [ ] Which rule fired first; was detection faster than user reports?
- [ ] Root cause (OOM, disk, bad deploy, lock storm, provider/hardware).
- [ ] Data-loss assessment: any writes lost between last good backup and
      failure? Compare against RPO ≤ 24 h (`docs/resilience/disaster-recovery.md`).
- [ ] If restore was needed: was the newest artifact actually restorable
      (`restore-test.mjs` result)?
- [ ] Action items: monitor threshold tuning, pool sizing, backup off-box sync
      (the known DR gap), capacity note for the AX42-1.
