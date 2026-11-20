# Runbook — deployment rollback

This runbook covers rolling back a bad deploy on the origin hosts from ADR 0001
(`infra/origin/compose.yaml`, deployed per `docs/runbooks/hosting.md`). The app
and worker run pinned image tags; a "release" is the pair of tags that was
running. Rollback re-runs `docker compose up` with the previous release's tags.
No database migrations are reversed — schema changes must stay backward
compatible (expand/contract), which is already the deploy contract.

The automation lives in `scripts/deploy/rollback.mjs`. It runs from an admin
machine (the same place `scripts/hosting/verify-topology.sh` is run from) and
drives the host over SSH. It never edits `host.env`; release env files are
merged over it for the duration of one `docker compose` invocation.

## 1. How releases are tracked

On the host, under the stack directory (`/srv/spindle` in production,
`/srv/spindle-staging` in staging), the script maintains:

```
<DEPLOY_DIR>/releases/
  <UTC-timestamp>.env    # one file per recorded release
  current -> <id>.env    # symlink to the active release
```

Each release file pins the images that were running:

```
SPINDLE_APP_IMAGE=registry.example.com/spindle-app:<sha>
SPINDLE_WORKER_IMAGE=registry.example.com/spindle-worker:<sha>
SPINDLE_RELEASE_ID=20250102T030405Z
SPINDLE_RELEASE_AT=2025-01-02T03:04:05Z
```

`--record` detects the running images from the compose container labels
(`com.docker.compose.project` / `com.docker.compose.service`), writes the file,
updates `current`, and prunes the store to the newest N releases
(`DEPLOY_KEEP_RELEASES`, default 5). The current release is never pruned.

## 2. Record a release after each deploy

The deploy workflow (`.github/workflows/deploy-staging.yml`) does not record
releases itself, so after a deploy completes — and after its smoke test passes —
run from an admin machine:

```bash
DEPLOY_HOST=deploy@<staging-host> \
DEPLOY_DIR=/srv/spindle-staging \
DEPLOY_PUBLIC_URL=https://staging.spindle.app \
node scripts/deploy/rollback.mjs --record
```

For production use the production host and `DEPLOY_DIR=/srv/spindle`. Until the
first `--record` runs there is nothing to roll back to; do it once after the
next deploy on each environment.

To see what is recorded:

```bash
DEPLOY_HOST=deploy@<host> DEPLOY_DIR=/srv/spindle-staging \
  node scripts/deploy/rollback.mjs --list
```

## 3. Roll back

Default behaviour rolls back to the release immediately before `current`:

```bash
DEPLOY_HOST=deploy@<host> \
DEPLOY_DIR=/srv/spindle-staging \
DEPLOY_PUBLIC_URL=https://staging.spindle.app \
node scripts/deploy/rollback.mjs
```

To pick a specific release (ids from `--list`):

```bash
node scripts/deploy/rollback.mjs --to 20250102T030405Z
```

What the script does, in order:

1. Reads `releases/` on the host and resolves the target release
   (previous of `current`, or `--to`).
2. On the host: merges `host.env` with `releases/<target>.env` into a temp
   file, validates with `docker compose config --quiet`, then runs
   `docker compose up -d --remove-orphans --wait` with the pinned tags.
3. Points `releases/current` at the target release.
4. Health check on the host: `curl --retry` against
   `DEPLOY_HEALTH_URL` (default `http://127.0.0.1:8080/`, the app's loopback
   port — the same surface the compose healthcheck uses).
5. If `DEPLOY_PUBLIC_URL` is set, the same check runs against the public URL
   from the admin machine (through Cloudflare Tunnel).
6. If any step after the compose-up fails, the script automatically re-deploys
   the release that was current before the attempt and exits non-zero.

## 4. Configuration

| Variable               | Default                  | Purpose                                                  |
| ---------------------- | ------------------------ | -------------------------------------------------------- |
| `DEPLOY_HOST`          | — (required)             | `user@host`; SSH keys/agent and `DEPLOY_SSH_OPTS` apply  |
| `DEPLOY_DIR`           | `/srv/spindle`           | Stack directory containing `host.env` and `compose.yaml` |
| `DEPLOY_HEALTH_URL`    | `http://127.0.0.1:8080/` | URL curled on the host after `up`                        |
| `DEPLOY_PUBLIC_URL`    | —                        | Public URL checked locally after the host check          |
| `DEPLOY_KEEP_RELEASES` | `5`                      | Release files retained on the host (`--keep` overrides)  |
| `DEPLOY_SSH_OPTS`      | —                        | Extra ssh options, e.g. `-i ~/.ssh/deploy_key`           |

`--dry-run` prints the plan and the exact `ssh`/`curl` commands without
contacting the host — use it to verify configuration before a real rollback:

```bash
DEPLOY_HOST=deploy@<host> node scripts/deploy/rollback.mjs --dry-run
```

## 5. Manual fallback

If the script cannot run (no admin SSH access, script bug), the same operation
is a few commands on the host:

```bash
cd /srv/spindle-staging
cat host.env releases/<target>.env > /tmp/rollback.env
docker compose --env-file /tmp/rollback.env up -d --remove-orphans --wait
ln -sfn <target>.env releases/current
curl -fsS --retry 12 --retry-delay 5 --retry-all-errors http://127.0.0.1:8080/
rm -f /tmp/rollback.env
```

Then verify `https://staging.spindle.app/` responds. If the health check fails
and there is no earlier release to fall back to, check `docker compose logs app
worker` on the host and escalate per the hosting runbook.

## 6. What rollback does not do

- It does not run migrations down. Prisma migrations are forward-only; a
  rollback assumes the previous release tolerates the current schema.
- It does not touch Postgres, Valkey, volumes, `host.env`, or the Cloudflare
  tunnel config.
- It does not redeploy session containers on `spindle-lab`; those are
  orchestrator-managed and unaffected by app/worker image tags.
