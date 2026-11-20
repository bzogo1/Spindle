# Drift detection

`scripts/drift/detect.mjs` answers one question: **does the infrastructure we
declared still match the infrastructure that exists?** It is a dependency-free
Node script (no npm packages, no network calls) that can run on a developer
machine, in CI, or on the origin host itself.

```bash
node scripts/drift/detect.mjs            # human-readable report
node scripts/drift/detect.mjs --json     # machine-readable report
node scripts/drift/detect.mjs --demo     # synthetic fixture, one drift per layer
node scripts/drift/detect.mjs --ci       # exit 1 when any check fails
node scripts/drift/detect.mjs --update-manifest   # after an intentional infra change
```

## What "drift" means here

Drift is any divergence between **declared** state (checked into git) and
**observed** state (what is actually running or present). For this stack the
declared side is:

| Declared asset                                     | Observed side                                      |
| -------------------------------------------------- | -------------------------------------------------- |
| `infra/**`, `compose.yaml` (checksums)             | `scripts/drift/manifest.json`                      |
| `infra/origin/compose.yaml` services/networks      | running Docker containers/networks                 |
| `infra/*/cloudflared/config.yml` ingress           | hostnames documented in `docs/runbooks/hosting.md` |
| `infra/*/host.env.example` + `${VAR:?}` in compose | live `host.env` on the host                        |

Concrete examples of drift this catches:

- Someone edits `infra/origin/compose.yaml` on the host (or an old deploy
  left a different file there) — the checksum no longer matches the manifest.
- A compose service was removed from the file but its container still runs,
  or `docker compose up` partially failed and `worker` never started.
- The bootstrap-created `spindle`, `spindle-lab`, or `spindle-control`
  networks were deleted or recreated without `--internal`.
- A cloudflared ingress rule points at a hostname nobody documented (e.g. a
  hand-edited config exposing an extra route), or a documented hostname lost
  its route.
- `host.env` is missing `POSTGRES_PASSWORD`, still has `CLOUDFLARE_TUNNEL_ID`
  empty, or still carries `SET_BY_DEPLOY` placeholder image tags.

## Detection layers

1. **Checksums (`manifest`)** — every file under `infra/` plus the root
   `compose.yaml` is hashed (SHA-256) into `scripts/drift/manifest.json`.
   Changed or deleted files fail; files added since the last
   `--update-manifest` warn. Regenerate the manifest in the same commit as an
   intentional infra change.
2. **Compose vs Docker (`compose-containers`)** — service names and
   `external: true` networks parsed from the compose file are compared against
   `docker ps` (via the `com.docker.compose.service` label, with a
   `<project>-<service>-<n>` name fallback) and `docker network inspect`.
   Skipped gracefully when `docker` is absent — run it on the origin for full
   coverage.
3. **Tunnel ingress (`tunnel-ingress`)** — `hostname:` entries in the
   cloudflared configs are checked against the `*.spindle.app` hostnames
   documented in `docs/runbooks/hosting.md`. Configured-but-undocumented
   fails; documented-but-unrouted warns (staging may legitimately lag).
4. **Env contract (`env-contract`)** — variables required by `${VAR:?}` in
   compose plus every key in `host.env.example` must be present and non-empty
   in the live env file. Skipped when no env file exists at the checked path.

Checks report `pass`, `warn`, `fail`, or `skipped`. `--ci` exits 1 only on
`fail`; warnings and skips never fail the build. `--demo` runs all four
layers against a synthetic fixture containing one drift each and always
exits 0 — use it to verify the tool itself.

Useful flags: `--env-file` (default `/srv/spindle/host.env`, or
`DRIFT_ENV_FILE`), `--compose`, `--env-example`, `--tunnel-config` (repeatable),
`--docs`, `--manifest`, `--no-docker`.

## Remediation workflow

1. **Run the detector** on the host (or anywhere for the offline layers):

   ```bash
   sudo node /srv/spindle/scripts/drift/detect.mjs --ci
   ```

   On the origin, `host.env` lives at `/srv/spindle/host.env`; pass
   `--env-file` if it is elsewhere.

2. **Triage each finding:**

   - _Checksum changed/missing_ — diff the file against git. If the host copy
     drifted accidentally, redeploy from the repo (`git checkout` +
     `docker compose up -d`). If the repo change was intentional, run
     `--update-manifest` and commit `scripts/drift/manifest.json`.
   - _Service/network not observed_ — check `docker compose ps`,
     `docker compose logs <service>`, and `docker network ls`. A missing
     external network means bootstrap or manual `docker network` changes;
     recreate per `infra/host/bootstrap.sh`.
   - _Undocumented hostname_ — either remove the ingress rule or document the
     hostname in `docs/runbooks/hosting.md` (and create the tunnel DNS route).
   - _Missing/empty env var_ — fill in `/srv/spindle/host.env` per
     `infra/origin/host.env.example` and `docs/runbooks/hosting.md` §2, then
     `docker compose --env-file host.env up -d`.

3. **Re-run until clean.** Warnings (unrecorded new files, documented but
   unrouted staging hostnames, placeholder values) should be resolved in the
   same change but do not block CI.

4. **Record intentional changes** — any edit under `infra/` must be followed
   by `node scripts/drift/detect.mjs --update-manifest` so the manifest stays
   the source of truth for what _should_ be deployed.

## CI and cron suggestions

- **PR/CI (offline layers):** run `node scripts/drift/detect.mjs --ci` in the
  pipeline. Without Docker and `host.env` the container and env checks skip,
  but the manifest and tunnel checks still catch unreviewed infra edits —
  provided the manifest is regenerated in the same PR.
- **Origin cron (full coverage):** install a daily timer on each host:

  ```ini
  # /etc/systemd/system/spindle-drift.service
  [Service]
  Type=oneshot
  WorkingDirectory=/srv/spindle
  ExecStart=/usr/bin/node scripts/drift/detect.mjs --ci --json
  ```

  ```ini
  # /etc/systemd/system/spindle-drift.timer
  [Timer]
  OnCalendar=*-*-* 06:00:00
  Persistent=true
  [Install]
  WantedBy=timers.target
  ```

  Pipe the JSON into the existing alerting path (`scripts/alerts/escalate.mjs`
  accepts normalized alert events) or a log shipper so a non-zero exit or
  `fail` findings page on-call.

- **After deploys:** the deploy workflow already replaces
  `cloudflared/config.yml` and the compose file on the host; running the
  detector as a post-deploy step confirms the upload landed intact.
