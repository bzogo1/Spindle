# Webhook Delivery Monitoring

Status: **reporting implemented** (`scripts/webhooks/monitoring/`); app-side
instrumentation hooks land with the sender workstream (`src/lib/webhooks/`).

This document defines the delivery-health metrics, the log format the
monitor consumes, the alert thresholds, and how the report ties into the
existing alerting/dashboards plumbing.

## Scope

Covers **outbound** webhook delivery: every HTTP attempt a sender makes toward
a receiver endpoint, across retries. Inbound signature/dedup health is covered
by `docs/webhooks/contract-testing.md`; dead-letter _queue management_
(inspect/replay/purge) is covered by the DLQ workstream
(`src/lib/webhooks/dlq.ts`, `scripts/webhooks/dlq/manage.mjs`,
`docs/webhooks/dead-letter-queue.md`). This doc is about _measuring_ delivery
health and _alerting_ on it.

## Components

| File                                             | Purpose                                                                                                                          |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/webhooks/monitoring/monitoring.ts`      | Pure analysis module: log parsing, outcome classification, aggregation, dead-letter detection, threshold evaluation, demo corpus |
| `scripts/webhooks/monitoring/monitoring.test.ts` | Vitest suite (26 tests)                                                                                                          |
| `scripts/webhooks/monitoring/vitest.config.mts`  | Standalone vitest config (repo root only covers `src/`)                                                                          |
| `scripts/webhooks/monitoring/report.mjs`         | CLI: reads NDJSON delivery logs or `--demo`, prints report, exits non-zero on alerts                                             |

Run the suite:

```bash
npx vitest run --config scripts/webhooks/monitoring/vitest.config.mts
```

## Log format

One delivery attempt per line, NDJSON:

```jsonc
{
  "ts": "2026-11-20T04:12:03.000Z", // required, ISO-8601
  "eventId": "evt_01JZX…", // optional, sender's event id
  "endpoint": "https://hooks.example.com/newsletter",
  "attempt": 2, // 1-based retry number
  "status": 200, // HTTP status; omit on transport errors
  "latencyMs": 143, // round-trip time
  "error": "ETIMEDOUT", // transport error description
  "deadLettered": false, // explicit DLQ marker (optional)
}
```

Field aliases are tolerated (`timestamp`/`time`, `event_id`/`id`, `url`,
`statusCode`, `durationMs`, `errorMessage`, `dlq`, …) — see
`parseDeliveryAttempt` in `monitoring.ts`. Lines without a parseable
timestamp are skipped and counted in the report.

When the sender workstream lands, emit one line per attempt to a log shipper
(e.g. stdout → vector/Loki, or append to a rotated file the report cron reads).

## Metrics

`DeliverySummary` (from `summarizeDeliveries`) exposes:

| Metric                            | Definition                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------ |
| `total`                           | Attempt count in the analyzed window                                           |
| `success` / `successRate`         | 2xx responses with no transport error                                          |
| `failure`                         | Non-2xx HTTP responses (4xx and 5xx both count as unhealthy)                   |
| `error`                           | No HTTP response at all — timeout, DNS, connection reset                       |
| `unhealthyRate`                   | `(failure + error) / total` — the headline SLI-style metric                    |
| `consecutiveFailures`             | Trailing run of non-success attempts at the end of the log                     |
| `latency.{avg,p50,p95,p99,max}Ms` | Round-trip latency distribution over attempts with `latencyMs`                 |
| `statusCodes`                     | Histogram, e.g. `{"200": 41, "500": 3, "none": 2}` (`none` = transport errors) |
| `byEndpoint[]`                    | Per-endpoint rollup: counts, `unhealthyRate`, p50/p95 latency                  |
| `window`                          | First/last attempt timestamps                                                  |
| `deadLetter.{attempts,events}`    | Dead-lettered attempts and distinct events among them                          |

### Outcome classification

- **success** — HTTP 2xx and no `error` field.
- **failure** — an HTTP status came back but it is not 2xx.
- **error** — no HTTP status was recorded (transport-level failure).

4xx responses count as unhealthy: a receiver rejecting our payloads
(`400 invalid_signature`, `400 invalid_payload` from the contract receiver)
means the _sender_ is broken, which is exactly what monitoring should surface.

### Dead-letter detection

An attempt is dead-lettered when either:

1. it carries an explicit marker (`deadLettered: true` / `dlq: true`) — set by
   the sender when it parks the event in `src/lib/webhooks/dlq.ts`, or
2. it failed with `attempt >= maxAttempts` (default **5**, matching the retry
   policy's `maxAttempts` default in `src/lib/webhooks/retry.ts`) — retries
   exhausted even if the marker wasn't emitted.

## Alert rules

`evaluateAlerts(summary, thresholds)` returns `{rule, severity, message,
observed, threshold}` entries. Defaults (`DEFAULT_THRESHOLDS`):

| Rule                   | Severity | Condition                               | Default threshold |
| ---------------------- | -------- | --------------------------------------- | ----------------- |
| `unhealthy-rate`       | warning  | `unhealthyRate ≥ threshold`             | 5%                |
| `unhealthy-rate`       | critical | `unhealthyRate ≥ threshold`             | 20%               |
| `latency-p95`          | warning  | `p95 latency ≥ threshold`               | 2000 ms           |
| `latency-p99`          | warning  | `p99 latency ≥ threshold`               | 5000 ms           |
| `consecutive-failures` | warning  | trailing non-success streak ≥ threshold | 5 attempts        |
| `dead-lettered`        | critical | dead-lettered attempts > threshold      | 0 (any DLQ entry) |

Rate and latency rules are **suppressed below `minAttempts`** (default 20) —
a 1-of-2 failure window is noise, not signal. `consecutive-failures` and
`dead-lettered` always evaluate: a streak or a parked event matters at any
volume.

## Using the report

```bash
# Synthetic corpus exercising every alert path (exits 1 — alerts fire):
node scripts/webhooks/monitoring/report.mjs --demo

