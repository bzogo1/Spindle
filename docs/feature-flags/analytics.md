# Feature flag analytics

How flag exposures and evaluations are recorded, where they go, and how to
report on them.

## Components

| Piece                    | Location                                            |
| ------------------------ | --------------------------------------------------- |
| Recorder + sink registry | `src/lib/feature-flags/analytics/recorder.ts`       |
| Event/sink types         | `src/lib/feature-flags/analytics/types.ts`          |
| Deterministic bucketing  | `src/lib/feature-flags/analytics/bucket.ts`         |
| Sink implementations     | `src/lib/feature-flags/analytics/sinks.ts`          |
| Public exports           | `src/lib/feature-flags/analytics/index.ts`          |
| Report script            | `scripts/feature-flags/report.mjs`                  |
| Tests                    | `src/lib/feature-flags/analytics/analytics.test.ts` |

## Hook point

The flag system lives in `src/lib/feature-flags/` (owned separately). The
analytics module is **export-only**: flag code opts in by calling
`recordFlagExposure()` wherever a flag value is resolved for a subject.
Current resolution sites (as of this writing — re-check if they move):

- **Server**: `getFeatureFlag` / `getFeatureFlags` in
  `src/lib/feature-flags/server.ts`, and `evaluateFlag` /
  `evaluateFlagByName` in `src/lib/feature-flags/evaluate.ts` for direct
  callers.
- **Client**: `useFeatureFlag` in
  `src/components/feature-flags/use-feature-flag.ts` (subject id comes from
  `FeatureFlagsProvider` context or `getAnonymousSubjectId()`).

Inside the flag evaluation function, after the variant/value is decided:

```ts
import { recordFlagExposure } from "@/lib/feature-flags/analytics"

// Inside the flag evaluation function, after the variant/value is decided:
recordFlagExposure({
  flag: "new-dashboard",
  userKey, // opaque per-subject key — hashed before storage
  variant: "treatment", // or null for boolean flags
  value: true,
  kind: "exposure", // "evaluation" if the flag was checked but not applied
  bucket, // the bucket evaluateFlag/rollout actually used, if any
})
```

Recommended call sites:

- **`kind: "exposure"`** — where the resolved value is actually applied to the
  user's experience (the primary metric).
- **`kind: "evaluation"`** — where the flag is evaluated but may not be
  exposed (e.g. a gate that checks eligibility). Comparing the two counts
  shows check-to-exposure drop-off.

`recordFlagExposure` never throws and never blocks: sink failures (sync or
async) are swallowed, so analytics cannot break flag resolution.

Unlike `src/lib/analytics.ts` product analytics, flag events are
operational telemetry — they are **not** consent-gated (they carry no PII,
only flag names, variants, hashed subjects, and timestamps). If a
jurisdiction requires consent for any telemetry, gate the `record` call
sites, not the sink.

### Inputs

| Field         | Notes                                                                                                                                                                                                            |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flag`        | Flag key, 1–128 chars. Required.                                                                                                                                                                                 |
| `userKey`     | Opaque stable per-subject key (user id, session id). **Hashed — never stored or sent raw.**                                                                                                                      |
| `variant`     | Variant label (`"control"`, `"treatment"`, `"on"`…). `null` for boolean flags.                                                                                                                                   |
| `value`       | Evaluated value; must be JSON-serialisable (unserialisable values degrade to a placeholder).                                                                                                                     |
| `kind`        | `"exposure"` (default) or `"evaluation"`.                                                                                                                                                                        |
| `environment` | Defaults to `clientEnv.NODE_ENV`; override for staging/preview splits.                                                                                                                                           |
| `bucketCount` | Bucket space size; default 100 so buckets are percentage points.                                                                                                                                                 |
| `bucket`      | The bucket the flag system used for the decision (e.g. `hashToBucket(subjectId)` from `../evaluate.ts`). Pass it so reported buckets match assignment buckets; otherwise a diagnostic cyrb53 bucket is computed. |

## Event shape

Each event is one JSON object (this is what lands in JSONL/HTTP sinks):

```json
{
  "event": "flag_exposure",
  "kind": "exposure",
  "flag": "new-dashboard",
  "variant": "treatment",
  "value": true,
  "bucket": 37,
  "bucketCount": 100,
  "subjectHash": "9f2c…16 hex chars",
  "environment": "production",
  "timestamp": "2025-01-01T12:00:00.000Z"
}
```

### Privacy

- `userKey` is hashed twice (cyrb53, different seeds) into a 16-char
  `subjectHash`, scoped per flag. It supports unique-subject counting and
  stickiness checks but is not reversible and cannot be joined to a person.
- No emails, names, IPs, or message content belong in `value`/`variant`.
- Bucketing: when the caller passes `bucket` it is the flag system's own
  assignment bucket (FNV-1a based — `hashToBucket` in `../evaluate.ts`,
  `hashBucket` in `../rollout/hash.ts`); otherwise a flag-namespaced cyrb53
  diagnostic bucket is computed. `subjectHash` is always flag-scoped, so the
  same subject gets independent hashes across flags.

## Sinks

The recorder routes events to one active sink. Default behaviour mirrors
`src/lib/analytics.ts`: `console.debug` outside production, silent in
production until a sink is installed.

```ts
import {
  createJsonlFileSink,
  createHttpSink,
  setFlagAnalyticsSink,
} from "@/lib/feature-flags/analytics"

