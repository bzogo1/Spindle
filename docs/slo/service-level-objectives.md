# Service-level objectives

SLOs for the Spindle services, derived from the performance budgets already
enforced in the repo. Measurement is offline-capable via
[`scripts/slo/report.mjs`](../../scripts/slo/report.mjs); see
[README.md](./README.md) for the index and
[burn-rate-alerting.md](./burn-rate-alerting.md) for the alert rules.

## Where the targets come from

| Source                                      | What it already enforces                                                                                 | Feeds this doc                                     |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `lighthouserc.json`                         | LCP ≤ 2500 ms, CLS ≤ 0.10, TBT ≤ 200 ms (lab, desktop preset, median of 3)                               | Field-vitals SLOs (LCP/CLS/INP)                    |
| `scripts/perf/benchmarks/budgets.json`      | `ttfbMs` 800, `fcpMs` 1800, `lcpMs` 2500, `tbtMs` 200, `cls` 0.1, `inpMs` 200; bundle `maxJsKb` ceilings | Server-latency SLOs, vitals SLOs                   |
| `scripts/perf/load.mjs`                     | Per-request `ok`/`ms` samples from live or demo traffic                                                  | Availability + latency SLIs                        |
| `compose.yaml`, `infra/origin/compose.yaml` | `pg_isready`, `valkey-cli ping`, app `fetch('/')` healthchecks                                           | Dependency availability SLIs                       |
| `src/lib/web-vitals/`                       | Consent-gated LCP/CLS/INP/FCP/TTFB collection (JSONL/beacon sinks)                                       | Field-vitals SLIs once `/api/vitals` ingest exists |

## Services and SLIs

### `web-app` — Next.js pages and marketing routes

| SLI          | Definition ("good" event)                                               | SLO target                                                           | Window      |
| ------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------- |
| Availability | Requests whose status is in the scenario's `expect` set (default 200)   | **99.90%**                                                           | 28d rolling |
| Latency      | Requests completing in ≤ 800 ms (the `ttfbMs` budget in `budgets.json`) | ≥ 95% of requests under budget; observed p95 ≤ 800 ms, p99 ≤ 2000 ms | 28d rolling |

Error budget: **0.10%** of requests may fail over 28 days (~43 min of full
downtime, or ~1 error per 1000 requests sustained).

### `api` — `/api/*` route handlers

| SLI          | Definition                                                                                 | SLO target         | Window      |
| ------------ | ------------------------------------------------------------------------------------------ | ------------------ | ----------- |
| Availability | Same `expect`-based definition; scenarios list every legitimate status (e.g. `[200, 401]`) | **99.95%**         | 28d rolling |
| Latency      | ≤ 400 ms per request; p99 ≤ 1000 ms                                                        | ≥ 95% under budget | 28d rolling |

Error budget: **0.05%**. The API is held to a tighter target because clients
and the `/api/health` canary depend on it; its latency budgets are half the
web-app's because JSON responses should not pay SSR cost.

### `postgres` — PostgreSQL dependency

| SLI          | Definition                                                                       | SLO target | Window      |
| ------------ | -------------------------------------------------------------------------------- | ---------- | ----------- |
| Availability | Health-check samples (`pg_isready`, or `{ok, ms}` JSONL from a probe) succeeding | **99.90%** | 28d rolling |

No latency SLI — `pg_isready` RTT is dominated by the probe, not the query
path. Query-level latency is covered by `scripts/db/monitoring/check.mjs`
(`long-running-queries` rule), which is an alert, not an SLO.

### Field vitals (informational, not yet wired)

`src/lib/web-vitals/` can emit LCP/CLS/INP/FCP/TTFB once an `/api/vitals`
ingest route exists (see `docs/performance/core-web-vitals.md`). When it
does, these become SLIs with the CWV "good" thresholds already encoded in
`rateVitalsMetric()`:

- LCP ≤ 2500 ms for ≥ 75% of page loads (matches `lighthouserc.json`)
- CLS ≤ 0.10 for ≥ 75% of page loads
- INP ≤ 200 ms for ≥ 75% of interactions

Until field data flows, the Lighthouse CI budgets remain the lab proxy and
these rows stay documentation-only.

## Composing healthchecks into availability

Availability is measured from **successful responses over total responses**,
so the healthcheck surface defines what "up" means:

- **App liveness**: `infra/origin/compose.yaml` healthchecks `GET /` inside
  the container every 15 s. A container that fails this is removed from
  rotation — those failures never reach load-test samples, so pair compose
  healthchecks with external probes (`load.mjs` scenarios hitting
  `/`, `/pricing`, `/api/auth/session`, `/api/health`) to catch
  "container healthy but app broken" cases.
- **API**: `/api/health` is referenced by the canary smoke URL
  (`docs/deploy/canary.md`) and by `src/lib/db.ts`'s health helper, but the
  route itself is not yet implemented — add `src/app/api/health/route.ts`
  returning `{ ok: true }` (200) or `{ ok: false }` (503) before relying on
  it as an SLI source.
- **Postgres**: `pg_isready` every 5 s in both compose files; translate probe
  results to JSONL samples (`{"ts":..., "service":"postgres", "ok":true,
"ms":4}`) for `report.mjs`.
- **Valkey** (origin compose): `valkey-cli ping` — treat as part of `api`
  availability when the API depends on it, or give it its own SLO row later.

Rule of thumb: a dependency outage should burn the **dependent service's**
budget (users experience API failure), while the dependency keeps its own
availability SLO measured by its healthcheck.

## Measuring

```bash
# Synthetic offline demo (deterministic; intentionally includes an api breach)
node scripts/slo/report.mjs --demo

# From a scheduled load test
node scripts/perf/load.mjs --config scripts/perf/scenarios/mixed-traffic.json \
  --out reports/load-$(date +%F).json
node scripts/slo/report.mjs --input reports/load-$(date +%F).json --window day,28d

# From JSONL probes / health-check logs (repeatable --input)
node scripts/slo/report.mjs --input probes/2026-11-20.jsonl --window 28d --json
```

Exit codes: `0` report ok (warnings allowed), `1` an SLO breached in a
reported window, `2` usage/IO error. See
[`scripts/slo/report.mjs`](../../scripts/slo/report.mjs) header for the
accepted sample schema.

## Budget policy

- **< 20% budget remaining** → `warning`: freeze non-critical deploys,
  investigate in the next business day.
- **Budget exhausted / SLI < target** → `breach`: page per
  [burn-rate-alerting.md](./burn-rate-alerting.md); do not ship until
  attainment recovers or the SLO is formally revised.
- SLO revisions require updating this doc, `report.mjs`'s `SLOS` catalog,
  and the burn-rate rules together — they are one contract.
