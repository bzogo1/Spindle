# Chaos Engineering

Controlled failure injection for Spindle, run **only against local and
non-production environments**. The tooling lives in `scripts/chaos/` and is
dependency-free (Node.js stdlib only).

- `scripts/chaos/experiments.json` — experiment catalog (steady-state
  hypotheses, fault definitions, blast-radius expectations).
- `scripts/chaos/fault-proxy.mjs` — standalone fault-injection HTTP proxy
  (latency, jitter, error rate, upstream timeouts, URL match filters, live
  control endpoint).
- `scripts/chaos/run.mjs` — runner: executes each experiment in three phases
  (**baseline → chaos → recovery**), measures blast radius (error rate,
  latency percentiles), evaluates hypotheses, prints a report.

## Quick start

```bash
# Full offline pipeline against a built-in dummy server (no app/docker needed)
node scripts/chaos/run.mjs --demo

# Print the execution plan without running anything
node scripts/chaos/run.mjs --dry-run --demo
node scripts/chaos/run.mjs --dry-run --env local --target http://localhost:3000

# List the catalog
node scripts/chaos/run.mjs --list

# Run one experiment against a locally running app
node scripts/chaos/run.mjs --env local --experiment error-rate-injection-api \
  --target http://localhost:3000

# Run everything runnable in this environment
node scripts/chaos/run.mjs --all --env local --target http://localhost:3000
```

Useful flags: `--scale <f>` (multiply durations/sample counts), `--json`
(machine-readable report), `--chaos-duration <ms>`, `--probe <path>`,
`--interval <ms>`, `--allow-remote` (non-loopback targets — never prod).

Exit codes: `0` all passed/observational, `1` hypothesis failure,
`2` usage/config error, `3` safety refusal.

## How it works

Each experiment declares three hypothesis blocks evaluated against probe
metrics (`successRate`, `avgLatencyMs`, `p95LatencyMs`, `statuses`):

| Phase    | Fault state | Purpose                                     |
| -------- | ----------- | ------------------------------------------- |
| baseline | none        | prove steady state before touching anything |
| chaos    | applied     | measure blast radius inside expected bounds |
| recovery | removed     | verify the system returns to steady state   |

Supported hypothesis checks: `successRateMin`, `successRateMax`,
`avgLatencyMinMs`, `avgLatencyMaxMs`, `p95LatencyMinMs`, `p95LatencyMaxMs`,
`observedStatusesInclude`. A hypothesis containing only `note` is
**observational** — metrics are reported but nothing fails.

Fault adapters are selected by the experiment's `kind`:

| kind            | Mechanism                                                                                                                     |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `proxy`         | probes are routed through the in-process fault proxy; the fault is applied/cleared via its `POST /__chaos__` control endpoint |
| `compose-stop`  | `docker compose -f compose.yaml stop\|start <service>`                                                                        |
| `compose-pause` | `docker compose -f compose.yaml pause\|unpause <service>`                                                                     |
| `host-load`     | spawns CPU worker processes for the chaos duration                                                                            |
| `admin`         | `POST <target>/__admin/fault` (test-only fault hook)                                                                          |

Experiments that can't run (e.g. `compose-*` without docker) are reported as
`skipped`, never as failures.

## Experiment catalog

### `latency-injection-api` {#latency-injection-api}

800 ms (+0–200 ms jitter) added to every `/api/` request via the fault proxy.
Hypothesis: API stays up (`successRate ≥ 0.85`) but average latency inflates
(≥ 600 ms), and recovery is fast once the fault clears.

### `error-rate-injection-api` {#error-rate-injection-api}

50 % of `/api/` requests answered with 503 (+150 ms latency). Hypothesis:
observed success rate drops to ≤ 0.7, at least one 503 is seen, and recovery
returns to ≥ 0.95.

### `dependency-timeout-api` {#dependency-timeout-api}

Proxy answers 504 for any `/api/` request whose upstream takes > 400 ms.
Simulates a dependency that accepts connections but never responds — clients
must see bounded failures, not hangs. In `--demo` the dummy upstream is stalled
via its admin hook so the timeout actually fires.

### `db-down` {#db-down}

`docker compose stop postgres` → `docker compose start postgres`. Health probes
should degrade to a controlled failure (success ≤ 0.9 during chaos) and
recover cleanly. Requires docker compose; in `--demo` it is simulated with a
100 % error admin fault. Pair with `scripts/db/monitoring/check.mjs` alert
rules (`connection-pool-saturation`, `idle-in-transaction-sessions`) to watch
the DB side of the blast radius.

