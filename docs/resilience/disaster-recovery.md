# Disaster recovery plan and drills

This document is the DR plan summary for Spindle: what we promise to recover,
how fast, and how we prove it. The mechanics live in the runbooks; this page
ties them together and defines the drill program.

Related documents:

- [`docs/runbooks/database-backup.md`](../runbooks/database-backup.md) — the backup pipeline
- [`docs/runbooks/database-restore-test.md`](../runbooks/database-restore-test.md) — proving artifacts restore
- [`docs/runbooks/database-monitoring.md`](../runbooks/database-monitoring.md) — `backup-staleness` alerting
- [`docs/runbooks/hosting.md`](../runbooks/hosting.md) — origin/staging topology
- [`docs/runbooks/secrets-rotation.md`](../runbooks/secrets-rotation.md) and
  [`docs/decisions/0002-secrets-management.md`](../decisions/0002-secrets-management.md) — secret recovery
- [`docs/runbooks/rollback.md`](../runbooks/rollback.md) — deploy rollback procedure

## Recovery objectives

| Objective                  | Target                                                                      | Basis                                                                                                                                                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RPO** (max data loss)    | **≤ 24 h**                                                                  | `scripts/db/backup/backup.ts` runs daily (`--ci` cron example in the backup runbook). The `backup-staleness` monitoring rule warns at 26 h and goes critical at 50 h, so a missed backup pages before the RPO is breached twice over. |
| **RTO — database restore** | **≤ 4 h**                                                                   | Provision/identify a Postgres target, restore the newest artifact via `restore-test` logic or `pg_restore`/`psql`, run `prisma migrate deploy`, verify. Measured by the `db-restore` drill.                                           |
| **RTO — deploy rollback**  | **≤ 15 min**                                                                | `scripts/deploy/rollback.mjs` re-points compose at a recorded release and health-checks; no database involvement. Measured by the `deploy-rollback` drill.                                                                            |
| **RTO — secrets recovery** | **≤ 5 min per secret**                                                      | Infisical re-injection at container start plus `secrets:check --production`; dual-key secrets (`SESSION_SECRET`, `EDGE_HMAC_SECRET`, `WORKER_SECRET`) verify against both current and previous values during rotation.                |
| **Retention**              | newest **14** artifacts by default (`--keep`), pre-migration dumps included | `BACKUP_RETENTION_COUNT` / `--keep` in the backup runbook.                                                                                                                                                                            |

### Known gap

`backup.ts` writes artifacts to the repo-local `backups/` directory and does
**not** upload anywhere (see "Scheduling" notes in the backup runbook). Until
that directory is synced off-box (object storage or a second host), the DR plan
covers host loss only for everything _except_ the database — and database RPO
degrades to whatever the off-box sync interval is. Closing this gap is a
prerequisite for claiming the 24 h RPO against full host loss; track it as a
follow-up to DEV-15.

## Drill program

Drills are defined as data in [`scripts/drills/scenarios.json`](../../scripts/drills/scenarios.json)
and orchestrated by [`scripts/drills/drill.mjs`](../../scripts/drills/drill.mjs). The runner
**delegates** to the existing scripts in their dry-run/plan modes — it never
reimplements restore, rollback, or secret logic.

### Catalog

| Scenario id        | Category      | What it proves                                                                                                              | Local-safe command (what the runner executes)             | Real drill (staging)                                                                                                    |
| ------------------ | ------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `db-restore`       | database      | A backup artifact restores into a scratch DB and passes table/row-count/migration verification                              | `node scripts/db/restore-test/restore-test.mjs --dry-run` | `node scripts/db/restore-test/restore-test.mjs --backup-dir <dir>` on the staging host                                  |
| `backup-plan`      | database      | The backup pipeline's plan (dump → encrypt → prune) is coherent and preflight-clean                                         | `tsx scripts/db/backup/backup.ts --dry-run`               | scheduled `backup.ts --ci` run + a manual `--encrypt openssl` rehearsal                                                 |
| `deploy-rollback`  | deploy        | Release list lookup and the merged-env compose rollback plan resolve correctly                                              | `node scripts/deploy/rollback.mjs --dry-run`              | `DEPLOY_HOST=<staging> DEPLOY_DIR=/srv/spindle-staging node scripts/deploy/rollback.mjs` (then `--to` a chosen release) |
| `verify-secrets`   | secrets       | The injected environment names every expected secret and none are malformed; values are never printed                       | `tsx scripts/secrets/check.ts`                            | `npm run secrets:check -- --production` inside the staging container env                                                |
| `secrets-rotation` | secrets       | Dual-key overlap: previous key verifies during rotation, current signs, revoked keys reject — fully offline, ephemeral keys | `tsx scripts/secrets/rotation-drill.ts`                   | `npm run secrets:verify-rotation` against real injected env                                                             |
| `monitor-alerts`   | observability | Alert rules (incl. `backup-staleness`) evaluate correctly — the detection half of every DR trigger                          | `node scripts/db/monitoring/check.mjs --dry-run`          | `node scripts/db/monitoring/check.mjs` with `DATABASE_URL`/`MONITOR_BACKUP_DIR` on staging                              |

