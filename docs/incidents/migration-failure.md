# Playbook — migration failure / failed deploy schema change

`prisma migrate deploy` failed mid-run, a deploy was interrupted, or
`_prisma_migrations` contains a row with `finished_at IS NULL`. Every later
deploy refuses to run until it is resolved.

## Severity

**SEV1** if the failed migration left the schema inconsistent and the app is
erroring or writes are failing. **SEV2** if the deploy pipeline stopped but the
running app is healthy on the old schema.

## Detection signals

- `failed-migrations` rule in `scripts/db/monitoring/rules.json` — any row with
  `finished_at IS NULL` is critical; routed `db-monitor` → `db-critical`
  (`docs/alerts/routing.json`).
- `node scripts/db/migrate.mjs --ci` output ending in
  `[migrate] finished with <n> failure(s)` or `migration(s) never finished`
  (`docs/runbooks/database-migrations.md` §"Failure playbook").
- Deploy notifier `failed` event (`scripts/deploy/notify.ts`) coinciding with a
  release.
- Drift between `_prisma_migrations` and `prisma/migrations/` directories.

## Immediate steps

1. **Inspect the failed migration** (read-only):

   ```sql
   SELECT migration_name, started_at, finished_at, rolled_back_at, logs
   FROM _prisma_migrations WHERE finished_at IS NULL;
   ```

2. **Check what state the schema is in.** `npx prisma migrate status` and the
   verification queries in `docs/runbooks/database-migrations.md` stage 4 —
   expected tables missing means a partially applied migration.

3. **Resolve per `docs/runbooks/migration-rollback.md` §"Failed migrations
   (mid-deploy)"**:

   - Fix the underlying problem (bad SQL, missing extension, lock timeout,
     permissions).
   - If the failed migration partially applied, run its `rollback.sql`/`down.sql`
     if the migration ships one:
     `npx prisma db execute --file prisma/migrations/<name>/rollback.sql`,
     or repair by hand.
   - Record resolution: `npx prisma migrate resolve --applied <name>` if the
     effects are in place, or `--rolled-back <name>` if fully reverted.
   - **Never hand-edit `_prisma_migrations` to hide the row** — reconcile via
     `migrate resolve`, a new migration, or a restore
     (`docs/runbooks/database-monitoring.md` §"failed-migrations").

4. **Decide app rollback vs. fix-forward.** If the new code requires the new
   schema and can't run on the old one, roll the app back **and** resolve the
   migration so the DB matches the running release — schema and code must
   agree (`docs/runbooks/migration-rollback.md` §"Safety checklist"):

   ```bash
   DEPLOY_HOST=<user@host> DEPLOY_DIR=/srv/spindle \
   DEPLOY_PUBLIC_URL=https://app.spindle.app \
   node scripts/deploy/rollback.mjs
   ```

   If the migration is easily reversible and time permits, prefer a
   compensating migration — `docs/runbooks/migration-rollback.md` §"Option A".
   For scripted reversals: `npx tsx scripts/db/rollback/rollback.ts --dry-run`
   first, then without `--dry-run` (add `--yes` non-interactively only after
   reviewing the plan).

5. **Re-run the pipeline.** `node scripts/db/migrate.mjs --ci` — it takes a
   fresh `pg_dump` into `backups/` before `migrate deploy` and verifies after
   (`docs/runbooks/database-migrations.md`). If `pg_dump` itself fails, the
   pipeline aborts before touching the schema — fix the backup path first.

6. **Verify.** `node scripts/db/monitoring/check.mjs --only failed-migrations`
   returns `ok`; `npx prisma migrate status` clean; smoke-test the app.

## Comms template

```text
[SEV2] Migration failure during deploy <sha> — _prisma_migrations has an
unfinished row (<migration_name>). App <still healthy on old release |
erroring>. Mitigating via <resolve|rollback|restore>. IC: <name>.
```

Escalate to SEV1 and page L3 immediately if data loss is possible — restoring
the pre-migration dump may be required (`docs/runbooks/database-backup.md`
artifact naming; `docs/runbooks/database-restore-test.md` to prove it first).

## Postmortem checklist

- [ ] Which migration failed and why (SQL error, lock timeout, permissions).
- [ ] Was a pre-migration backup taken by `migrate.mjs`? Did anyone verify it
      restores (`restore-test.mjs`)?
- [ ] Time from failure → detection → resolution vs. deploy pipeline SLA.
- [ ] Did the failed-migrations monitor rule fire before or after users noticed?
- [ ] Action items: add `rollback.sql` to irreversible-risk migrations, tighten
      deploy gating, expand/contract review for the offending change.
