# Runbook — rolling back database migrations

This runbook covers reverting Prisma migrations after a deploy. The decision
context is in [`docs/decisions/0002-secrets-management.md`](../decisions/0002-secrets-management.md)
for secrets and the general deploy process; this file only covers the database
schema.

**Read this first:** Prisma does not ship "down" migrations. There is no
`prisma migrate rollback` command. Every rollback is one of:

1. **A compensating migration** — the preferred, reviewable path. You write a
   new migration that undoes the schema change, commit it, and deploy it like
   any other migration.
2. **A `rollback.sql` file next to the migration** — for migrations that ship
   their own reversal script. The script in
   `scripts/db/rollback/rollback.ts` executes these and marks the migration
   rolled back.
3. **A database restore** — the only safe option when the migration destroyed
   data or you do not know how to reverse it.

## Before you start

- You know which environment is affected: `staging` first, then `prod`.
- You have a fresh backup/snapshot of the database (see "Restore from backup"
  below). If there is no recent backup, **stop** and escalate.
- You know which migrations to revert. `npx prisma migrate status` lists
  applied vs. pending migrations.
- If the rollback is needed because a deploy is _in progress_ or a migration
  _failed_, resolve that first — see "Failed migrations" below.

## Inspecting the rollback plan (no database changes)

The rollback script never touches the database in `--dry-run` mode, so it is
safe to run anywhere — including a laptop without database access — to see
what a rollback would do:

```bash
# Plan the revert of the most recent migration.
npx tsx scripts/db/rollback/rollback.ts --dry-run

# Plan reverting the last 3 migrations.
npx tsx scripts/db/rollback/rollback.ts --count 3 --dry-run
```

The plan lists each target migration (newest first) with its applied status
(`applied`, `NOT applied`, or `unverified` when the database is unreachable)
and its action:

- `run prisma/migrations/<name>/rollback.sql` — a compensating SQL file exists;
  the script can execute it.
- `MANUAL — no rollback.sql/down.sql found` — you must write a compensating
  migration or restore from backup.
- `skip (not applied)` — the migration is pending; nothing to undo.

### Where rollback SQL lives

A migration directory may contain one optional file:

```
prisma/migrations/20261119190000_init/
  migration.sql      # applied by prisma migrate deploy
  rollback.sql       # optional; run by scripts/db/rollback/rollback.ts
```

`down.sql` is also accepted as a filename. Keep the file idempotent
(`IF EXISTS`, `IF NOT EXISTS`) so it can be re-run safely.

## Executing a scripted rollback

When every target migration has a `rollback.sql` (or `down.sql`), the script
can revert them automatically:

```bash
# Revert the last migration, after reviewing the dry-run plan.
npx tsx scripts/db/rollback/rollback.ts

# Non-interactive (CI / runbook automation) — only after a dry-run review.
npx tsx scripts/db/rollback/rollback.ts --count 2 --yes
```

For each migration the script:

1. Runs `npx prisma db execute --file <rollback.sql>` against the datasource
   configured in `prisma7.config.ts` (the direct `DIRECT_URL`).
2. Runs `npx prisma migrate resolve --rolled-back <name>` so the migration
   history table no longer counts it as applied.

If step 2 fails, remove the row manually and re-check status:

```sql
DELETE FROM "_prisma_migrations" WHERE migration_name = '<name>';
```

## Manual rollback (no rollback.sql)

When the plan shows `MANUAL`, pick one:

### Option A — compensating migration (preferred)

```bash
# Revert the Prisma schema to the pre-migration state first
# (git checkout the schema.prisma from before the deploy), then:
npx prisma migrate dev --name revert_<short_name>
```

Review the generated SQL — it should drop/undo exactly what the original
migration created — then deploy it:

```bash
npx prisma migrate deploy
```

Commit both the schema change and the new migration so history stays linear.
This is the only approach that is safe to review in a pull request.

### Option B — restore from backup

Use this when the migration dropped columns/tables with data, or when a
compensating migration cannot reconstruct lost data.

1. Stop the application (or put it in maintenance mode) so no writes land
   while you restore.
2. Restore the database from the backup taken **before** the migration ran.
3. Reconcile `_prisma_migrations`: rows for migrations applied after the
   backup point must be removed so `migrate deploy` re-applies them — or
   baseline them with `npx prisma migrate resolve --applied <name>` if you
   intend to keep the current schema.
4. Redeploy the previous application version if the schema and code no
   longer match.
5. Verify with `npx prisma migrate status` and smoke-test the app.

### Option C — hand-written rollback.sql

If the migration is simple and reversible, write the inverse SQL yourself:

```bash
$EDITOR prisma/migrations/<name>/rollback.sql
npx tsx scripts/db/rollback/rollback.ts --dry-run   # confirm the plan
npx tsx scripts/db/rollback/rollback.ts             # execute
```

## Failed migrations (mid-deploy)

If `migrate deploy` failed partway, the migration is marked failed in
`_prisma_migrations` and every later deploy will refuse to run until it is
resolved:

```bash
npx prisma migrate status
```

1. Fix the underlying problem (bad SQL, missing extension, permissions).
2. If the failed migration partially applied, run its `rollback.sql` (if any)
   via `npx prisma db execute --file ...`, or repair by hand.
3. Record the resolution:

   ```bash
   # Migration was fixed and its effects are in place:
   npx prisma migrate resolve --applied <name>
   # or, if you reverted it completely:
   npx prisma migrate resolve --rolled-back <name>
   ```

4. Re-run `npx prisma migrate deploy`.

## Safety checklist

- [ ] Backup taken (or restore path confirmed) before any destructive step.
- [ ] `--dry-run` plan reviewed; target list matches expectations.
- [ ] Migration order is newest-first; dependencies between reverted
      migrations are undone in reverse order.
- [ ] After rollback: `npx prisma migrate status` is clean, app smoke tests
      pass, and a new backup is taken.
- [ ] If code was deployed alongside the migration, the matching app version
      is running (schema and code must agree).
