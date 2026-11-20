# Observability stack

How Spindle's observability pieces fit together: where each signal is
produced, how it flows, and what you can query where. This document is the
map — each linked doc owns the details of its layer.

**TL;DR:** pino JSON on stdout → `ship.mjs` → Loki (logs, queryable in
Grafana) · `log-metrics.mjs` → Prometheus exposition → Prometheus + Grafana
(metrics/alerts) · Sentry SDK → errors + sampled traces · `report.mjs` →
offline SLO attainment. The Loki/Prometheus/Grafana stack in
`infra/observability/` is **optional and not deployed by default** — it is a
local development/inspection stack, not part of the origin deployment.

## Architecture

```
┌──────────────────────────── Spindle app (Next.js, Node runtime) ────────────────────────────┐
│                                                                                              │
│  src/lib/logger.ts (pino)          src/lib/request-logging.ts           Sentry SDK           │
│  • sanitized JSON per line         • api.request summary line           • errors (always)    │
│  • stdout                          • requestId, method, path,           • traces @ 10%       │
│                                     status, durationMs, userId           (sentry-trace/      │
│                                     projectId; x-request-id header        baggage)           │
│                                     • Sentry breadcrumb ≥400                                      │
│                                                                                              │
│  src/lib/tracing/* (manual spans, trace continuation — additive, not wired everywhere)        │
└───────┬──────────────────────────────┬───────────────────────────────────┬─────────────────────┘
        │ stdout (one JSON/line)       │ Sentry envelopes (HTTPS)          │
        ▼                              ▼                                   │
┌───────────────────┐          ┌──────────────┐                            │
│ Docker json-file  │          │   Sentry     │                            │
│ driver (rotated)  │          │  (hosted or  │                            │
└─────────┬─────────┘          │ self-hosted) │                            │
          │ docker logs -f /  └──────────────┘                            │
          │ --file tail                                               │
          ▼                                                            │
   scripts/logging/ship.mjs                                            │
   • batch + retry + backpressure                                      │
   • sinks: stdout | file (rotated JSONL) | http                        │
          │                                                            │
          ├─── http --format loki ──► Loki push API ──► Loki ──► Grafana (Explore, LogQL)
          │         (or ndjson ──► Vector ──► Loki / disk buffer / file)
          │
          └─── file ──► logs/ship.jsonl (rotated spool)
                          │
                          ├──► scripts/metrics/log-metrics.mjs ──► Prometheus exposition
                          │      (one-shot: text|json|markdown|prometheus)
                          │            │
                          │            ▼
                          │      serve-metrics.mjs (:9100, optional stack only)
                          │            │
                          │            ▼ scrape (30s)
                          │      Prometheus ──► alert rules ──► Grafana dashboards
                          │
                          └──► scripts/slo/report.mjs (JSONL/load.mjs inputs → SLO report)

   Sentry traces/errors ◄── sampled request transactions; correlate to logs via requestId
   (tagRequestContext links request_id/user_id/project_id onto error events)
```

## Components and where they run

| Signal              | Producer                                                                                                                  | Transport                                                                                                                 | Store / sink                                | Query surface                                                      | Doc                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Structured logs     | `src/lib/logger.ts` + `request-logging.ts` (pino JSON on stdout)                                                          | Docker json-file → `scripts/logging/ship.mjs` (`--sink http --format loki`, or `--sink file` spool, or Vector in between) | Loki (14d retention) or rotated JSONL       | Grafana Explore (LogQL), `logcli`, shipper stderr stats            | [log-aggregation.md](./log-aggregation.md), [structured-logging.md](./structured-logging.md), [log-retention.md](./log-retention.md) |
| Log-derived metrics | `scripts/metrics/log-metrics.mjs` over a JSONL slice                                                                      | Prometheus text exposition; `serve-metrics.mjs` adds an HTTP scrape endpoint                                              | Prometheus TSDB (15d in the optional stack) | PromQL, Grafana, `prometheus/rules/spindle-alerts.yml`             | [log-based-metrics.md](./log-based-metrics.md)                                                                                       |
| Errors + traces     | Sentry SDK (`instrumentation-client.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`), `src/lib/tracing/*` helpers | Sentry envelopes over HTTPS                                                                                               | Sentry (hosted)                             | Sentry UI; `requestId`/`userId`/`projectId` tags join to log lines | [distributed-tracing.md](./distributed-tracing.md), [trace-sampling.md](./trace-sampling.md)                                         |
| SLO attainment      | `scripts/slo/report.mjs` over JSONL probes / `load.mjs` reports                                                           | offline batch                                                                                                             | none (report only)                          | terminal/JSON report; exit 1 on breach                             | [docs/slo/](../slo/)                                                                                                                 |
| Deploy metrics      | `scripts/deploy/metrics/collect.mjs`                                                                                      | local files                                                                                                               | `deploy-metrics/` HTML                      | static dashboard                                                   | [docs/dashboards/deploy-metrics.md](../dashboards/deploy-metrics.md)                                                                 |

