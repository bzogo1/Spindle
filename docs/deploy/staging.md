# Staging deploy pipeline

`.github/workflows/deploy-staging.yml` deploys every push to `main` to the
staging origin described in ADR 0001 §5.3 and `docs/runbooks/hosting.md`.
Staging is the rehearsal host: production promotion stays a separate, manual
step (DEV-10).

## Pipeline stages

| Job         | What it does                                                                              | Needs secrets? |
| ----------- | ----------------------------------------------------------------------------------------- | -------------- |
| `preflight` | Runs `scripts/deploy/validate-config.mjs`, installs dependencies, lints `scripts/deploy`. | No             |
| `deploy`    | SSHes to the staging host and rolls the compose stack.                                    | Yes            |
| `smoke`     | Runs `scripts/deploy/smoke-test.mjs` against the public `STAGING_URL`.                    | No             |

The jobs are chained with `needs:`: a failed preflight blocks the deploy, and a
failed smoke test fails the run after the new containers are already live.
`timeout-minutes` bounds every job.

### Preflight

`node scripts/deploy/validate-config.mjs` is dependency-free (plain Node 22+,
repo files only). It verifies:

1. Every file the deploy job uploads exists (`compose.yaml`, the cloudflared
   ingress, `host.env.example`, `remote-deploy.sh`, `smoke-test.mjs`).
2. Every `${VAR:?}` required by `infra/origin/compose.yaml` is documented in
   `infra/staging/host.env.example`.
3. Every GitHub secret/variable the workflow consumes is wired
   (`secrets.STAGING_*` / `vars.STAGING_*` patterns).
4. The smoke-test default paths resolve to real App Router routes.

It also checks that `docs/deploy/README.md` documents each consumed
secret/variable when that file exists; the check is skipped with a note when it
does not.

### Deploy

The deploy job uploads three things to the host under `STAGING_ROOT`
(`/srv/spindle-staging` by default):

- `infra/origin/compose.yaml` → `${STAGING_ROOT}/compose.yaml`
- `infra/staging/cloudflared/config.yml` → `${STAGING_ROOT}/cloudflared/config.yml`
- `scripts/deploy/remote-deploy.sh` → `${STAGING_ROOT}/deploy/remote-deploy.sh`

It then invokes `remote-deploy.sh <app-image> <worker-image> <stack-root>` over
SSH. The script runs on the host, never reads `host.env` contents itself, and:

1. Fails fast if `compose.yaml` or `host.env` is missing.
2. Runs `docker compose --env-file host.env config --quiet` so interpolation
   errors surface before anything is pulled.
3. Exports `SPINDLE_APP_IMAGE` / `SPINDLE_WORKER_IMAGE` and runs
   `docker compose pull` + `up -d --remove-orphans --wait` + `ps`.

Image references are `${STAGING_APP_IMAGE}:${IMAGE_TAG}` and
`${STAGING_WORKER_IMAGE}:${IMAGE_TAG}` where `IMAGE_TAG` is the pushed commit
SHA (`github.sha`). The workflow does not build images; it expects the commit's
images to exist from the image pipeline (DEV-9).

### Smoke test

`scripts/deploy/smoke-test.mjs` probes the public endpoints of the deployed
app with retries (default: 12 attempts, 5 s apart, 10 s timeout per request).
Default checks:

```
/                          -> 200
/changelog                 -> 200
/infrastructure            -> 200
/api/auth/session          -> 200
```

Configure with environment variables:

| Variable                   | Default                                          | Meaning                                |
| -------------------------- | ------------------------------------------------ | -------------------------------------- |
| `SPINDLE_SMOKE_BASE_URL`   | required                                         | Base URL of the deployed app           |
| `SPINDLE_SMOKE_PATHS`      | `/,/changelog,/infrastructure,/api/auth/session` | Comma-separated `path[=status]` checks |
| `SPINDLE_SMOKE_RETRIES`    | `12`                                             | Attempts per path                      |
| `SPINDLE_SMOKE_DELAY_MS`   | `5000`                                           | Delay between attempts                 |
| `SPINDLE_SMOKE_TIMEOUT_MS` | `10000`                                          | Per-request timeout                    |

The script is dependency-free (Node 22+, `fetch` + `AbortController`) and runs
on the GitHub runner, not the host.

## GitHub environment: `staging`

Configure once under Settings → Environments → `staging`:

| Kind     | Name                   | Value                                               |
| -------- | ---------------------- | --------------------------------------------------- |
| Secret   | `STAGING_HOST`         | Staging host name or address                        |
| Secret   | `STAGING_USER`         | Deploy user with Docker access                      |
| Secret   | `STAGING_SSH_KEY`      | Private key for that user                           |
| Secret   | `STAGING_KNOWN_HOSTS`  | Pinned `known_hosts` line for the host              |
| Variable | `STAGING_APP_IMAGE`    | App image repository, without the tag               |
| Variable | `STAGING_WORKER_IMAGE` | Worker image repository, without the tag            |
| Variable | `STAGING_URL`          | Optional; defaults to `https://staging.spindle.app` |

See `docs/runbooks/hosting.md` §3 for the host-side bootstrap and §4 for the
spending caps that bound what a runaway deploy can cost.

## Rolling back

Image tags are immutable (ADR 0001), so redeploying a previous tag is safe. To
roll back staging:

1. Find the SHA of the last good deploy (the `Record deployed image` step
   summary lists `App image: <repo>:<sha>`).
2. Actions → Deploy staging → Run workflow → set `image_tag` to that SHA.
3. The workflow validates the tag against `^[A-Za-z0-9._-]+$`, uploads the
   current `compose.yaml` and `remote-deploy.sh`, pulls the old images, and
   runs the smoke suite against the result.

`concurrency.group: deploy-staging` with `cancel-in-progress: false` queues
runs rather than interleaving them, so a rollback cannot race an in-flight
deploy.

## Failure modes

- **Preflight fails** — repo-side wiring drift (missing file, undocumented
  compose variable, smoke path without a route). Nothing touched the host.
- **Deploy fails mid-run** — `remote-deploy.sh` uses `set -euo pipefail`; the
  compose stack may be partially updated. Inspect with
  `ssh $STAGING_USER@$STAGING_HOST "cd /srv/spindle-staging &&
docker compose --env-file host.env ps"`, then re-run the workflow or dispatch
  with the previous `image_tag`.
- **Smoke fails** — containers are up but a public route is unhealthy. The
  smoke job's log names the failing path and last HTTP status; check
  `docker compose logs app` on the host.