// Server startup (Node only):
setFlagAnalyticsSink(createJsonlFileSink("/var/log/spindle/flag-events.jsonl"))

// Or POST batches to a collector:
setFlagAnalyticsSink(createHttpSink("https://collector.example.com/flags"))

// Restore default:
setFlagAnalyticsSink(null)
```

| Sink                               | Runtime        | Notes                                                                                                                |
| ---------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------- |
| `createConsoleSink()`              | anywhere       | One `console.debug` line per event.                                                                                  |
| `createJsonlFileSink(path, opts?)` | Node           | Appends one JSON object per line; serialised writes; optional `onError` fallback path. `node:fs` is imported lazily. |
| `createHttpSink(url, opts?)`       | browser + Node | Batches events (`batchSize`, default 20) and POSTs `{ events: [...] }`; `flush()` drains. Failures swallowed.        |

Custom sinks implement `FlagAnalyticsSink` (`record(event)`, optional
`flush()`). `flushFlagAnalytics()` drains the active sink — call it on
shutdown or before serverless freeze.

## Reporting

`scripts/feature-flags/report.mjs` reads the JSONL stream and emits a
markdown and/or JSON report: per-flag event counts, unique subjects, variant
distribution, and actual-vs-configured rollout percentages.

```sh
# Markdown to stdout
node scripts/feature-flags/report.mjs --input /var/log/spindle/flag-events.jsonl \
  --config config/feature-flags.json

# JSON output + files
node scripts/feature-flags/report.mjs --input events.jsonl --config flags.json \
  --format both --out-md report.md --out-json report.json

# Synthetic demo data (no input file needed)
node scripts/feature-flags/report.mjs --demo
```

Config format (`--config`):

```json
{
  "flags": {
    "new-dashboard": { "type": "rollout", "rolloutPercent": 25, "variant": "on" },
    "checkout-flow": {
      "type": "multivariate",
      "variants": { "control": 60, "treatment": 40 }
    }
  }
}
```

- **rollout**: actual = share of unique subjects whose _latest_ assignment
  equals `variant` (default `"on"`); reported as a percentage-point delta vs
  `rolloutPercent`.
- **multivariate**: actual = share of unique subjects per variant vs
  configured weights; unexpected observed variants are listed.

"Latest assignment" means the event with the newest timestamp per
`subjectHash` — re-evaluations don't double-count subjects.

## Tests

`analytics.test.ts` covers bucketing determinism/range/distribution,
flag-namespaced independence, subject-hash properties, event shape,
input validation, sink error swallowing, and the JSONL/HTTP sinks.
Run with `npm run test:unit -- src/lib/feature-flags`.

## Operational notes

- Point the JSONL sink at a path that exists (the sink won't create parent
  directories; use `onError` for a fallback path).
- Rotate the JSONL file like any log; the report script tolerates partial
  last lines and non-`flag_exposure` events in the stream.
- For high volume, prefer `createHttpSink` batching or a dedicated collector;
  JSONL is fine for single-node deployments.
- Do not add PII to events — there is no scrubbing layer on this path.
  `value` should carry only aggregate-safe data (booleans, variant labels,
  small enums).
