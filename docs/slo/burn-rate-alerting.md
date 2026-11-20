# SLO burn-rate alerting

Multiwindow burn-rate alerts for the SLOs in
[service-level-objectives.md](./service-level-objectives.md), expressed in the
same rule style as `scripts/db/monitoring/rules.json` so they can be evaluated
by the existing checker pattern (or ported to Prometheus/Alertmanager later).

## Burn-rate math

For an SLO with target `T` over window `W`, the error budget is `1 - T`. The
**burn rate** is how fast budget is consumed relative to plan:

```
burn rate = (observed bad-event rate) / (1 - T)
```

A burn rate of 1.0 consumes the 28d budget exactly on schedule. Google SRE
practice pairs a **long window** (sustained signal, low false-positive rate)
with a **short window** (fast detection): alert only when _both_ windows show
the burn, which filters single-sample noise.

`scripts/slo/report.mjs` already computes the inputs: per-window `attainment`
and `budgetRemainingPct`. Burn rate for a window is:

```
burn = max(0, (1 - attainment) / (1 - target))   # bad-event rate / budgeted bad-event rate
```

A burn rate of 1.0 means errors are accruing exactly at the budgeted rate —
the 28d budget is consumed on schedule. Values below 1 are under budget;
above 1 burn faster than planned. `report.mjs` exposes the same quantity as
`budgetConsumedPct` (= burn × 100) and `budgetRemainingPct` (= (1 − burn)
× 100, clamped).

## Alert rules

Severity and delivery follow `docs/oncall/alerting.md` and
`docs/oncall/escalation-policy.md` (SEV1 page → SEV2 ack → SEV3 ticket).

| Rule id                | Service / SLI                            | Long window | Short window | Burn                  | Severity        | Action                                        |
| ---------------------- | ---------------------------------------- | ----------- | ------------ | --------------------- | --------------- | --------------------------------------------- |
| `slo-fast-burn-page`   | any service, availability or latency SLI | 1h          | 5m           | ≥ 14.4×               | critical (SEV2) | Page on-call; budget gone in ~2h at this rate |
| `slo-slow-burn-ticket` | any service, availability                | 6h          | 30m          | ≥ 6×                  | warning (SEV3)  | Ticket + investigate same day                 |
| `slo-budget-low`       | any service                              | 28d         | —            | budgetRemaining < 20% | warning (SEV3)  | Freeze non-critical deploys                   |
| `slo-breach`           | any service                              | 28d         | —            | attainment < target   | critical (SEV2) | Page; see runbook below                       |

Rationale for the thresholds (28d budgets):

- **14.4× for 1h**: consumes ~2% of the monthly budget in an hour — the
  classic "page now" threshold; at this rate the budget is gone in ~47h.
- **6× for 6h**: consumes ~5% of budget — worth a same-day look but not a
  page; catches creeping degradation (e.g. one bad deploy, a noisy neighbor).
- **<20% remaining** mirrors the `warning` status in `report.mjs`.

## rules.json-style definitions

If wired into a `rules.json`-compatible evaluator, these are the rules
(`type`/`severity`/`warn`/`critical`/`demo`/`runbook` match
`scripts/db/monitoring/rules.json`; `query` is illustrative — a real
implementation reads SLI samples, not SQL):

```json
{
  "id": "slo-fast-burn-page",
  "title": "SLO fast burn (page)",
  "description": "Error-budget burn rate >= 14.4x sustained over 1h (confirmed over 5m). At this rate the 28d budget is exhausted in ~2 days.",
  "severity": "critical",
  "type": "sql",
  "requiresDb": false,
  "query": "SELECT burn_rate_1h FROM slo_burn_rates WHERE burn_rate_1h >= 14.4 AND burn_rate_5m >= 14.4",
  "unit": "ratio",
  "critical": 14.4,
  "demo": 22.0,
  "runbook": "slo-burn-rate.md#fast-burn"
}
```

```json
{
  "id": "slo-slow-burn-ticket",
  "title": "SLO slow burn (ticket)",
  "description": "Error-budget burn rate >= 6x sustained over 6h (confirmed over 30m). Consumes ~5% of the 28d budget per firing window.",
  "severity": "warning",
  "type": "sql",
  "requiresDb": false,
  "query": "SELECT burn_rate_6h FROM slo_burn_rates WHERE burn_rate_6h >= 6 AND burn_rate_30m >= 6",
  "unit": "ratio",
  "warn": 6,
  "demo": 8.5,
  "runbook": "slo-burn-rate.md#slow-burn"
}
```

```json
{
  "id": "slo-budget-low",
  "title": "SLO error budget below 20%",
  "description": "Less than 20% of the 28d error budget remains for any tracked service. Freeze non-critical deploys until burn stops.",
  "severity": "warning",
  "type": "sql",
  "requiresDb": false,
  "query": "SELECT min(budget_remaining_pct) FROM slo_attainment_28d",
  "unit": "percent",
  "warn": 20,
  "demo": 12.0,
  "runbook": "slo-burn-rate.md#budget-low"
}
```

## Evaluating today (offline)

There is no metrics backend yet, so burn alerts are evaluated from the same
samples that feed `report.mjs`:

```bash
# Daily/weekly cron; exit 1 on breach, warnings printed inline
node scripts/slo/report.mjs \
  --input samples.jsonl --window day,28d --json > /var/log/spindle-slo.json

# Demo the whole pipeline with no data at all
node scripts/slo/report.mjs --demo --json
```

The JSON report carries `windows[].services[].budgetRemainingPct` and
`status` (`ok`/`warning`/`breach`/`no-data`) — a thin wrapper can map
`breach` → SEV2 page and `warning` → SEV3 ticket through the webhook path in
`docs/oncall/alerting.md` (`MONITOR_WEBHOOK_URL`-style POST of the JSON).

## Runbook anchors

- **fast-burn**: confirm with `report.mjs --window day`; check recent deploys
  (`docs/deploy/notifications.md` events), error breakdown in the load-test
  report (`errorKinds`), and DB monitoring (`check.mjs`). Roll back per
  `docs/runbooks/rollback.md` if a deploy correlates.
- **slow-burn**: same investigation, lower urgency; look for gradual
  regressions (bundle growth vs `baselines/`, cache hit rate, per-endpoint
  latency drift in `load.mjs` reports).
- **budget-low**: treat remaining budget as a deploy freeze; schedule an SLO
  review — either fix the burn or revise the target in
  `service-level-objectives.md` + `report.mjs` `SLOS` together.
- **breach**: page. Attainment below target means users are already harmed;
  prioritize restoration over diagnosis, then write it up in the on-call
  handoff (`docs/oncall/handoff.md`).
