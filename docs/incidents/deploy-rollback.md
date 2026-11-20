# Playbook — deploy rollback needed

A release is bad: the deploy failed, health checks are failing, errors spiked
in Sentry after a deploy, or users are reporting breakage that started with a
release. Roll back to the previous recorded release.

## Severity

**SEV2** for a failed deploy or degraded release where the previous release
restores service. **SEV1** if the bad release caused data corruption or the
rollback itself fails — escalate immediately and involve L3
(`docs/oncall/escalation-policy.md`).

## Detection signals

- `scripts/deploy/notify.ts` `failed` or `rolled-back` event → routed
  `deploy` source → `deploy-critical` policy
  (`docs/alerts/routing.json`, `docs/alerts/policies.json`).
- Deploy pipeline failure: `.github/workflows/deploy-staging.yml` fetches
  `https://staging.spindle.app/` after `docker compose up -d --wait` and fails
  the run if it doesn't answer.
- Sentry error spike tied to a release — `src/sentry.server.config.ts` sets
  `release` from `SENTRY_RELEASE`/`VERCEL_GIT_COMMIT_SHA`/`GITHUB_SHA`, so
  filter issues by release to confirm the deploy correlation.
- Smoke test failure: `scripts/deploy/smoke-test.mjs`; config validation:
  `scripts/deploy/validate-config.mjs`.
- `site-down.md` symptoms starting exactly at a deploy timestamp.

## Immediate steps

1. **Confirm it's the release.** Note the deploy time and release/commit;
   check Sentry issues filtered by that release; confirm
   `https://staging.spindle.app/` (or prod) health. Rule out infra causes
   first — if Postgres/tunnel/host is down, this is `database-down.md` or
   `site-down.md`, not a rollback problem.

2. **Check what releases exist on the host:**

   ```bash
   DEPLOY_HOST=<user@host> DEPLOY_DIR=/srv/spindle \
   node scripts/deploy/rollback.mjs --list
   ```

   Release files live in `<DEPLOY_DIR>/releases/` with a `current` symlink
   (`docs/runbooks/rollback.md` §1). If `--list` is empty, no release was ever
   recorded — run `--record` after the _next_ successful deploy; until then
   use the manual fallback (§5 below).

3. **Roll back** (defaults to the release before `current`):

   ```bash
   DEPLOY_HOST=<user@host> \
   DEPLOY_DIR=/srv/spindle \
   DEPLOY_PUBLIC_URL=https://app.spindle.app \
   node scripts/deploy/rollback.mjs
   ```

   or pin a target: `--to <release-id>` from `--list`. The script merges
   `host.env` + the release env, validates with `docker compose config
--quiet`, runs `up -d --remove-orphans --wait`, health-checks
   `DEPLOY_HEALTH_URL` (default `http://127.0.0.1:8080/`) on the host **and**
   `DEPLOY_PUBLIC_URL` through the tunnel, and auto re-deploys the prior
   release if post-up checks fail (`docs/runbooks/rollback.md` §3). RTO target
   ≤ 15 min (`docs/resilience/disaster-recovery.md`).

   For staging first when time allows: `DEPLOY_DIR=/srv/spindle-staging`,
   `DEPLOY_PUBLIC_URL=https://staging.spindle.app`.

4. **Watch for schema mismatch.** Rollback does **not** reverse migrations —
   the previous release must tolerate the current schema (expand/contract is
   the deploy contract, `docs/runbooks/rollback.md` §6). If the bad release
   shipped a destructive migration, you also need `migration-failure.md` /
   `docs/runbooks/migration-rollback.md` — app rollback alone won't fix the
   schema.

5. **Manual fallback** if the script can't run (no admin SSH, script bug) —
   `docs/runbooks/rollback.md` §5: merge `host.env` + `releases/<target>.env`
   into a temp env file, `docker compose --env-file /tmp/rollback.env up -d
--remove-orphans --wait`, repoint `releases/current`, curl the health URL,
   verify the public URL.

6. **Verify.** `curl -fsS https://app.spindle.app/`, Sentry error rate back to
   baseline for the restored release, one real user flow (sign in, load a
   project). Then `node scripts/deploy/rollback.mjs --record` is **not**
   needed — the script already repointed `current`; just confirm `--list`
   shows the rolled-back release as current.

7. **Notify** via `scripts/deploy/notify.ts --event rolled-back` if the
   pipeline didn't already (channels per `docs/deploy/notifications.md`).

## Comms template

```text
[SEV2] Rolling back release <bad-sha> → <target-release> on <env>.
Reason: <failed health check | error spike | user reports>. ETA <15 min>.
DB migrations: <none shipped | expand-only — safe | destructive — see
migration-rollback runbook>. IC: <name>.
```

## Postmortem checklist

- [ ] Root cause of the bad release (what check should have caught it —
      `smoke-test.mjs`, `validate-config.mjs`, staging gate?).
- [ ] Time from deploy → detection → rollback complete vs. 15 min RTO.
- [ ] Was a pre-rollback release recorded? If not, why (`--record` skipped)?
- [ ] Did the bad release ship migrations? Schema/code compatibility confirmed?
- [ ] Action items: tighten deploy gating, add the missing check to CI,
      consider canary/blue-green path (`scripts/deploy/canary/`,
      `scripts/deploy/blue-green/`, `docs/deploy/canary.md`,
      `docs/deploy/blue-green.md`).