## Data flow in detail

### 1. Logs: pino → ship.mjs → Loki

Every request emits one `api.request` JSON line (plus any app log lines).
`ship.mjs` is the only moving part — it reads stdin, a file (`--follow`
survives rotation), or `--demo`, batches up to `--batch-size`/`--flush-ms`,
pauses the source at `--max-buffer`, and retries HTTP batches with
exponential backoff. It never mutates log lines; for the `loki` format it
groups them into streams labelled `{service, level, host}` and converts ISO
timestamps to nanoseconds. Non-JSON noise is shipped verbatim under
`level=unknown`, never dropped.

Two supported topologies:

- **Direct:** `ship.mjs --sink http --endpoint http://loki:3100/loki/api/v1/push --format loki`
- **Buffered:** `ship.mjs --sink http --format ndjson` → Vector `http` source →
  Vector `loki` sink with a disk buffer (survives restarts; see
  log-aggregation.md for the full `vector.toml`).

If Loki is down longer than the retry budget (~1 min worst case per batch),
batches are counted as dropped and reported in the shutdown summary —
`recordsDropped > 0` is the alertable signal. For guaranteed delivery, use
the `file` sink as a spool (`logs/ship.jsonl`, rotated at 100 MB × 3) and
replay later.

### 2. Metrics: logs → Prometheus exposition → Prometheus

`log-metrics.mjs` is deliberately a **one-shot reporter, not a tsdb**: it
parses a bounded JSONL window and prints `text`/`json`/`markdown`/
`prometheus` renderings. Built-in metrics come from `api.request` lines
(`spindle_requests_total`, `spindle_request_errors_total`,
`spindle_request_duration_ms` histogram, rate/window gauges); extra metrics
come from `scripts/metrics/log-metrics.config.json` (`db.query` latency,
`worker.job` failures, error-log counts).

Because counters are window-scoped (`spindle_log_window_seconds` exposes the
window), the intended uses are:

- **Scrape (optional stack):** `serve-metrics.mjs` wraps the tool in a tiny
  HTTP server (`GET /metrics`, 15 s TTL cache) pointed at a bounded log file
  — default `/repo/logs/ship.jsonl`, i.e. the ship.mjs file-sink spool.
  Prometheus scrapes it every 30 s; each scrape re-parses the file so
  "rates" reflect the file's contents, not wall-clock deltas. Point
  `METRICS_LOG_FILE` at a rotated/bounded slice.
- **Batch/cron:** `--format json` piped to `jq` thresholds or
  `scripts/slo/report.mjs`-style wrappers; same exit-code convention as the
  db monitor.

### 3. Traces/errors: Sentry

Sentry is the only **hosted/external** dependency in the stack (self-hosting
is possible but out of scope). All three runtimes sample `tracesSampleRate`
0.1 — errors are never sampled. `withRequestLogging` adds a Sentry
breadcrumb for status ≥ 400 carrying the `requestId`, and
`tagRequestContext({ requestId, userId, projectId })` puts the same ids on
error events, so a Sentry issue links back to the exact `api.request` log
line in Loki. Trace ids are **not currently logged** — adding
`getTraceContext().traceId` to request-scoped fields would enable direct
log↔trace joins (see distributed-tracing.md).

### 4. SLOs: report.mjs (offline)

`scripts/slo/report.mjs` ingests JSONL samples (`{ts, service, ok, ms}`),
`load.mjs --out` reports, or health-check logs and reports SLI attainment +
error budget over day/7d/28d windows against the catalog in
`docs/slo/service-level-objectives.md`. It is intentionally decoupled from
the live stack: run it on cron against probe output, or point Prometheus
recording rules at the same SLIs later. Exit 1 = breach.

## The optional local stack

`infra/observability/` contains a **standalone** compose project
(`spindle-observability`) — it is not referenced by `compose.yaml` or
`infra/origin/compose.yaml`, nothing in CI starts it, and every published
port binds `127.0.0.1` only.

