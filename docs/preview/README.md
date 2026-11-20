# PR preview deployments

Every pull request gets a live preview of the app: the PR head is built on a
dedicated preview host and served with `next start` on a port allocated per PR
number. Closing the PR tears the preview down automatically.

- Workflow: `.github/workflows/preview.yml`
- Host-side helper: `scripts/preview/deploy.mjs`

## Architecture

```
GitHub runner                          Preview host (Linux, persistent)
─────────────────                      ──────────────────────────────────
pull_request opened/                   /srv/spindle-preview/
synchronize/reopened                        apps/pr-<N>/     full checkout + build
    │                                       state/           pr-<N>.json/.url/.log
    │  git archive HEAD ──scp/ssh──▶          env/            pr-<N>.env (0600)
    ▼                                       deploy runs:
  deploy.mjs deploy ──ssh──▶              npm ci → npm run build → next start
                                          (detached, survives the SSH session)
```

The runner never hosts the app itself: a `next start` process cannot outlive
the GitHub Actions job that spawned it, so all build/serve work happens on
`PREVIEW_HOST` over SSH. The workflow only packages the checkout
(`git archive HEAD` — tracked files only, so `node_modules`/`.next` are always
rebuilt on the host) and invokes the script remotely.

On the host, `deploy.mjs`:

1. Stops any previous preview still registered for the same PR (cancelled
   runs can leave one behind).
2. Allocates a port in `PREVIEW_PORT_BASE..+PREVIEW_PORT_RANGE` (default
   3100–3999), biased by an FNV-1a hash of the PR number, skipping ports
   already claimed in state or not bindable.
3. Installs dependencies (`npm ci`, or skips when `node_modules` matches the
   lockfile hash recorded in state).
4. Runs `npm run build` with `NEXT_PUBLIC_SITE_URL` set to the preview URL.
5. Spawns `next start -p <port> -H <bind host>` detached, waits for it to
   answer HTTP, then writes `state/pr-<N>.json` + `pr-<N>.url`.

`teardown` SIGTERMs the process group (then SIGKILLs after a grace period),
removes the state files, and deletes the app directory unless
`--keep-app-dir` is passed. `gc` tears down any preview older than
`--max-age-hours` (default 72) — the safety net for PRs closed without the
teardown job running. `status` lists registered previews and whether their
PID is alive.

All commands accept `--dry-run`, which validates arguments and prints the
plan without touching processes, files, or ports.

## Host prerequisites

The preview host is **not** provisioned by this repo — it is a persistent
machine (VM or dedicated box) with:

- Linux, Node.js 22+, npm on `PATH` for the SSH user.
- SSH access from GitHub Actions runners (dedicated key, not a personal one).
- ~2–4 GB RAM free per concurrent preview (each runs its own `next start`).
- Network reachability of the allocated port range from reviewers' browsers —
  either directly, or through a reverse proxy/tunnel terminated on the host.
- Enough disk for one checkout + `node_modules` + `.next` per open PR.

Suggested layout (matches the workflow defaults):

```
/srv/spindle-preview/
  apps/pr-<N>/     one self-contained checkout per PR
  state/           pr-<N>.json, pr-<N>.url, pr-<N>.log
  env/             pr-<N>.env build/serve environment (mode 0600)
```

## GitHub configuration

Repository **secrets**:

| Secret                | Purpose                                                               |
| --------------------- | --------------------------------------------------------------------- |
| `PREVIEW_HOST`        | Preview host IP/DNS name.                                             |
| `PREVIEW_USER`        | SSH user on the host.                                                 |
| `PREVIEW_SSH_KEY`     | Private key authorized on the host.                                   |
| `PREVIEW_KNOWN_HOSTS` | Pinned `known_hosts` entries (same pattern as `STAGING_KNOWN_HOSTS`). |
| `PREVIEW_ENV_FILE`    | Optional multi-line `KEY=VALUE` env file for build/serve (see below). |

Repository **variables**:

| Variable                    | Purpose                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `PREVIEW_PUBLIC_HOST`       | Hostname/IP placed into preview URLs (e.g. `preview-01.internal.example.com`).                               |
| `PREVIEW_SITE_URL_TEMPLATE` | Optional URL template; placeholders `{pr}` `{port}` `{host}` `{publicHost}`. Default `http://{host}:{port}`. |
| `PREVIEW_GC_MAX_AGE_HOURS`  | GC cutoff for the weekly sweep (default 72).                                                                 |

`PREVIEW_ENV_FILE` is the right place for build-time flags. To make the
`(app)` route group usable in previews (it requires the mock-auth build
flag), set:

```
NEXT_PUBLIC_MOCK_AUTH=1
```

