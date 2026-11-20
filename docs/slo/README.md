# SLOs

Service-level objectives, SLIs, error budgets, and burn-rate alerting for
Spindle. Everything here is offline-capable: definitions are docs, measurement
is a dependency-free Node script.

| Doc                                                          | Contents                                                                                                                                                                                            |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [service-level-objectives.md](./service-level-objectives.md) | Per-service SLIs (`web-app`, `api`, `postgres`), targets and error budgets derived from `lighthouserc.json` + `scripts/perf/benchmarks/budgets.json`, healthcheck composition, measurement commands |
| [burn-rate-alerting.md](./burn-rate-alerting.md)             | Multiwindow burn-rate rules (fast/slow burn, budget-low, breach) in `rules.json` style, severity mapping to the on-call policy, offline evaluation                                                  |

## Tooling

[`scripts/slo/report.mjs`](../../scripts/slo/report.mjs) ingests metric
samples and reports SLI attainment vs target plus error-budget remaining over
`day`/`7d`/`28d`/`all` windows.

```bash
node scripts/slo/report.mjs --demo                     # synthetic 28d dataset
node scripts/slo/report.mjs --input run.json --window day,28d
node scripts/slo/report.mjs --input probes.jsonl --json
```

Inputs: JSONL samples (`{ts, service, ok, ms}`), `load.mjs --out` reports,
or health-check logs. Exit `1` on an SLO breach, `2` on usage/IO errors.
`--demo` intentionally contains an `api` breach so the alerting path is
exercised; it exits `1`.

## Related

- `docs/performance/` — budgets this doc derives from (benchmarks, load
  testing, Lighthouse CI, Core Web Vitals, bundle report)
- `scripts/db/monitoring/` — DB alert rules whose severity/runbook style the
  burn-rate rules mirror
- `docs/oncall/` — alerting channels, escalation policy, handoff
- `docs/runbooks/database-monitoring.md` — runbook format for alert rules
