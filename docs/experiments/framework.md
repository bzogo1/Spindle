# A/B experiment framework

How to define, run, measure, and stop experiments. Assignment is pure and
deterministic; exposure/metric events flow through a pluggable sink.

| Piece                    | Location                                             |
| ------------------------ | ---------------------------------------------------- |
| Types                    | `src/lib/experiments/types.ts`                       |
| Hashing/bucketing        | `src/lib/experiments/bucket.ts`                      |
| Assignment               | `src/lib/experiments/assign.ts`                      |
| Registry + validation    | `src/lib/experiments/registry.ts`                    |
| Exposure/metric recorder | `src/lib/experiments/analytics.ts`                   |
| Sink implementations     | `src/lib/experiments/sinks.ts`                       |
| Public exports           | `src/lib/experiments/index.ts`                       |
| Assignment preview CLI   | `scripts/experiments/assign-preview.mjs`             |
| Tests                    | `src/lib/experiments/*.test.ts`                      |
| Metric/tracking pipeline | `docs/experiments/tracking.md` (separate workstream) |

## Core concepts

- **Experiment** — a named definition (`ExperimentDefinition`) with variant
  arms (`{ name, weight }`, weights in percent, sum ≤ 100) and lifecycle
  `status`: `draft` → `running` → `stopped`.
- **Subject** — the stable identity being bucketed: user id, session id, or
  an anonymous id. Same subject + same experiment + same `salt` always gets
  the same variant, on server and client, across deploys.
- **Variant** — the arm a subject sees (`"control"`, `"treatment"`, …).
  `variant: null` means "no treatment": not enrolled, experiment inactive,
  outside the date window, or inside the implicit weight remainder. Treat
  `null` as control.
- **Traffic** — `traffic` (0–100, default 100) is the holdout: only that
  percentage of subjects is enrolled; everyone else is excluded entirely.
- **Salt** — optional extra hash input to re-randomise the same population
  for a follow-up experiment without changing the name.

## Defining an experiment

Add entries to the registry in `src/lib/experiments/registry.ts` using
`defineExperiment()` so invalid definitions fail at module load:

```ts
import { defineExperiment } from "@/lib/experiments"

export const experiments = {
  "checkout-cta-copy": defineExperiment({
    name: "checkout-cta-copy",
    description: "Test shorter CTA copy on the checkout button; judge on checkout_completed.",
    primaryMetric: "checkout_completed",
    status: "running",
    variants: [
      { name: "control", weight: 50 },
      { name: "treatment", weight: 50 },
    ],
    // Optional knobs:
    // traffic: 50,                  // enroll only 50% of subjects
    // salt: "v2",                   // re-randomise vs. a prior run
    // startDate: "2025-06-01T00:00:00Z",
    // endDate: "2025-06-15T00:00:00Z",
  }),
} as const satisfies Record<string, ExperimentDefinition>
```

Validation rules (`defineExperiment` throws otherwise): name 1–128 chars,
non-empty description, 1–16 uniquely-named variants, each weight 0–100
finite, weights sum ≤ 100, traffic 0–100, status one of
`draft|running|stopped`.

Weights summing to < 100 leave an implicit unassigned remainder
(`variant: null`, `reason: "unassigned-variant"`) — useful when you want a
control group larger than any single named arm.

## Assigning variants

`assignVariant()` is pure — no env, no I/O — so it is safe in server
components, route handlers, **and** client components:

```ts
import { assignVariant, getExperimentDefinition } from "@/lib/experiments"

const def = getExperimentDefinition("checkout-cta-copy") // registry lookup
const assignment = assignVariant(def!, { subjectId: userId })

// assignment.variant: "control" | "treatment" | null
// assignment.enrolled, assignment.reason explain the outcome
```

Resolution order:

1. `status !== "running"` → `variant: null`, reason `not-running`
2. now outside `[startDate, endDate)` → `variant: null`, `outside-window`
3. enrollment bucket ≥ `traffic`% → `variant: null`, `not-enrolled`
4. variant bucket walks cumulative weights → variant name, or `null` for the
   remainder (`unassigned-variant`)

For ad-hoc experiments (tests, previews) skip the registry and pass the
definition directly — `assignVariant(definition, { subjectId })`.