### `db-pause` {#db-pause}

`docker compose pause postgres` — SIGSTOP freeze rather than a dead
container. Verifies queries hit statement timeouts instead of hanging the
event loop. Observational chaos phase; recovery must return to ≥ 0.95.

### `cpu-saturation` {#cpu-saturation}

Spawns worker processes spinning on CPU for the chaos window
(`workers: 4` in the catalog). Observational: latency should inflate while the
app stays responsive. In `--demo` simulated as injected latency.

### `full-api-outage` {#full-api-outage}

100 % of `/api/` traffic answered 503 — worst-case blast radius. Verifies
non-API surfaces survive and clients degrade gracefully.

## Using the fault proxy directly

The proxy is also usable standalone, e.g. to fault an app's _outbound_
dependencies by pointing the app at it:

```bash
node scripts/chaos/fault-proxy.mjs \
  --target http://localhost:3000 --listen 4300 \
  --latency 800 --error-rate 0.2 --match /api/

# live control plane
curl http://127.0.0.1:4300/__chaos__                 # current fault + counters
curl -X POST http://127.0.0.1:4300/__chaos__ \
  -d '{"errorRate":0.8,"status":502}'                # update live
curl -X POST http://127.0.0.1:4300/__chaos__/reset   # clear counters
```

Point whatever you want to fault at `http://127.0.0.1:4300` (the app itself,
an upstream API base URL, a webhook target, …). Requests not matching
`--match` pass through untouched.

## Safety rails

- **Never run against production.** `run.mjs` refuses environments matching
  `prod|production` (exit 3) and refuses non-loopback/non-private targets
  unless `--allow-remote` is passed. There is intentionally no prod override.
- The default `--target` is `http://localhost:3000`; `--demo` ignores it
  entirely and uses an in-process dummy.
- Every experiment **reverts its fault in a `finally`-style path** — even on
  probe errors the adapter's `revert()` is attempted, and proxy/admin faults
  are cleared before the runner exits.
- Compose experiments only touch services declared in the repo's
  `compose.yaml` (`postgres`); they never `down` the stack.
- `host-load` workers are killed on revert; they are plain `node -e` spinner
  processes, easy to audit with `ps`.
- Dry-run (`--dry-run`) validates the catalog and prints the plan without
  binding ports or touching docker.

## Game-day procedure

1. **Prep (T-1 day)**
   - Pick the environment: local stack (`docker compose up -d` + `npm run
build && npm start`) or a staging slot. Never prod.
   - `node scripts/chaos/run.mjs --dry-run --all --env <env> --target <url>`
     and confirm the plan.
   - Have `scripts/db/monitoring/check.mjs` and Sentry/ dashboards open.
2. **Baseline check**
   - `node scripts/chaos/run.mjs --all --env <env> --target <url> --scale 0.5`
     for a fast rehearsal; expect all `passed`/`observational`.
3. **Run experiments one at a time**
   - Start with `latency-injection-api`, then `error-rate-injection-api`,
     `dependency-timeout-api`, `db-down`, `full-api-outage`; finish with the
     observational ones (`db-pause`, `cpu-saturation`).
   - Watch dashboards _during_ the chaos window — the runner's metrics are
     the probe-side view; your APM is the system-side view.
4. **Evaluate**
   - A `failed` result means reality diverged from the hypothesis — file an
     issue, do **not** just relax the threshold. Update
     `experiments.json` only when the new bound is the _agreed_ SLO.
   - Confirm every experiment reached `recovery: ok` before ending the
     game day; investigate any that didn't.
5. **Cleanup**
   - `docker compose ps` — all services `running`; no paused containers.
   - `pgrep -f "node -e"` — no leftover chaos workers.
   - `git status` — catalog/report changes are the only expected diffs.

## Adding an experiment

Append to `experiments.json`:

```json
{
  "id": "my-experiment",
  "title": "…",
  "kind": "proxy",
  "severity": "warning",
  "tags": ["local", "demo"],
  "fault": { "latencyMs": 300, "match": "/api/" },
  "probe": { "path": "/api/health", "method": "GET" },
  "hypothesis": {
    "baseline": { "successRateMin": 0.99 },
    "chaos": { "successRateMin": 0.9, "avgLatencyMinMs": 250 },
    "recovery": { "successRateMin": 0.95 }
  }
}
```

`tags` control which environments select the experiment by default (`demo`
for `--demo`, the `--env` name otherwise). New `kind`s require a new adapter
in `run.mjs` (`resolveAdapter`) — keep them loopback/docker-local only.