| Service                | Image                    | Port (localhost) | Purpose                                                                                               |
| ---------------------- | ------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------- |
| `loki`                 | `grafana/loki:3.4.2`     | 3100             | Log store; push API + `/ready`                                                                        |
| `prometheus`           | `prom/prometheus:v3.5.0` | 9090             | TSDB (15d), scrapes below, evaluates `prometheus/rules/spindle-alerts.yml`                            |
| `log-metrics-exporter` | `node:24-alpine`         | 9100             | `serve-metrics.mjs` → Prometheus exposition from `METRICS_LOG_FILE` (default `/repo/logs/ship.jsonl`) |
| `grafana`              | `grafana/grafana:11.6.0` | 3001             | UI; Loki + Prometheus datasources auto-provisioned; anonymous **Viewer**                              |

```bash
# 1. Start the stack
cd infra/observability
docker compose -f compose.observability.yml up -d

# 2. Produce a log source. Either ship live logs to Loki:
docker logs -f --tail 0 spindle-app-1 2>&1 \
  | node scripts/logging/ship.mjs --stdin \
      --sink http --endpoint http://localhost:3100/loki/api/v1/push --format loki

# …or spool to the file the metrics exporter reads (default logs/ship.jsonl):
node scripts/logging/ship.mjs --file /path/to/app.log --follow \
  --sink file --out logs/ship.jsonl

# 3. Open http://localhost:3001 (anonymous Viewer) — Loki + Prometheus
#    datasources are pre-provisioned. Explore LogQL or PromQL directly.

# Sanity-check the config before bringing it up:
node scripts/observability/validate-stack.mjs --docker
```

Smoke-test the exporter without Docker:

```bash
node scripts/observability/serve-metrics.mjs --demo --port 9100
curl -s localhost:9100/metrics | head
```

### File map

```
infra/observability/
├── compose.observability.yml              # optional standalone stack (this dir)
├── loki-config.yaml                       # single-binary Loki, 14d retention
├── prometheus.yml                         # scrape jobs + rule_files
├── prometheus/rules/spindle-alerts.yml    # example alerts over log metrics
└── grafana/provisioning/datasources/
    └── datasources.yaml                   # Loki + Prometheus datasources

scripts/observability/
├── serve-metrics.mjs                      # HTTP wrapper: log-metrics.mjs → /metrics
└── validate-stack.mjs                     # config sanity checker
```

### What runs where — production vs. optional

| Component     | Production (origin stack)                               | Optional local stack                              |
| ------------- | ------------------------------------------------------- | ------------------------------------------------- |
| App pino logs | stdout → Docker json-file (rotated 20m×5)               | same                                              |
| Log shipping  | operator-run `ship.mjs` (host cron/systemd or sidecar)  | same script, pointed at `localhost:3100`          |
| Log store     | Loki/Vector **if the operator deploys one** (docs only) | `loki` service here                               |
| Metrics       | `log-metrics.mjs` on demand / cron                      | `log-metrics-exporter` + `prometheus` + `grafana` |
| Traces/errors | Sentry (always, when `NEXT_PUBLIC_SENTRY_*` set)        | unchanged — Sentry stays hosted                   |
| SLOs          | `report.mjs` on schedule                                | unchanged                                         |

The optional stack deliberately mirrors the documented production shapes
(same Loki config as log-aggregation.md, same Prometheus exposition as
log-based-metrics.md) so queries and alerts written against it port
directly to a real deployment.

## Alerting summary

Three alert surfaces exist, at different maturities:

1. **Prometheus rules** (`prometheus/rules/spindle-alerts.yml`, optional
   stack): error-rate ratio, per-path 5xx spikes, p95 latency, worker-job
   failures, error-log floods — PromQL over the log-derived metrics.
2. **Threshold checks** (any environment): `log-metrics.mjs --format json`
   piped to `jq`, or `scripts/slo/report.mjs` exit codes — the db-monitor
   style used today.
3. **Sentry**: issue alerts + `captureConsoleIntegration`; burn-rate rules
   for SLOs live in `docs/slo/burn-rate-alerting.md` (`rules.json` style).

## Operational notes

- **Cardinality:** Prometheus labels come straight from log fields
  (`method`, `path`, `status`). `requestPath()` strips query strings, but
  IDs in paths inflate series — normalize at the route layer if needed
  (see log-based-metrics.md).
- **Freshness:** the metrics exporter re-parses the whole file per scrape
  (TTL-cached). Keep `METRICS_LOG_FILE` pointed at a bounded slice; do not
  point it at an ever-growing append-only file.
- **Retention:** Loki 14d hot (matches log-retention.md's app-log policy);
  Prometheus TSDB 15d; shipper spool rotates at 100 MB × 3.
- **Secrets:** nothing in this stack changes the logging redaction contract
  — `sanitizeForLog` runs before any line exists, and the shipper/explorer
  path carries lines verbatim.