**Bucketing.** Two independent FNV-1a hashes (same algorithm family as
`src/lib/feature-flags/rollout/hash.ts`, 0–9999 space = 0.01% resolution):

- `enrollment|<salt>|<experiment>|<subject>` decides traffic inclusion
- `assign|<salt>|<experiment>|<subject>` picks the variant arm

Namespacing by experiment and salt means cohorts are uncorrelated across
experiments and re-runs. **Do not change the hash or input format while an
experiment is running** — every subject would reshuffle.

## Recording exposures

Call `recordExperimentExposure()` wherever the assigned variant is actually
applied to the user's experience — once per (experiment, subject) per
session/render, not on mere evaluation:

```ts
import { assignVariant, getExperimentDefinition, recordExperimentExposure } from "@/lib/experiments"

const def = getExperimentDefinition("checkout-cta-copy")
const assignment = assignVariant(def!, { subjectId: userId })

if (assignment.enrolled && assignment.variant) {
  recordExperimentExposure({
    experiment: assignment.experiment,
    subjectId: userId,
    variant: assignment.variant,
    bucket: assignment.bucket, // keep analytics buckets == assignment buckets
  })
}
// render the variant-specific UI…
```

Guarantees (same contract as `src/lib/feature-flags/analytics`):

- Never throws into application code; sink errors (sync or async) are
  swallowed.
- Non-identifying: `subjectId` is hashed with `subjectHash()` (cyrb53,
  experiment-scoped) before reaching a sink. The raw id never leaves the
  module — events carry `subjectHash`, `experiment`, `variant`, `bucket`,
  `environment`, `timestamp`.
- Cheap: one hash + one object allocation per call.

### Sinks

Events go to the sink installed via `setExperimentAnalyticsSink()`:

- **Default** — `console.debug` in non-production, silent in production.
- `createConsoleSink()` — explicit dev sink.
- `createJsonlFileSink(path)` — appends one JSON object per line; server
  only (lazy `node:fs/promises` import). Good for local/dev and file-based
  pipelines.

For production shipping, install an HTTP/batching sink at server startup
(the `createHttpSink` pattern in `src/lib/feature-flags/analytics/sinks.ts`
is the reference implementation — it batches events and POSTs JSON).
`flushExperimentAnalytics()` drains buffered sinks.

## Metrics

`recordExperimentMetric()` emits `experiment_metric` events carrying
`metric` + `value` (default 1) alongside the same hashed subject and
variant, so the tracking pipeline can join exposures to outcomes:

```ts
recordExperimentMetric({
  experiment: "checkout-cta-copy",
  subjectId: userId,
  variant: assignment.variant,
  metric: "checkout_completed", // the definition's primaryMetric
  value: 1,
})
```

Metric definitions, aggregation, and the analysis/reporting pipeline are
covered by the tracking workstream — see `docs/experiments/tracking.md`.
This framework only guarantees that exposures and metric events share
`experiment`, `variant`, `subjectHash`, and `bucket` so they can be joined.

## Running and stopping

- **Start**: set `status: "running"` (the `defineExperiment` default).
  Optionally gate with `startDate`/`endDate` and reduce blast radius with
  `traffic`.
- **Stop**: set `status: "stopped"` (or `draft`). Every subject immediately
  resolves to `variant: null` — no deploy of call sites needed, no reshuffle
  of anyone who was enrolled. Keep the definition in the registry until the
  tracking pipeline no longer needs it for historical joins.
- **Extend/iterate**: bump `salt` (e.g. `"v2"`) to re-randomise the same
  population for a follow-up experiment under the same name, or register a
  new experiment name for a clean cohort.
- **Preview before launch**: `node scripts/experiments/assign-preview.mjs`
  shows deterministic assignments for sample subjects without touching the
  app — see `--help`.

## Invariants to preserve

1. `assignVariant`, `pickVariant`, and the hash helpers are pure — never add
   `process.env`, clocks (except the injectable `now`), or I/O.
2. Variant assignment must stay stable across server/client renders: always
   pass the same `subjectId` (authenticated user id preferred; fall back to
   a stable anonymous/session id — never a per-render random value).
3. Do not modify `bucket.ts` hash inputs while an experiment is live.
4. Raw subject ids must never reach a sink — only `subjectHash`.
