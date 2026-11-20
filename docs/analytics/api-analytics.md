# API analytics

Deep analytics over `api.request` log records — the longitudinal companion to
`scripts/metrics/log-metrics.mjs` (which answers "what is the request/error
rate right now") and to `src/lib/api-analytics/usage.ts` (per-request usage
aggregation). This layer answers questions that need a multi-day window:

- how request volume per endpoint trends day over day
- how fast each endpoint is burning its error budget
- which users and projects drive the most traffic
- which endpoints are newly appearing vs. established
- where latency or error rates are regressing

## Inputs

Everything is derived from the single JSON summary line emitted per request by
`withRequestLogging` in `src/lib/request-logging.ts`:

```json
{
  "event": "api.request",
  "requestId": "req_…",
  "method": "GET",
  "path": "/api/projects",
  "status": 200,
  "durationMs": 41.2,
  "userId": "user_…",
  "projectId": "proj_…",
  "time": "2025-01-01T00:00:00.000Z"
}
```

Paths only are logged (query strings can carry signed-URL signatures), so all
metrics are path-template level. `userId`/`projectId` are `null` for anonymous
or unresolved requests and roll up under `(anonymous)` in actor tables.

## Module: `src/lib/api-analytics/core.ts`

Pure functions, no I/O, no clock reads beyond record timestamps — safe for
vitest and reusable from scripts:

| Export               | Purpose                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `isApiRequestRecord` | predicate for `event === "api.request"`                                                                                           |
| `normalizeRequest`   | coerce one record into `{ time, method, path, status, durationMs, userId, projectId }`; returns `null` when time/path are missing |
| `collectRequests`    | filter + normalize an iterable of parsed records                                                                                  |
| `percentile`         | interpolated percentile over a sorted array                                                                                       |
| `detectAnomalies`    | baseline-vs-recent-half comparison per endpoint                                                                                   |
| `analyzeApiRequests` | full report (see below)                                                                                                           |

`analyzeApiRequests(records, options)` returns an `ApiAnalyticsReport`:

- `window` — first/last timestamps, duration, totals, unique users/projects
- `endpoints[]` — per `METHOD path`: request/error counts, error rate,
  avg/p50/p95 duration, first/last seen, active user/project counts,
  `isNew` flag, and `errorBudget` (`allowedRate`, `burnRate`,
  `errorsPerDay`)
- `timeSeries[]` — flat `{ endpoint, bucketStart, requests, errors }` rows
  bucketed by `options.bucketMs` (default 24h)
- `topUsers[]` / `topProjects[]` — actor summaries with request/error
  counts, error rate, avg/p95 latency, count of related entities
  (projects-per-user, users-per-project), first/last seen
- `newEndpoints[]` — endpoints whose first request falls inside the
  trailing `newEndpointWindowMs` (default 7d) measured from the newest
  record in the dataset
- `anomalies[]` — see detection rules below
- `options` — the effective option set, echoed for report consumers

## CLI: `scripts/analytics/api/analyze.mjs`

```bash
node scripts/analytics/api/analyze.mjs --demo                 # synthetic 14-day fixture
node scripts/analytics/api/analyze.mjs --file logs/app.log   # JSONL input
cat logs/app.log | node scripts/analytics/api/analyze.mjs --stdin
node scripts/analytics/api/analyze.mjs --demo --format json,markdown
```

Options: `--format text,json,markdown` (default `text`), `--json`,
`--markdown`, `--bucket-hours`, `--new-window-days`, `--error-budget <pct>`,
`--top <n>`. The demo fixture is deterministic (seeded PRNG) and exercises
every section: a multi-day volume series, a new endpoint (`/api/insights`),
a latency regression (`/api/search`), and an error-budget-burning endpoint
(`/api/uploads`).

The CLI loads `core.ts` through `tsx/esm/api` (`tsImport`), so it needs the
repo's devDependencies installed but adds no runtime dependency.

## Metrics definitions

- **Error rate** — `status >= 400` count / request count, per endpoint and
  per actor. 5xx vs 4xx are not split here; `usage.ts` covers that split.
- **Error-budget burn** — `observedErrorRate / allowedRate`. `allowedRate`
  defaults to 1% (`--error-budget`); burn > 1× means the endpoint is
  consuming budget faster than SLO permits. `errorsPerDay` normalizes the
  burn to the observed window length.
- **Latency** — `durationMs` percentiles (avg, p50, p95) per endpoint and
  per actor. Requests without `durationMs` are excluded from latency stats
  but still counted for volume/errors.
- **New vs returning** — an endpoint is _new_ when its first observed
  request is within `newEndpointWindowMs` of the dataset's last timestamp.
  Actor "newness" is intentionally not computed: a user seen once last week
  and again today is returning by definition of first-seen.

## Anomaly detection rules

`detectAnomalies` splits each endpoint's requests into a **baseline half**
and a **recent half** of the observed window (split at the temporal
midpoint) and compares them:

| Rule                 | Trigger                                                                                                                                                                                          | Severity                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| `latency_regression` | recent p95 ≥ baseline p95 × `latencyRegressionFactor` (default 1.5×) **and** absolute delta ≥ `latencyRegressionMinMs` (default 25ms) **and** recent requests ≥ `minRecentRequests` (default 10) | `critical` when ratio ≥ 2× the factor |
| `error_rate_spike`   | recent error rate ≥ max(baseline rate, 0.1%) × `errorSpikeFactor` (default 3×) **and** ≥ 1% absolute **and** recent errors ≥ `minRecentRequestsForErrors` (default 10)                           | `critical` when ratio ≥ 2× the factor |

Design notes:

- The absolute floors (25ms, 1%, min request counts) exist to suppress
  noise on low-traffic or sub-millisecond endpoints — a 2ms → 4ms "3×
  regression" is not actionable.
- The baseline floor of 0.1% means a previously-clean endpoint that starts
  erroring at ≥1% is flagged rather than producing an infinite ratio.
- Anomalies are sorted critical-first, then by endpoint name.
- These are _descriptive_ detectors over a fixed window, not streaming
  detectors. For continuous alerting see `scripts/alerts/` and the SLO docs
  in `docs/slo/`; this report is the ad-hoc investigation tool that feeds
  them context.

## Dashboard tie-ins

- **Grafana/Prometheus**: `scripts/metrics/log-metrics.mjs --format
prometheus` already exposes request/error/latency series; the anomaly
  thresholds here (1.5× p95, 3× error rate) are reasonable starting points
  for alert rules over those same series.
- **SLO burn dashboards**: `errorBudget.burnRate` per endpoint maps
  directly onto an SLO error-budget panel; `errorsPerDay` gives the
  consumption slope.
- **Growth/adoption**: `newEndpoints`, `timeSeries`, and actor
  `firstSeen`/`relatedCount` feed "which endpoints are gaining usage" and
  "which users span many projects" views.
- **Incident triage**: run `--file` over the incident window's logs; the
  Anomalies section plus per-endpoint budget burn usually identifies the
  culprit endpoint within seconds.

## Relationship to sibling modules

| Module                                     | Answers                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| `scripts/metrics/log-metrics.mjs`          | point-in-time metrics + Prometheus exposition from any log source        |
| `src/lib/api-analytics/usage.ts`           | single-pass usage aggregation (counts, latency summaries, top consumers) |
| `src/lib/api-analytics/core.ts` (this doc) | longitudinal analytics: time series, budgets, cohorts, anomaly detection |
