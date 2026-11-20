# Canary deployments

Canary rollout tooling lives in `scripts/deploy/canary/`. It is design +
tooling only: nothing here provisions infrastructure. The scripts drive
whatever deploy/traffic mechanism the environment already has through
operator-supplied shell commands, so they work against the Hetzner origin
stack (`infra/origin/compose.yaml`), a future `app-canary` compose service,
or an edge router such as Cloudflare Load Balancing — without assuming any
of them.

## Commands

All commands are TypeScript entrypoints run with `tsx` and accept `--dry-run`,
which prints the full plan and performs **no** docker or network calls:

```bash
tsx scripts/deploy/canary/deploy.ts    --dry-run --image ghcr.io/spindle/app:abc123
tsx scripts/deploy/canary/promote.ts   --dry-run
tsx scripts/deploy/canary/rollback.ts  --dry-run
tsx scripts/deploy/canary/status.ts    --dry-run
```

Shared flags: `--image <ref>`, `--weights <csv>`, `--stage-seconds <n>`
override the corresponding env vars for one invocation.

| Script        | Purpose                                                                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `deploy.ts`   | Deploy the candidate to the canary slot, step traffic through the weight ladder, run smoke + metric gates per stage, auto-rollback on failure |
| `promote.ts`  | Cut over: run `PROMOTE_CMD` or shift `{weight}` to 100, then re-run the smoke gate                                                            |
| `rollback.ts` | Drain the canary: run `ROLLBACK_CMD` or shift `{weight}` to 0                                                                                 |
| `status.ts`   | Print the resolved configuration and run `STATUS_CMD` if configured                                                                           |

## Configuration

Everything is `SPINDLE_CANARY_*` environment (or the flags above). There are
no secrets in this surface — the canary inherits the app's normal Infisical
secret path at container start, like the stable service.