without it, app routes will not authenticate. Layering order in the env file
the workflow writes: `PREVIEW_ENV_FILE` first, then `PREVIEW_PUBLIC_HOST` /
`PREVIEW_SITE_URL_TEMPLATE` — the workflow variables always win.

Host-side tuning is via environment on the remote command or inside
`PREVIEW_ENV_FILE`: `PREVIEW_PORT_BASE`, `PREVIEW_PORT_RANGE`,
`PREVIEW_BIND_HOST` (default `0.0.0.0`), `PREVIEW_PUBLIC_HOST`,
`PREVIEW_SITE_URL_TEMPLATE`, `GITHUB_SHA` (recorded into state).

## Workflow behaviour

`.github/workflows/preview.yml` has three jobs:

- **deploy** — `pull_request` `opened`/`synchronize`/`reopened` on
  same-repo branches only. Validates config, configures SSH (same pattern as
  `deploy-staging.yml`), archives the PR head, extracts it to
  `apps/pr-<N>/`, writes the env file, runs `deploy.mjs deploy`, and reports
  the URL in the job summary and a `::notice::`.
- **teardown** — `pull_request` `closed`. Copies `deploy.mjs` to the host
  and runs `teardown --pr <N>` so it works even if the app directory is
  already gone.
- **gc** — weekly schedule (and `workflow_dispatch`). Copies `deploy.mjs` to
  the host and runs `gc` against the shared state dir.

Concurrency is grouped per PR (`preview-pr-<N>`) with
`cancel-in-progress: true`: a new push cancels the stale deploy, and `closed`
cancels any in-flight deploy before teardown runs. `deploy.mjs` cleans up
after itself on the next deploy because it stops the previously recorded
PID first.

Permissions are `contents: read` only. The workflow does not comment on PRs
(that would need `pull-requests: write`); the URL is in the step summary.
Fork PRs are excluded from deploy/teardown because they get a read-only
token and no secrets — previews only work for branches in this repository.

## Manual operations on the host

```bash
# List previews and whether their server is alive
ssh <user>@<host> "node /srv/spindle-preview/apps/pr-123/scripts/preview/deploy.mjs \
  status --state-dir /srv/spindle-preview/state"

# Rebuild/redeploy a PR without a new push (e.g. after fixing the host)
ssh <user>@<host> "cd /srv/spindle-preview/apps/pr-123 && \
  node scripts/preview/deploy.mjs deploy --pr 123 \
    --app-dir /srv/spindle-preview/apps/pr-123 \
    --state-dir /srv/spindle-preview/state \
    --env-file /srv/spindle-preview/env/pr-123.env"

# Inspect a preview's server log
tail -f /srv/spindle-preview/state/pr-123.log

# Force-remove a stuck preview
node scripts/preview/deploy.mjs teardown --pr 123 \
  --state-dir /srv/spindle-preview/state \
  --app-dir /srv/spindle-preview/apps/pr-123
```

`--dry-run` on any command prints the plan without side effects.

## Security notes

- **Previews expose the app.** Anything reachable on `PREVIEW_PUBLIC_HOST`'s
  port range serves the PR's build to anyone who can connect. If the app
  routes are built with `NEXT_PUBLIC_MOCK_AUTH=1`, the mock session bypasses
  real authentication — treat preview URLs as public within whatever network
  boundary you put around the host. Recommended: keep the host on a private
  network/VPN (e.g. Tailscale), or front the port range with a reverse proxy
  that adds authentication. Do not expose previews on the public internet
  without an auth layer.
- **Do not put production secrets in `PREVIEW_ENV_FILE`.** The file is
  written world-readable-ish to the host (`0600`, but on shared infra) and
  its values are baked into the client bundle at build time for any
  `NEXT_PUBLIC_*` key. Use throwaway/dev credentials only.
- **Env file hygiene.** The workflow writes `env/pr-<N>.env` with mode
  `0600`; `teardown` removes the app dir but leaves the env file — remove it
  manually if a PR is sensitive, or extend teardown if that becomes a
  problem. Env files for closed PRs are overwritten on redeploy and are inert
  without the matching app dir.
- **SSH hygiene** mirrors `deploy-staging.yml`: dedicated key, pinned
  `known_hosts`, `0600` permissions, secrets validated before use.
- **Supply-chain.** The host runs `npm ci` against the PR's lockfile — a
  malicious PR could run install scripts. Run previews on an isolated host
  or VM, not a machine holding production credentials. `deploy.mjs` does not
  pass `--ignore-scripts`; if that is unacceptable, add it to the
  `npm ci`/`npm install` invocations.
- **Resource exhaustion.** Port allocation is bounded (`PREVIEW_PORT_RANGE`),
  but nothing caps concurrent previews per host beyond open PRs. `gc` plus
  per-PR teardown keeps this bounded in practice; monitor disk usage of
  `apps/` on the host.
