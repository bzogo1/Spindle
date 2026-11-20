# Dashboards

Custom dashboards for Spindle operations data. Two complementary surfaces:

| Surface            | Location                                                              | Purpose                                                         |
| ------------------ | --------------------------------------------------------------------- | --------------------------------------------------------------- |
| Static HTML export | `scripts/dashboards/build.mjs` → `index.html` + `dashboard-data.json` | Offline, self-contained, no server needed — archives well in CI |
| Grafana dashboards | `infra/dashboards/grafana/*.json`                                     | Live monitoring against a Prometheus datasource                 |
| Prometheus rules   | `infra/dashboards/prometheus/spindle-slo.rules.yml`                   | Recording/alerting rules backing the SLO dashboard              |

Existing per-topic doc: [deploy-metrics.md](deploy-metrics.md) (the deploy
metrics collector itself).

## Static dashboard (`scripts/dashboards/build.mjs`)

Aggregates the JSON outputs of the existing reporting scripts into one
self-contained HTML page (inline CSS/SVG, no CDN, no build step).

```bash
# Demo mode — runs each source script in its offline --demo mode
node scripts/dashboards/build.mjs --demo --out docs/dashboards/site

# Rebuild from already-generated JSON reports instead of running the scripts
node scripts/dashboards/build.mjs --data-dir reports/ --out site/
```

`--data-dir` accepts these filenames (any missing one renders an empty
section):

| File                                      | Produced by                                                                                   |
| ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| `deploy-metrics.json` (or `metrics.json`) | `node scripts/deploy/metrics/collect.mjs --out <dir>`                                         |
| `slo-report.json`                         | `node scripts/slo/report.mjs --json` (stdout; may exit 1 on breach — the JSON is still valid) |
| `error-budget.json`                       | `node scripts/sre/errorbudget/budget.mjs --json`                                              |
| `log-metrics.json`                        | `node scripts/metrics/log-metrics.mjs --format json`                                          |
| `finops-report.json`                      | newest `finops-report-*.json` from `node scripts/finops/report.mjs --out <dir>`               |

A `dashboard-data.json` from a previous build is also accepted and supplies
all sections at once (round-trip: `--data-dir <previous --out dir>`).

Outputs: `index.html` (open in any browser) and `dashboard-data.json` (the
normalized dataset, reusable by other tooling).

### Panels per section

- **Deploy metrics** — KPI strip (releases, rollbacks, failures, current
  version, avg build/deploy seconds, health latency), build-time and
  deploy-duration bar charts per release (rollbacks highlighted), health
  latency line chart, per-release table. Source: `scripts/deploy/metrics/collect.mjs`.
- **SLO attainment & error budget** — SLO target table (from
  `docs/slo/service-level-objectives.md` via `report.mjs`), per-window
  per-service attainment/status/budget-remaining/latency-percentile table.
  Source: `scripts/slo/report.mjs`.
- **Error budget & burn rate** — budget-remaining bar chart plus
  consumed/remaining/burn-rate/projected-exhaustion/policy table per window.
  Source: `scripts/sre/errorbudget/budget.mjs` (see `docs/sre/error-budget.md`
  for policy thresholds).
- **Logs & request metrics** — request/error counts, error rate, req/s,
  p50/p95/p99 latency KPIs; errors-by-status and errors-by-route tables;
  per-endpoint breakdown; top error messages. Source:
  `scripts/metrics/log-metrics.mjs` (see `docs/observability/log-based-metrics.md`).
- **FinOps cost report** — monthly cost estimate table, compute/storage/LLM
  sections, recommendations. Source: `scripts/finops/report.mjs` (see
  `docs/finops/`).

Refresh: the HTML is a snapshot — rebuild it on a schedule (cron/CI) to
refresh. Nothing in it polls live data.

## Grafana dashboards (`infra/dashboards/grafana/`)

Import each JSON via _Dashboards → New → Import_ (or provision them under
`/etc/grafana/provisioning/dashboards/`). All four use a Prometheus
datasource selected through the `$DS_PROMETHEUS` template variable, so they
are datasource-agnostic — pick any Prometheus-compatible datasource on import.

| File                    | uid                        | Panels                                                                                       | Expected metrics                                                                                                                                                                                                                           |
| ----------------------- | -------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `deploy-metrics.json`   | `spindle-deploy-metrics`   | release/rollback/failure rate stats, build & deploy duration, health latency, releases table | `spindle_deploy_*` (see the info panel in the dashboard)                                                                                                                                                                                   |
| `slo-error-budget.json` | `spindle-slo-error-budget` | budget remaining, burn rate, SLI vs target, latency percentiles, policy snapshot             | `spindle_sli_*`, `spindle_error_budget_*`, `spindle_slo_*`                                                                                                                                                                                 |
| `logs-metrics.json`     | `spindle-logs-metrics`     | req rate, error rate, p95, requests/errors timeseries, latency percentiles, endpoint table   | `spindle_requests_total`, `spindle_request_errors_total`, `spindle_request_duration_ms_*`, `spindle_request_rate_per_second`, `spindle_log_window_seconds` — **these are the real names emitted by `log-metrics.mjs --format prometheus`** |
| `finops.json`           | `spindle-finops`           | monthly cost, host mem util, storage, LLM cost, container CPU/mem, log volume                | `spindle_finops_*` (pushed by the report job or a small exporter)                                                                                                                                                                          |

### Wiring notes

- **Logs & request metrics** is the most turnkey: serve
  `node scripts/metrics/log-metrics.mjs --file <log> --format prometheus`
  periodically (e.g. via Pushgateway, or a tiny `/metrics` endpoint wrapping
  it) and the panels light up. `docs/observability/log-based-metrics.md`
  covers the log format.
- **SLO/error budget**: `infra/dashboards/prometheus/spindle-slo.rules.yml`
  contains recording rules (`spindle_sli_availability_ratio`,
  `spindle_error_budget_remaining_pct`, `spindle_error_budget_burn_rate`,
  `spindle_slo_target`, `spindle_slo_policy`) and alerts
  (`SpindleErrorBudgetLow`, `SpindleErrorBudgetExhausted`,
  `SpindleSLIBelowTarget`). It assumes per-request counters
  `spindle_sli_total{service,result}` and a latency histogram
  `spindle_sli_latency_ms_bucket`; adapt to your instrumentation. Thresholds
  mirror `docs/sre/error-budget.md`.
- **Deploy metrics** and **FinOps** assume a thin exporter that converts the
  scripts' JSON output into the `spindle_deploy_*` / `spindle_finops_*`
  metrics named in each dashboard's info panel. Until then, the static HTML
  export covers the same data offline.
