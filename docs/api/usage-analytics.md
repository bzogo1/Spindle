# API usage analytics

How to measure and report on API usage — who calls which endpoints, how
often, and where requests fail. This page covers the tooling; the metric
definitions and anomaly guidance live in
[`docs/analytics/api-usage.md`](../analytics/api-usage.md).

## Data source

Every route handler wrapped in `withRequestLogging`
([`src/lib/request-logging.ts`](../../src/lib/request-logging.ts)) emits one
JSON summary line per request:

```json
{
  "level": "info",
  "time": "2025-01-01T00:00:00.000Z",
  "event": "api.request",
  "requestId": "…",
  "method": "GET",
  "path": "/api/projects",
  "status": 200,
  "durationMs": 18.4,
  "userId": "user_…",
  "projectId": "proj_…",
  "msg": "api request"
}
```

Notes that matter for analytics:

- `path` is the URL **pathname only** — query strings (signed URLs, tokens)
  are stripped before logging.
- `userId` / `projectId` are `null` until the handler resolves them via
  `setRequestLogContext(request, { userId, projectId })`. Handlers that
  never call it contribute anonymous traffic.
- `error: { type, message }` is present only when the handler **throws**;
  responses with `status >= 400` usually have no `error` object.
- Thrown errors also leave a Sentry breadcrumb; `api.request` lines are the
  complete per-request record regardless of Sentry.

## Tools

### `scripts/analytics/api/usage.mjs` — usage reports

```bash
node scripts/analytics/api/usage.mjs --demo                 # synthetic fixture
node scripts/analytics/api/usage.mjs --file logs/app.jsonl  # file once
kubectl logs -l app=spindle | node scripts/analytics/api/usage.mjs --stdin
node scripts/analytics/api/usage.mjs --demo --format json,markdown --top 20
```

| Flag              | Default       | Meaning                                                    |
| ----------------- | ------------- | ---------------------------------------------------------- |
| `--demo`          | —             | Deterministic synthetic `api.request` lines (seeded PRNG). |
| `--file <path>`   | —             | Read a JSONL file (`-` = stdin).                           |
| `--stdin`         | implicit      | Read stdin when no `--file`/`--demo`.                      |
| `--format`        | `text`        | Comma-separated `text,json,markdown`.                      |
| `--request-event` | `api.request` | Event name treated as a request summary.                   |
| `--top <n>`       | `10`          | Rows in top-N tables.                                      |

Produces per-endpoint counts/error rates/latency percentiles, status
distribution, top `userId`/`projectId` consumers, and top error messages.
Exit codes: `0` ok, `2` usage error.

### `src/lib/api-analytics/usage.ts` — embeddable aggregation

`aggregateApiUsage(records, { requestEvent, topN })` is the same
aggregation as a pure function over already-parsed records — use it from
scripts, server code, or tests without shelling out. Covered by
`usage.test.ts` (vitest).

### `scripts/metrics/log-metrics.mjs` — Prometheus/SLO metrics

For scrape-able metrics (request rate, error counters, latency histograms)
use `log-metrics.mjs --format prometheus` on the same log stream — see
[`docs/observability/log-based-metrics.md`](../observability/log-based-metrics.md).
`usage.mjs` complements it with consumer-level analytics that would blow up
Prometheus label cardinality.

## Quick recipes

Top consumers for a log file:

```bash
node scripts/analytics/api/usage.mjs --file logs/app.jsonl --format json \
  | jq '{topUsers: .topUsers[:5], topProjects: .topProjects[:5]}'
```

Error-rate gate in CI/cron:

```bash
node scripts/analytics/api/usage.mjs --file logs/app.jsonl --format json \
  | jq -e '.totals.errorRate < 0.05' >/dev/null
```

Feed live logs from a running deploy:

```bash
kubectl logs -f deploy/spindle --since=15m | \
  node scripts/analytics/api/usage.mjs --stdin --format markdown > usage.md
```

## Related docs

- [`docs/analytics/api-usage.md`](../analytics/api-usage.md) — metric catalog,
  dashboards tie-in, anomaly notes.
- [`docs/observability/log-based-metrics.md`](../observability/log-based-metrics.md)
  — Prometheus exposition, alert rules, retention.
- [`docs/observability/structured-logging.md`](../observability/structured-logging.md)
  — pino log shape and redaction.
- [`docs/api/contract-testing.md`](contract-testing.md) — wire-contract specs
  for the same routes.