# Analyze a real NDJSON log:
node scripts/webhooks/monitoring/report.mjs --file /var/log/webhooks/deliveries.ndjson
cat deliveries.ndjson | node scripts/webhooks/monitoring/report.mjs --file -

# Machine-readable output for piping into other tooling:
node scripts/webhooks/monitoring/report.mjs --file deliveries.ndjson --json

# Cron-friendly gating: non-zero exit on critical alerts only
# (add --fail-on-warning to fail on warnings too):
node scripts/webhooks/monitoring/report.mjs --file deliveries.ndjson
```

Exit codes: `0` healthy, `1` critical alert (or `--fail-on-warning` with
warnings), `2` unreadable input.

## Dashboards & alerting tie-in

The module is deliberately transport-agnostic so the same numbers can feed
multiple sinks:

- **Cron + webhook bridge** — run `report.mjs --file …` on a schedule; on
  non-zero exit, forward the `--json` output through the existing alert
  plumbing documented in `docs/oncall/alerting.md`
  (`scripts/deploy/notify.ts` webhook channel or a direct POST to
  `MONITOR_WEBHOOK_URL`-style receivers). This mirrors how
  `scripts/db/monitoring/check.mjs` already emits JSON reports.
- **Metrics pipeline** — when the sender lands, export the summary fields as
  Prometheus-style metrics: `webhook_delivery_total{outcome,endpoint}`,
  `webhook_delivery_latency_ms{quantile}`, `webhook_dead_lettered_total`.
  The alert thresholds above translate directly into Prometheus alerting
  rules (`unhealthyRate` ≈ `1 - rate(success)`).
- **DLQ cross-check** — `deadLetter.attempts`/`events` should reconcile with
  the DLQ depth reported by `scripts/webhooks/dlq/manage.mjs`; divergence
  means either the log shipper is dropping lines or the DLQ marker isn't
  being emitted.

## Tuning

All thresholds are parameters of `MonitoringThresholds`
(`DEFAULT_THRESHOLDS` in `monitoring.ts`). The CLI exposes `--min-attempts`;
other knobs are set by importing the module (e.g. from a future
`src/lib/webhooks/monitoring.ts` wrapper or a scheduled job). Revisit defaults
after the first week of real traffic — particularly `unhealthyRateWarning`
(5%) and `p95LatencyMsWarning` (2 s), which assume sub-second receiver
latency.
