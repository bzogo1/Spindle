# Log-based metrics

Spindle's request handlers already emit one structured JSON summary line per
request (`event: "api.request"`, `method`, `path`, `status`, `durationMs`)
via `withRequestLogging` in `src/lib/request-logging.ts`, on top of the pino
logger in `src/lib/logger.ts`. Those lines carry everything needed for
request-rate, error-rate, and latency metrics — no instrumentation changes
required.

[`scripts/metrics/log-metrics.mjs`](../../scripts/metrics/log-metrics.mjs)
turns those JSONL logs into metrics. It is dependency-free (plain `node`),
reads a file, stdin, or a built-in `--demo` fixture, and can emit four formats:

| Format       | Use                                                      |
| ------------ | -------------------------------------------------------- |
| `text`       | Human summary on a terminal (default).                   |
| `json`       | Full report for other tooling (`jq`, dashboards, CI).    |
| `markdown`   | Paste into an incident ticket or runbook notes.          |
| `prometheus` | Prometheus text exposition — scrape it or feed an agent. |

Formats compose: `--format text,json,markdown,prometheus` prints all of them.

## Usage

```bash
# Inspect the pipeline end-to-end with synthetic pino lines
node scripts/metrics/log-metrics.mjs --demo

# Point it at a shipped log file
node scripts/metrics/log-metrics.mjs --file logs/app.jsonl --format markdown

# Pipe live logs (same source as scripts/logging/ship.mjs)
docker logs -f spindle-app | node scripts/metrics/log-metrics.mjs --stdin --format prometheus

# Cron-style: JSON report for a weekly SLO review
node scripts/metrics/log-metrics.mjs --file /var/log/spindle/app-$(date +%F).jsonl --format json > report.json
```

Exit codes: `0` ok, `2` usage/config error. Non-JSON lines are skipped and
counted on stderr — interleaved dependency noise does not break the run.

## How logs become metrics

1. **Parse.** Each line is `JSON.parse`d; non-JSON lines are skipped. Pino
   fields (`level` label, ISO `time`, `service`, `pid`, `hostname`, `msg`)
   plus whatever the request logger attached are all visible to filters.
2. **Core request metrics.** Lines whose `event` equals `requestEvent`
   (default `api.request`, overridable via config or `--request-event`)
   produce the built-in report:
   - request count and rate (`requests / window seconds`)
   - error counts/rates by HTTP status and by `method path` route
   - latency percentiles (p50/p90/p95/p99/min/max/avg) from `durationMs`
   - top error messages from `error.message` on failed requests
   - per-endpoint breakdown: count, errors, error rate, avg and p95 duration
3. **Config metrics.** [`log-metrics.config.json`](../../scripts/metrics/log-metrics.config.json)
   declares extra counters/gauges/histograms. Each metric has:
   - `match` — array of `{ field, op, value }` clauses ANDed together.
     `field` is a dot path into the JSON record (`error.type`,
     `durationMs`). Ops: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`
     (array value), `exists` (boolean). This is deliberately a tiny
     LogQL/jq subset — no expressions, no pipes.
   - `groupBy` — fields promoted to Prometheus labels.
   - `type` — `counter` (count of matches), `gauge` (value of the last
     matching record's `value` field), or `histogram` (`value` field bucketed
     by `buckets`, emitted as `_bucket`/`_sum`/`_count`).
4. **Render.** The Prometheus exposition emits, at minimum:
   - `spindle_requests_total{method,path,status}` — counter
   - `spindle_request_errors_total{method,path,status}` — counter (status ≥ 400)
   - `spindle_request_rate_per_second`, `spindle_log_window_seconds` — gauges
   - `spindle_request_duration_ms_bucket{method,path,le}` — histogram
   - every config-defined metric under its `name`

Because metrics are computed over the **whole parsed window**, counters are
only meaningful relative to that window (the window bounds are exposed via
`spindle_log_window_seconds`). For continuous monitoring prefer scraping a
recent file slice or running the tool on a cron and treating output as a
point-in-time snapshot — it is a reporting/alerting bridge, not a long-term
tsdb.

## Alert rules (same style as `scripts/db/monitoring/rules.json`)

The db monitor evaluates `rules.json` and prints ok/warning/critical. The
equivalent for log metrics is to run `log-metrics.mjs --format json` and
threshold fields in `summary` — or, if a Prometheus server scrapes the
exposition, use ordinary PromQL. Example mapping:

| Alert intent         | Log-metric expression (PromQL)                                                              | Threshold suggestion        |
| -------------------- | ------------------------------------------------------------------------------------------- | --------------------------- |
| 5xx spike on a route | `sum by (path) (rate(spindle_request_errors_total{status=~"5.."}[5m]))`                     | warn > 0.05/s, crit > 0.2/s |
| Overall error rate   | `sum(rate(spindle_request_errors_total[5m])) / sum(rate(spindle_requests_total[5m]))`       | warn > 2%, crit > 5%        |
| Slow endpoint p95    | `histogram_quantile(0.95, sum by (le,path) (rate(spindle_request_duration_ms_bucket[5m])))` | warn > 500ms, crit > 2s     |
| Worker job failures  | `increase(spindle_worker_job_failures_total[15m])`                                          | crit > 0                    |
| DB query latency     | `histogram_quantile(0.99, sum by (le) (rate(spindle_db_query_duration_ms_bucket[5m])))`     | warn > 250ms                |
| Error-log flood      | `sum(rate(spindle_error_log_lines_total[5m]))`                                              | warn > 1/s                  |

A minimal JSON-driven checker (mirroring `scripts/db/monitoring/check.mjs`)
can be built by piping `--format json` into `jq`:

```bash
node scripts/metrics/log-metrics.mjs --file logs/app.jsonl --format json \
  | jq -e '.summary.requests.errorRate < 0.05' >/dev/null
```

For cron alerting without Prometheus, run the tool, save the JSON report, and
compare `summary.requests.errorRate` /
`summary.latencyMs.p99` against thresholds in a small wrapper — same exit-code
convention as the db monitor (`0` clear, `1` threshold crossed, `2` error).

## Retention notes

- The tool consumes whatever log file you point it at; it does not manage
  retention. Pair it with the log shipper (`scripts/logging/ship.mjs`) which
  writes rotated JSONL (`--rotate-mb`, `--rotate-keep`) or pushes to Loki.
- Percentiles and rates are computed over the **parsed window only** — feed
  bounded slices (one rotated file, one cron interval) rather than an
  ever-growing file, or early data skews the window.
- `--demo` output is deterministic (seeded PRNG) except for `generatedAt`
  timestamps and wall-clock `time` fields — safe for docs and smoke tests.
- Prometheus label cardinality: `path` values come straight from logs. Route
  handlers log normalized paths (no query strings — `requestPath()` strips
  them), but high-cardinality paths (IDs in the path) would inflate series.
  Normalize IDs to `:id`-style segments at the route layer if needed.
