# Playbook — backup failure / stale or unrestorable backups

The daily `pg_dump` pipeline (`scripts/db/backup/backup.ts`) is failing, the
newest artifact is stale, or — worst case — artifacts exist but don't restore.
Backups are the RPO foundation: `docs/resilience/disaster-recovery.md` sets
RPO ≤ 24 h and the `backup-staleness` rule warns at 26 h / critical at 50 h.

## Severity

**SEV2** when `backup-staleness` is critical (>50 h, empty dir) or the backup
job is failing — you are accumulating data-loss exposure. **SEV1** upgrade if
a restore test proves artifacts don't restore _and_ no valid backup exists, or
if combined with an active database incident. **SEV3** for warning-level
staleness (26–50 h) with a known cause.

## Detection signals

- `backup-staleness` file rule (`scripts/db/monitoring/rules.json`) — newest
  artifact age in `MONITOR_BACKUP_DIR` (default `backups/`); existing-but-empty
  dir is critical, missing dir is `skipped`. Routed `db-monitor` →
  `db-critical`.
- Cron/scheduler logs for `backup.ts --ci` — one greppable `[backup]` line per
  message (`docs/runbooks/database-backup.md` §"Scheduling").
- `disk-usage` rule critical — a full disk silently breaks `pg_dump`
  (`docs/runbooks/database-monitoring.md` §"backup-staleness" step 3).
- Restore-test failures (see below) — presence ≠ restorability.

## Immediate steps

1. **Check freshness and run the monitor:**

   ```bash
   node scripts/db/monitoring/check.mjs --only backup-staleness
   ls -lt backups/ | head    # newest spindle-* artifact and its age
   ```

2. **Did the job run?** Check cron/systemd/CI logs for
   `npx tsx scripts/db/backup/backup.ts --ci`. Non-zero exit = no usable backup
   produced — read the `pg_dump` output above the failure line
   (`docs/runbooks/database-backup.md` §"Common failures": missing
   `pg_dump` binary, version mismatch, bad `DIRECT_URL`, unreachable DB,
   missing `BACKUP_ENCRYPTION_PASSPHRASE`/`BACKUP_ENCRYPTION_KEY_FILE`).

3. **Run a backup manually now** to close the gap:

   ```bash
   npx tsx scripts/db/backup/backup.ts --dry-run   # inspect plan first
   npx tsx scripts/db/backup/backup.ts --ci        # real run
   ```

   With encryption: `--encrypt openssl` +
   `BACKUP_ENCRYPTION_KEY_FILE` (preferred over the env var in cron — keeps the
   passphrase out of `crontab -l`/`ps`). Only the `.enc`/`.gpg` ciphertext
   should remain; plaintext is deleted by the script.

4. **Prove the newest artifact restores** — always after a backup failure:

   ```bash
   node scripts/db/restore-test/restore-test.mjs --backup-dir backups
   # encrypted artifact? decrypt first — see docs/runbooks/database-backup.md
   ```

   Non-zero exit = backup-pipeline bug, not a test bug. A passing run creates,
   restores, verifies, and drops a scratch DB on the same server.

5. **Fix retention/disk.** `backup-staleness` only watches freshness, not
   count — check `backups/` isn't growing past `--keep` (default 14,
   `BACKUP_RETENTION_COUNT`) and that pruning ran. Cross-check `disk-usage`.

6. **Off-box gap.** `backup.ts` writes to repo-local `backups/` and does
   **not** upload anywhere — the DR plan's known gap
   (`docs/resilience/disaster-recovery.md` §"Known gap"). If host loss is the
   concern, confirm whatever off-box sync exists is current; if none exists,
   file the follow-up — until then RPO against full host loss is whatever the
   sync interval is.

7. **Verify.** Newest artifact age < 26 h, `--ci` run exits 0, restore-test
   exits 0, monitor `backup-staleness` = `ok`.

## Comms template

```text
[SEV2] Backup pipeline failing — last good artifact <age>h old (alert at 26h,
critical 50h). Cause: <pg_dump error class>. Manual backup <taken | pending>;
restore-test <passed | pending>. Data-loss exposure window: <since last good
backup>. IC: <name>.
```

If restore-test fails on the newest artifact, say "backups may be
unrestorable" — that changes the incident class.

## Postmortem checklist

- [ ] Root cause of the missed/failed backup (cron, credentials, disk, pg_dump
      version, encryption passphrase).
- [ ] Actual RPO exposure: timestamp of last verified-restorable artifact.
- [ ] Did restore-test run against the newest artifact? Result?
- [ ] Off-box sync status — is `backups/` replicated anywhere?
- [ ] Action items: fix scheduler alerting on non-zero exit, schedule periodic
      restore-test (`docs/runbooks/database-restore-test.md` §"CI integration"),
      close the off-box upload gap (DEV-15 follow-up).