Each scenario carries an `rtoTargetSeconds` value; the runner reports elapsed
time against it. In dry-run mode elapsed time is only a lower-bound proxy —
the real drill is what counts.

### Running local-safe drills

```bash
# Everything, offline-safe (each scenario runs its script's dry-run mode):
node scripts/drills/drill.mjs

# Fully simulated, no commands at all — good for CI smoke / demos:
node scripts/drills/drill.mjs --demo

# One scenario, machine-readable report:
node scripts/drills/drill.mjs --scenario db-restore --json

# Exercise the failure path in demo mode:
DRILL_DEMO_FAIL=db-restore node scripts/drills/drill.mjs --demo   # exits 1
```

Exit codes: `0` all passed, `1` any scenario failed or timed out
(`--timeout <ms>`, default 120 s), `2` usage error. `--list` prints the
catalog.

### Running real drills against staging

Staging is a separate host (`/srv/spindle-staging`, tunnel `spindle-staging`,
Infisical `staging` env — see `docs/runbooks/hosting.md` §3). Schedule drills
**quarterly at minimum**, and after any change to the backup pipeline, deploy
pipeline, or secret rotation procedure.

1. **Preflight** — confirm staging is healthy: `curl -fsS https://staging.spindle.app/`
   and `node scripts/drills/drill.mjs` locally (dry-run layer still passes).
2. **`db-restore`** — on the staging host, run
   `node scripts/db/restore-test/restore-test.mjs --backup-dir /srv/spindle-staging/backups`
   (or `--file` for a specific artifact). Time it; the scratch DB is dropped
   automatically. This is the RTO measurement for database recovery.
3. **`backup-plan`** — confirm the newest artifact in the staging backup dir is
   fresh (`backup-staleness` rule should be OK) and, if the pipeline changed,
   run one real `backup.ts --ci` and re-run step 2 against the new artifact.
4. **`deploy-rollback`** — from an admin machine:
   `DEPLOY_HOST=<staging-user@host> DEPLOY_DIR=/srv/spindle-staging node scripts/deploy/rollback.mjs --list`,
   then run without `--dry-run` to roll back one release, verify
   `https://staging.spindle.app/` answers, then roll forward again. Record
   wall-clock time.
5. **`verify-secrets` / `secrets-rotation`** — inside the staging app
   container env: `npm run secrets:check -- --production` and
   `npm run secrets:verify-rotation`.
6. **`monitor-alerts`** — `node scripts/db/monitoring/check.mjs` on staging
   with real `DATABASE_URL`; confirm `backup-staleness` is OK.
7. **Record** — fill in the checklist below and append a lessons-learned entry.

Never run destructive drills against production. If a production DR event
occurs, this catalog doubles as the response checklist — run the same steps in
the same order.

## Drill checklist template

Copy into the drill log (issue comment, wiki page, or `docs/resilience/` note):

```markdown
### DR drill — <date> — <environment: staging>

- [ ] Preflight: staging health endpoint OK; local `drill.mjs` dry-run all pass
- [ ] db-restore: restore-test exit 0; elapsed ____ (target ≤ 4 h)
- [ ] backup-plan: newest artifact age ____ h (alert threshold 26 h); pipeline unchanged since last drill? y/n
- [ ] deploy-rollback: rolled back to release ____, health OK, rolled forward; elapsed ____ (target ≤ 15 min)
- [ ] verify-secrets: `secrets:check --production` clean; elapsed ____
- [ ] secrets-rotation: `secrets:verify-rotation` reports current=ok previous=ok
- [ ] monitor-alerts: all rules OK on staging (backup-staleness = ____ h)
- [ ] Follow-ups filed: ____

Result: PASS / FAIL — operator: ____ — evidence: ____
```

## Lessons-learned log format

Append one entry per drill (or per real incident) under a `## Drill log` heading
in this file or the linked issue:

```markdown
| Date       | Drill / incident   | Environment | Scenario(s) | Result | Elapsed vs target | What broke / surprised us                                  | Action item                             |
| ---------- | ------------------ | ----------- | ----------- | ------ | ----------------- | ---------------------------------------------------------- | --------------------------------------- |
| 2026-11-20 | quarterly DR drill | staging     | db-restore  | PASS   | 42 min / 4 h      | scratch DB name collided with a leftover `--keep` database | drop leftover scratch DBs before drills |
```

Rules for the log:

- Record **elapsed time per scenario**, not just pass/fail — RTO drift is the
  signal that matters.
- Every FAIL or surprise gets an action item with an owner and a due date; a
  drill that finds nothing new is still worth logging (it proves the RTO).
- Rehearse the failure path too: `DRILL_DEMO_FAIL=<id> node scripts/drills/drill.mjs --demo`
  exercises the runner's reporting; on staging, deliberately restore an old
  artifact once a year to prove the _oldest retained_ backup still works.
