# Error budget policy

How Spindle tracks, reports, and acts on SLO error budgets. The SLO catalog
itself (targets, windows, SLIs) lives in `docs/slo/`; this document defines
what we _do_ as budget is consumed.

## Concepts

- **SLO target** — e.g. 99.9% availability over a 30-day window.
- **Error budget** — the allowed failure fraction: `(100 - target)%` of events
  in the window may be "bad" before the SLO is missed.
- **Budget consumed / remaining** — `bad / (total × errorBudget)` and its
  complement, in percent.
- **Burn rate** — consumed fraction per elapsed fraction of the window. `>1`
  means the budget will exhaust before the window ends at the current pace.
- **Projected exhaustion** — linear projection of the current bad-event rate
  against the remaining allowance; `n/a` when no bad events are observed.

## Tooling

`scripts/sre/errorbudget/budget.mjs` computes all of the above per window.

```bash
# Offline demo (deterministic synthetic samples — safe for verification)
node scripts/sre/errorbudget/budget.mjs --demo

# Real run: JSONL samples, one {"ts","ok":bool} or {"ts","value":num} per line
node scripts/sre/errorbudget/budget.mjs \
  --service spindle --target 99.9 --window 30d,7d \
  --input samples.jsonl --threshold 300 --record
```

- `--record` writes per-window aggregates to
  `scripts/sre/errorbudget/.state/budget-state.json` and appends one snapshot
  per window to `.state/budget.log.jsonl` (append-only — never edit, only
  append via the tool). Both are git-ignored.
- Defaults come from `scripts/sre/errorbudget/budget.config.json`; CLI flags
  override. `--json` emits machine-readable output for dashboards/alerts.
- Samples older than the window are ignored; missing `ts` inherits the
  previous sample's timestamp. Numeric `value` samples need `--threshold`
  (good = `value <= threshold`).

## Thresholds → actions

Policy is evaluated on **budget remaining %** first, then burn rate. The
script prints the resolved action; keep `POLICY` in `budget.mjs` and this
table in sync.

| Budget remaining     | Burn rate | Action              | What it means                                                            |
| -------------------- | --------- | ------------------- | ------------------------------------------------------------------------ |
| ≥ 50%                | any       | `normal`            | Within envelope; standard deploy flow.                                   |
| ≥ 50%                | ≥ 2x      | `watch`             | On pace to exhaust early — monitor, prep mitigation.                     |
| 25–50%               | any       | `approval-required` | Risky deploys need explicit approval + risk note in the PR.              |
| 10–25%               | any       | `incident-review`   | Feature freeze; eng-lead sign-off for all deploys; open incident review. |
| < 10% (or exhausted) | any       | `deploy-halt`       | Halt all deploys except hotfixes approved by the on-call lead; page L3.  |

Notes:

- **Remaining < 0%** (over-consumed) resolves to `deploy-halt`.
- Thresholds are per-window: a healthy 30d budget does not excuse a burning
  7d budget, and vice versa.
- Actions are advisory gates enforced by review culture and CI, not hard
  technical blocks — the deploy pipeline does not currently read budget state.

## Integration

- **SLO catalog** — `docs/slo/` defines each SLO's target/window/SLI; run
  `budget.mjs` once per SLO (or per service covering several SLIs) with the
  matching `--target`/`--window`.
- **Monitoring / alerts** — `docs/oncall/alerting.md` describes the existing
  JSON-report → webhook path. A scheduled job (cron/CI) should run
  `budget.mjs --record` and, when `policy` is `incident-review` or
  `deploy-halt`, POST the `--json` output through the same webhook receiver so
  it reaches the on-call channel. Suggested severities: `watch` → info,
  `approval-required` → warning, `incident-review` → critical,
  `deploy-halt` → page.
- **Web vitals** — `src/lib/web-vitals/` already classifies CWV samples
  (`good`/`needs-improvement`/`poor`); those per-metric samples can feed the
  same JSONL format (`ok: rating === "good"`) for performance SLOs.
- **Sentry** — error events from `src/sentry.server.config.ts` /
  `instrumentation-client.ts` are the natural `ok:false` source for
  availability/error-rate budgets.

## Operations

- **Window rollover** — state resets a window's counters once its span has
  fully elapsed; feed whole-window samples (or accept the documented
  `max()`-merge semantics for re-runs).
- **Retroactive analysis** — point `--input` at historical JSONL and omit
  `--record` for a read-only report.
- **Demo / offline verification** — `--demo` uses a seeded PRNG; output is
  deterministic and writes only to `.state/demo-*` when combined with
  `--record`.
