# API usage analytics

Usage analytics answers a different question than
[`log-metrics.mjs`](../../scripts/metrics/log-metrics.mjs): not "is the API
healthy?" (rate, errors, latency → Prometheus/SLOs) but "who is using which
endpoints, how much, and where do they fail?" — per-endpoint request
counts, top consumers by `userId`/`projectId`, and status distribution.

Both tools read the same input: newline-delimited pino JSON lines containing
`event: "api.request"` summary records emitted by `withRequestLogging` in
`src/lib/request-logging.ts`. Only paths are logged — query strings never
reach the logger — so analytics are safe to run over shipped/aggregated logs.

## Tooling

| Piece            | Path                                                                               | Role                                                                                                               |
| ---------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| CLI report       | [`scripts/analytics/api/usage.mjs`](../../scripts/analytics/api/usage.mjs)         | Text/JSON/markdown usage report from `--demo`, `--file`, or `--stdin`.                                             |
| Pure aggregation | [`src/lib/api-analytics/usage.ts`](../../src/lib/api-analytics/usage.ts)           | `aggregateApiUsage(records, { requestEvent, topN })` — the same math, unit-tested, for embedding in other tooling. |
| Tests            | [`src/lib/api-analytics/usage.test.ts`](../../src/lib/api-analytics/usage.test.ts) | Vitest coverage of aggregation edge cases.                                                                         |

```bash
node scripts/analytics/api/usage.mjs --demo                      # synthetic fixture
node scripts/analytics/api/usage.mjs --file logs/app.jsonl       # rotated log file
kubectl logs deploy/spindle -c app | node scripts/analytics/api/usage.mjs --stdin
node scripts/analytics/api/usage.mjs --demo --format json,markdown --top 20
```

Formats: `text` (default), `json` (full report for `jq`/dashboards),
`markdown` (paste into tickets). `--request-event` retargets the summary
event if the log shape ever changes; `--top` sizes every top-N table.

## Metrics catalog

All metrics are computed over records where `event === "api.request"`
(other log lines — `db.query`, `worker.job`, noise — are ignored, though
non-JSON lines are counted and reported on stderr).

### Window & totals

| Field                                             | Meaning                                                                      |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| `window.first` / `window.last` / `window.seconds` | Min/max `time` across request records; `seconds` is the span used for rates. |
| `totals.requests`                                 | Count of `api.request` records.                                              |
| `totals.perSecond`                                | `requests / window.seconds` — average rate over the observed window.         |
| `totals.errors`                                   | Requests with `status >= 400`.                                               |
| `totals.errorRate`                                | `errors / requests` (0..1).                                                  |
| `totals.serverErrors` / `totals.clientErrors`     | Split of errors into 5xx vs 4xx.                                             |

### Latency

`latencyMs` (and per-endpoint `latency`) summarize `durationMs`:
`count, min, max, avg, p50, p90, p95, p99`. Percentiles use linear
interpolation between ranks (same method as `log-metrics.mjs`).
`durationMs` is rounded to 0.1 ms by the logger, so sub-millisecond
precision is not meaningful.

### Status distribution

`statusDistribution` maps raw status codes (`"200"`, `"404"`, `"500"`, …) to
counts. Status `0` appears when `status` is missing/non-numeric — treat it as
a logging bug, not traffic. For SLO-style error rates prefer
`log-metrics.mjs` Prometheus output (`spindle_request_errors_total{status=~"5.."}`);
usage.mjs is for the raw distribution.

### Endpoints

Grouped by `method + path` (statuses aggregated together — use
`log-metrics.mjs` for per-status series):

| Field                           | Meaning                                                      |
| ------------------------------- | ------------------------------------------------------------ |
| `count`                         | Requests to the endpoint.                                    |
| `errors` / `errorRate`          | `status >= 400` count and fraction.                          |
| `serverErrors` / `clientErrors` | 5xx vs 4xx split.                                            |
| `latency`                       | `DurationSummary` or `null` when no `durationMs` was logged. |

`endpoints` is sorted by count desc and truncated to `topN`;
`endpointCount` reports the untruncated total.

### Top consumers

`topUsers` / `topProjects` rank non-null `userId` / `projectId` values by
request count:

| Field                            | Meaning                                                 |
| -------------------------------- | ------------------------------------------------------- |
| `id`                             | The `userId` or `projectId` string.                     |
| `count` / `errors` / `errorRate` | Requests and failures attributed to the consumer.       |
| `share`                          | `count / total requests` (0..1) — concentration signal. |

Requests without a resolved id (`null` — unauthenticated, or handler never
called `setRequestLogContext`) are excluded from these tables. A high
`share` on one project is normal for single-tenant-ish workloads; a sudden
share shift is an anomaly (see below).

### Top error messages

`topErrorMessages` counts `error.message` on failed requests, falling back
to `msg` ("api request") when absent. Thrown handler errors carry
`error: { type, message }`; status >= 400 responses may carry neither, in
which case the generic `msg` is counted — noisy but honest.

## Dashboards tie-in

`usage.mjs` deliberately has **no Prometheus output** — it is an
analytical/reporting tool, not a scrape target. For dashboards:

- **Prometheus / Grafana**: run `scripts/metrics/log-metrics.mjs
--format prometheus` against the same log stream. It emits
  `spindle_requests_total{method,path,status}`, `spindle_request_errors_total`,
  `spindle_request_rate_per_second`, `spindle_request_duration_ms` histograms
  per route, plus config-driven counters/gauges from
  `scripts/metrics/log-metrics.config.json`. See
  [`docs/observability/log-based-metrics.md`](../observability/log-based-metrics.md)
  for the full metric list and alert-rule mapping.
- **Ad-hoc / ticket / weekly review**: `usage.mjs --format markdown` —
  consumer tables and status distribution don't exist in the Prometheus
  exposition (label cardinality), so they live here instead.
- **JSON pipelines**: `usage.mjs --format json | jq '.topProjects'` — the
  report is a single JSON document; `generatedAt` is the only
  nondeterministic field besides window times.

Suggested division of labor: Prometheus for continuous health dashboards and
alerting; `usage.mjs` for capacity planning, tenant/consumer reporting, and
post-incident "who was affected" analysis.

## Anomaly notes

Things worth flagging when reading a report:

- **Error-rate step change on one endpoint** while others stay flat usually
  means a deploy regression or a downstream dependency (DB, storage, search)
  failing for that route — cross-check `topErrorMessages` and 5xx vs 4xx
  split (5xx-dominated = server-side, 4xx-dominated = client/contract).
- **p95/p99 divergence**: a p95 near baseline with p99 spiking indicates a
  small set of slow requests (large uploads, cold paths, lock contention);
  p50 _and_ p95 both rising indicates systemic slowness.
- **Consumer concentration**: `share` >> average across many consumers, or a
  single project dominating one endpoint, can indicate a runaway client,
  scraper, or abuse — correlate with `429`/`403` counts before acting.
- **Anonymous share**: requests with null `userId`/`projectId` are invisible
  to the top-consumer tables. If authenticated traffic should dominate,
  a rising anonymous fraction means auth/session resolution is degrading
  (`setRequestLogContext` not being called, or session lookups failing).
- **Window skew**: percentiles and rates are computed over the parsed window
  only. Feeding a huge rotated file mixes traffic regimes; slice per cron
  interval or per deploy window for meaningful comparisons. Compare
  `window.seconds` and `totals.perSecond` before comparing absolute counts.
- **Demo caveat**: `--demo` uses a seeded PRNG so route/error _distributions_
  are stable, but `time` fields are wall-clock — do not diff demo reports
  across runs for exact numbers.
