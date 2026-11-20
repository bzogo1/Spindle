# Playbook — site down (app / tunnel / host)

`app.spindle.app` or `lab.spindle.app` does not answer, or answers with errors
for all users.

## Severity

**SEV1** when both hostnames are unreachable or the app returns 5xx for all
users. **SEV2** when only `lab.spindle.app` (session containers) is down while
the app still serves.

## Detection signals

- User reports / uptime check on `https://app.spindle.app/` and
  `https://lab.spindle.app/` failing.
- Cloudflare notifications: "Tunnel unhealthy", 5xx rate alerts
  (`docs/runbooks/hosting.md` §4).
- On the host: `docker compose --env-file host.env ps` shows `app`, `worker`,
  `postgres`, `valkey`, `cloudflared` containers not healthy
  (`docs/runbooks/hosting.md` §2).
- Sentry: `src/instrumentation.ts` `onRequestError` spike; check
  `src/sentry.server.config.ts` (errors are never sampled, so a real outage
  shows up there).
- Deploy notifier: a `failed` event from `scripts/deploy/notify.ts` routed via
  `docs/alerts/routing.json` (`deploy` source → `deploy-critical` policy).

## Immediate steps

1. **Scope it.** From any machine:

   ```bash
   curl -fsS -o /dev/null -w '%{http_code}\n' https://app.spindle.app/
   curl -fsS -o /dev/null -w '%{http_code}\n' https://lab.spindle.app/
   ```

   Both failing → ingress or host. Only `lab.*` failing → lab proxy or session
   containers (see `docs/runbooks/hosting.md` §5 and
   `scripts/hosting/verify-topology.sh`).

2. **Check ingress.** On the host, `sudo docker compose --env-file host.env ps`
   — two `cloudflared` connector replicas run the tunnel; if both are down or
   the tunnel itself is unhealthy, ingress is dead even if the app is fine
   (`docs/runbooks/hosting.md` §2). Restart connectors:
   `sudo docker compose --env-file host.env up -d --wait`.

3. **Check the app container.** `sudo docker compose --env-file host.env logs
--tail 200 app` and `... worker`. Common causes: crash loop after a deploy
   (→ playbook `deploy-rollback.md`), failed secret injection at boot
   (`npm run secrets:check -- --production` inside the container env — see
   `docs/decisions/0002-secrets-management.md`), or OOM.

4. **Check dependencies.** If the app is up but errors, check Postgres and
   Valkey health in the same `ps` output → `database-down.md`.

5. **Rollback if a deploy caused it.** If the outage started with a deploy,
   go straight to `deploy-rollback.md`:

   ```bash
   DEPLOY_HOST=<user@host> DEPLOY_DIR=/srv/spindle \
   DEPLOY_PUBLIC_URL=https://app.spindle.app \
   node scripts/deploy/rollback.mjs --list
   ```

   then run without `--list`/`--dry-run` to roll back one release (RTO ≤ 15 min
   per `docs/resilience/disaster-recovery.md`).

6. **Host-level failure.** If the host itself is down (no SSH via
   Cloudflare Access/Tailscale, tunnel offline), this is the full-host-loss
   scenario in `docs/resilience/disaster-recovery.md`: rebuild from
   `infra/host/bootstrap.sh` + `infra/origin/compose.yaml`, restore the
   database per `docs/runbooks/database-restore-test.md`, and redeploy pinned
   images. RTO ≈ 2 h is the accepted beta target (ADR 0001 §6).

7. **Verify recovery.** `curl -fsS https://app.spindle.app/`, then run the
   topology proof for the lab path:

   ```bash
   sudo ./scripts/hosting/verify-topology.sh
   ```

   (tunnel leg needs `SPINDLE_LAB_URL` + `SPINDLE_SESSION_TOKEN` — see
   `docs/runbooks/hosting.md` §5.)

## Comms template

```text
[SEV1] Site down — app.spindle.app unreachable since <time UTC>.
Impact: all users cannot reach the app. Investigating ingress vs app vs host.
Next update in 15 min or on mitigation. IC: <name>. Thread: <link>.
```

Update cadence: every 15 min for SEV1 until mitigated; post "mitigated" and
"resolved" separately.

## Postmortem checklist

- [ ] Timeline: first failure signal → detection → mitigation → resolution.
- [ ] Which layer failed (edge/tunnel/app/db/host) and the evidence.
- [ ] Did `verify-topology.sh` / health checks catch it before users?
- [ ] Was a release recorded (`rollback.mjs --record`) so rollback was possible?
- [ ] Action items with owners: monitoring gap, runbook gap, capacity note.
- [ ] Append to the lessons-learned log format in
      `docs/resilience/disaster-recovery.md` §"Lessons-learned log format".
