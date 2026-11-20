# Blue-green deployments

`scripts/deploy/blue-green/deploy.sh` ships a built artifact to one of two slots
(`blue`/`green`), health-checks the new slot **before** any traffic moves, flips a
`current` symlink plus any configured switch command, health-checks the public
endpoint, and **automatically reverts** when the post-switch check fails.

Everything is env-configured (`scripts/deploy/blue-green/deploy.env.example`)
and `--dry-run` prints every action without touching the host.

## Layout on the origin

```
/srv/spindle/releases/
  blue/            # slot directory, rsync --delete target
  green/           # slot directory
  current -> blue  # atomic symlink; the only thing that "switches"
```

- `SPINDLE_BG_ROOT` — slot root (default `/srv/spindle/releases`, next to
  `SPINDLE_ROOT=/srv/spindle` from `infra/origin/host.env.example`).
- `SPINDLE_BG_SOURCE_DIR` — the built artifact to ship (e.g. a Next.js
  standalone/static output, or a directory a slot compose project bind-mounts).
- `SPINDLE_BG_RELEASE_ID` — recorded in `<slot>/.release-id`; CI should pass the
  commit SHA.
- `SPINDLE_BG_HEALTH_URL_{BLUE,GREEN}` — per-slot URLs polled **before** the
  switch. The inactive slot must already be serving on its own address
  (loopback port or internal hostname).
- `SPINDLE_BG_HEALTH_URL` — public endpoint polled **after** the switch; its
  failure triggers the revert. Required for real runs.
- `SPINDLE_BG_{PRE_SWITCH,SWITCH,POST_SWITCH}_COMMAND` — optional `bash -c`
  hooks. `SWITCH` runs again during a revert, so keep hooks idempotent.

## Deploy sequence

1. Resolve active slot from `current` (first deploy assumes `blue`); target is
   the other slot, or `--slot` to force.
2. `rsync -a --delete` the artifact into the target slot; write `.release-id`.
3. `PRE_SWITCH_COMMAND`, then poll the target slot's health URL.
4. Atomically repoint `current` (`ln -sfn` + `mv -T`), then `SWITCH_COMMAND`.
5. Poll `SPINDLE_BG_HEALTH_URL`. On success: `POST_SWITCH_COMMAND`, done.
6. On failure: repoint `current` back, re-run `SWITCH_COMMAND`, re-check the
   endpoint, and exit non-zero either way.

## Mapping onto `infra/host` and `infra/origin`

The checked-in stack is Docker Compose (`infra/origin/compose.yaml`): the app is
a pinned image on the internal `spindle` network, reached only through two
`cloudflared` connectors (`infra/origin/cloudflared/config.yml` routes
`app.spindle.app` → `app:8080`). There is no public port and no nginx in front —
so "switch the symlink" alone does not steer traffic.

This complements the existing `scripts/deploy/` tooling rather than replacing
it: `remote-deploy.sh` ships the compose stack and `rollback.mjs` re-pins image
tags under a `releases/` + `current` model — that is a _rollback_ mechanism on a
single live slot. Blue-green keeps **two** fully provisioned slots and moves
traffic between them, which is what makes the pre-switch health check and the
automatic revert meaningful. Two supported mappings:

### A. Static/standalone artifact behind a per-slot web server (simplest)

Run one small web server (Caddy/nginx, or `serve-static.mjs`-style Node) per
slot on loopback ports, each rooted at its slot dir and resolving the app
through the `current` symlink or directly at its slot. Set
`SPINDLE_BG_HEALTH_URL_{BLUE,GREEN}` to the per-slot ports and
`SPINDLE_BG_HEALTH_URL` to `https://app.spindle.app/healthz` (or a health route
the app exposes). `SWITCH_COMMAND` is a no-op or a cache purge; the web tier
picks up the new `current` target on the next request or a graceful reload.

### B. Container images with an upstream flip (matches the compose stack)

Keep `infra/origin/compose.yaml` as the source of truth for the shared services
(Postgres, Valkey, socket proxy, connectors) and treat `app`/`worker` as the
swappable pair:

- `PRE_SWITCH_COMMAND`: `docker compose --env-file host.env -f compose.yaml -f
compose.slot-green.yaml up -d --wait app` — a slot override file that pins the
  new image tag and names the service `app-green`, attached to `spindle`.
- `SPINDLE_BG_HEALTH_URL_GREEN=http://app-green:8080/healthz` (reachable from
  the deploy host via `docker compose exec`/`docker run --network spindle`, or
  a loopback-published debug port — never a public port, per ADR 0001).
- `SWITCH_COMMAND`: rewrite the `service:` line in
  `cloudflared/config.yml` (`http://app:8080` → `http://app-green:8080`), then
  `docker compose exec cloudflared-1 cloudflared tunnel ingress` reload or
  restart both connectors. Alternatively put a tiny Caddy/lab-proxy upstream
  switcher in front and flip its admin API instead of touching tunnel config.
- `POST_SWITCH_COMMAND`: scale down the old slot service once the public check
  passes.

The worker has no ingress and can ride the same image-tag promotion without a
traffic switch; deploy it via `docker compose up -d worker` after the app
switch verifies.

Either way, the slot directories in `SPINDLE_BG_ROOT` can hold the per-slot
compose override/env files rather than rsync'd artifacts — point
`SPINDLE_BG_SOURCE_DIR` at a directory containing just those files, or keep the
rsync step as a no-op by syncing an empty marker directory.

## Operational notes

- The script never touches `host.env`, tunnel credentials, or named volumes;
  Postgres/Valkey state is shared and unaffected by the app switch.
- First deploy: create `blue/` and `green/` and point `current` at whichever
  slot already serves traffic before running, or let the script assume `blue`
  and verify with `--dry-run` first.
- Reverts restore the symlink and re-run `SWITCH_COMMAND`; if the revert health
  check also fails the script exits with a manual-intervention message — page
  whoever owns the host.
- Run from an admin path (Cloudflare Access/Tailscale SSH), as the `spindle`
  deploy user or root. `--dry-run` is safe anywhere.

```bash
# Preview
SPINDLE_BG_SOURCE_DIR=/srv/spindle/build/out \
SPINDLE_BG_HEALTH_URL=https://app.spindle.app/healthz \
./scripts/deploy/blue-green/deploy.sh --dry-run

# Deploy
SPINDLE_BG_SOURCE_DIR=/srv/spindle/build/out \
SPINDLE_BG_RELEASE_ID=$(git rev-parse --short HEAD) \
SPINDLE_BG_HEALTH_URL=https://app.spindle.app/healthz \
SPINDLE_BG_SWITCH_COMMAND='sudo systemctl reload caddy' \
./scripts/deploy/blue-green/deploy.sh
```