| Variable                           | Default | Meaning                                                                                                                                                                                                     |
| ---------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SPINDLE_CANARY_IMAGE`             | —       | Candidate image ref; required by `deploy` (or `--image`)                                                                                                                                                    |
| `SPINDLE_CANARY_WEIGHTS`           | `5,25`  | Ordered traffic percentages to step through                                                                                                                                                                 |
| `SPINDLE_CANARY_STAGE_SECONDS`     | `300`   | Observation window per stage                                                                                                                                                                                |
| `SPINDLE_CANARY_ROUTER_CMD`        | —       | Command template containing `{weight}` that shifts traffic (e.g. `caddy reload` against a weighted `reverse_proxy`, a `cloudflared`/LB API call, a `consul`/`fabio` tag update)                             |
| `SPINDLE_CANARY_DEPLOY_CMD`        | —       | Deploys/updates the canary workload; `{image}` is substituted. Example: `docker compose --env-file /srv/spindle/host.env -f infra/origin/compose.yaml up -d --no-deps canary` with the image exported first |
| `SPINDLE_CANARY_PROMOTE_CMD`       | —       | Full cutover command; when unset, promote uses `ROUTER_CMD` at weight 100                                                                                                                                   |
| `SPINDLE_CANARY_ROLLBACK_CMD`      | —       | Rollback command; when unset, rollback uses `ROUTER_CMD` at weight 0. `deploy` also runs this path automatically on gate failure                                                                            |
| `SPINDLE_CANARY_STATUS_CMD`        | —       | Probe whose stdout `status` prints                                                                                                                                                                          |
| `SPINDLE_CANARY_SMOKE_URL`         | —       | HTTP endpoint that must return 2xx                                                                                                                                                                          |
| `SPINDLE_CANARY_SMOKE_ATTEMPTS`    | `10`    | Smoke poll attempts per stage                                                                                                                                                                               |
| `SPINDLE_CANARY_SMOKE_INTERVAL_MS` | `5000`  | Delay between smoke attempts                                                                                                                                                                                |
| `SPINDLE_CANARY_SMOKE_TIMEOUT_MS`  | `10000` | Per-request timeout                                                                                                                                                                                         |
| `SPINDLE_CANARY_METRICS_URL`       | —       | JSON endpoint returning a metrics window (see below)                                                                                                                                                        |
| `SPINDLE_CANARY_REQUIRE_METRICS`   | `0`     | `1` makes a missing metrics source fail the gate instead of skipping it                                                                                                                                     |
| `SPINDLE_CANARY_MAX_ERROR_RATE`    | `0.01`  | Max error fraction (1%) allowed per stage                                                                                                                                                                   |
| `SPINDLE_CANARY_MAX_P95_MS`        | `800`   | Max p95 latency (ms) allowed per stage                                                                                                                                                                      |
| `SPINDLE_CANARY_MIN_REQUESTS`      | `100`   | Minimum requests in a window before the canary can be judged                                                                                                                                                |
| `SPINDLE_CANARY_METRICS_POLL_MS`   | `30000` | Resample cadence while a stage window is open                                                                                                                                                               |

If `ROUTER_CMD` is unset the canary is deployed but receives no production
traffic — useful for pre-prod validation only; the gates still run against
`SMOKE_URL`/`METRICS_URL`.

## Metric gates

Each weight stage is observed for `STAGE_SECONDS`, then evaluated once (with
resampling every `METRICS_POLL_MS` until the window closes). A stage passes
only when **all** of these hold for the observed window:

- `requests >= SPINDLE_CANARY_MIN_REQUESTS` — too little traffic cannot prove
  health, so silence fails rather than passes.
- `errorRate <= SPINDLE_CANARY_MAX_ERROR_RATE`
- `p95LatencyMs <= SPINDLE_CANARY_MAX_P95_MS`

`SPINDLE_CANARY_METRICS_URL` must return JSON shaped like:

```json
{ "requests": 412, "errorRate": 0.004, "p95LatencyMs": 231 }
```

`windowSeconds` is added by the client. Point this at whatever exposes the
canary's error rate and latency percentiles — a metrics-gateway query, a
sidecar, or a small adapter over Prometheus. Until that exists,
`HttpMetricsSource` in `lib/metrics.ts` is the only collector and an unset
URL yields `NullMetricsSource`, which reports an empty window and **skips**
the gate (unless `REQUIRE_METRICS=1`). The `MetricsSource` interface is the
extension point for a real collector (e.g. PromQL) without touching rollout
logic.

## Failure behavior

`deploy.ts` wraps each stage; on the first gate failure it prints the reason,
shifts traffic to 0% via `ROLLBACK_CMD`/`ROUTER_CMD {weight}=0`, and exits 1.
The canary workload itself is left running for inspection — tear it down with
the same `DEPLOY_CMD` machinery pointed at the stable service or a compose
`down`/`rm` of the canary service.

## Example: compose-backed canary

```bash
export SPINDLE_CANARY_IMAGE=ghcr.io/spindle/app:$(git rev-parse --short HEAD)
export SPINDLE_CANARY_WEIGHTS=5,25,50
export SPINDLE_CANARY_STAGE_SECONDS=600
export SPINDLE_CANARY_DEPLOY_CMD='SPINDLE_APP_IMAGE=$SPINDLE_CANARY_IMAGE docker compose --env-file /srv/spindle/host.env -f infra/origin/compose.yaml up -d --no-deps canary'
export SPINDLE_CANARY_ROUTER_CMD='curl -fsS -X POST http://127.0.0.1:9145/upstreams/canary -d "weight={weight}"'
export SPINDLE_CANARY_SMOKE_URL=https://app.spindle.app/api/health

tsx scripts/deploy/canary/deploy.ts          # rollout
tsx scripts/deploy/canary/promote.ts         # cut over once satisfied
tsx scripts/deploy/canary/rollback.ts        # or drain at any time
```

The `canary` compose service, the `/upstreams/canary` router endpoint, and
the metrics endpoint are environment-specific and intentionally not checked
in — wire them per environment following `docs/runbooks/hosting.md`.
