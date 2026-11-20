# Experiment tracking

How we register, run, measure, and retire product experiments. The registry
is a JSON file (`experiments.registry.json` by default) managed by
`scripts/experiments/track.mjs`; the domain rules live in
`src/lib/experiments/tracking.ts` (typed, unit-tested) and are mirrored in the
CLI.

## Lifecycle

```
draft ──start──▶ running ──conclude──▶ concluded   (terminal)
  │               │
  └──stop──▶ stopped ◀──stop──┘
       │
       └──resume──▶ running
```

| Status      | Meaning                                                          |
| ----------- | ---------------------------------------------------------------- |
| `draft`     | Hypothesis + variants defined, not yet exposed to users.         |
| `running`   | Live; variants are being served and metrics collected.           |
| `stopped`   | Halted early (bug, guardrail breach, deprioritized). Resumable.  |
| `concluded` | Decision made. Terminal — never re-open; start a new experiment. |

Transition rules are enforced by `EXPERIMENT_TRANSITIONS` in
`src/lib/experiments/tracking.ts` (and the copy in `track.mjs`). Illegal moves
fail loudly — there is no force flag.

## Record shape

```jsonc
{
  "id": "checkout-button-copy", // lowercase slug, unique
  "hypothesis": "'Start free trial' CTA beats 'Sign up' on checkout",
  "variants": [
    { "name": "control", "weight": 50 },
    { "name": "treatment", "weight": 50 },
  ],
  "status": "running",
  "owner": "growth-team",
  "createdAt": "2025-01-01T00:00:00.000Z",
  "startedAt": "2025-01-03T00:00:00.000Z",
  "concludedAt": "…", // only when concluded
  "stoppedAt": "…", // only when stopped
  "conclusion": {
    // required to conclude
    "result": "win", // win | loss | inconclusive
    "summary": "Treatment beat control by 12% on signups.",
    "decidedAt": "…",
    "metrics": [{ "name": "signup-rate", "value": 0.142, "link": "https://…" }],
  },
}
```

## CLI

```bash
# list / inspect
node scripts/experiments/track.mjs list [--status running] [--owner growth-team] [--json]
node scripts/experiments/track.mjs show --id checkout-button-copy

# lifecycle
node scripts/experiments/track.mjs create \
  --id checkout-button-copy \
  --hypothesis "'Start free trial' CTA beats 'Sign up'" \
  --owner growth-team \
  --variant control:50 --variant treatment:50
node scripts/experiments/track.mjs update --id checkout-button-copy \
  --add-variant treatment-bold:25 --remove-variant treatment
node scripts/experiments/track.mjs transition --id checkout-button-copy --to running
node scripts/experiments/track.mjs transition --id checkout-button-copy --to stopped
node scripts/experiments/track.mjs transition --id checkout-button-copy --to running  # resume

# conclude (result recording — required flags)
node scripts/experiments/track.mjs conclude --id checkout-button-copy \
  --result win \
  --summary "Treatment beat control by 12% on signup conversion." \
  --metric signup-rate \
  --metric-value signup-rate=0.142 \
  --metric-link signup-rate=https://metrics.example/signup

# housekeeping
node scripts/experiments/track.mjs validate
```

Options: `--file <path>` (default `experiments.registry.json`),
`--demo` (throwaway seeded registry in the temp dir — safe for exploring),
`--json`.

`update` only works on `draft` experiments — once running, the hypothesis and
variant mix are frozen so results stay interpretable. To change them, stop the
experiment and create a new one.

## Result recording & metrics linkage

Concluding **requires** a conclusion: `result` (`win` / `loss` /
`inconclusive`), a `summary`, and `decidedAt`. Attach the metrics that drove
the decision via `--metric`, `--metric-value name=value`, and
`--metric-link name=url`.

- `metric.name` should match the metric id in the analytics pipeline
  (feature-flag exposure events: `src/lib/feature-flags/analytics`,
  docs/feature-flags/analytics.md) or the metrics stack (`scripts/metrics/`).
- `metric.value` is the observed value at decision time — a snapshot, not a
  live reference.
- `metric.link` points at the dashboard/report for drill-down.

`inconclusive` is a first-class result: record it when the experiment was
underpowered or contaminated rather than forcing a win/loss.

## Rollback notes

- **Code rollback** is orthogonal: flag-driven experiments roll back via the
  feature-flag system (`src/lib/feature-flags/`, `scripts/feature-flags/`).
  Record the flag key in the experiment `id`/hypothesis or metric links so
  the two can be joined later.
- **Data rollback**: conclusions and metric snapshots are append-only in
  spirit — never edit a `concluded` record. If a conclusion was wrong, add a
  new experiment or correct the analysis in the linked dashboard and note it
  in a follow-up record.
- **Stopped ≠ deleted**: a `stopped` experiment keeps its history and can
  resume (`--to running`) if the blocker clears.
- **Registry conflicts**: the file is the source of truth and is not
  merge-friendly by hand — serialize writes (one operator at a time, or run
  on a single CI/cron job). `validate` catches duplicate ids and malformed
  records.
