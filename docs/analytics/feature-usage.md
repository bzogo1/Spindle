# Feature usage analytics

How feature usage is recorded, aggregated, and reported. This complements two
adjacent systems — do not confuse them:

| System                       | Location                                      | Purpose                                                       |
| ---------------------------- | --------------------------------------------- | ------------------------------------------------------------- |
| Product analytics            | `src/lib/analytics.ts`, `POST /api/analytics` | Consent-gated page views, feature uses, API calls (in-memory) |
| Feature flag telemetry       | `src/lib/feature-flags/analytics/`            | Flag exposures/evaluations, rollout validation (JSONL/HTTP)   |
| **Feature usage (this doc)** | `src/lib/usage/`, `scripts/analytics/usage/`  | Per-feature usage events → counts, adoption, DAU-per-feature  |

Flag analytics answers "was the flag shown to whom"; usage analytics answers
"who actually used which product feature, how often, and how adoption trends
day over day".

## Event shape

One JSON object per usage event, one per line in JSONL streams:

```json
{
  "kind": "feature_use",
  "feature": "new-dashboard",
  "subject": "user:u_123",
  "timestamp": 1768000000000,
  "properties": { "source": "sidebar" }
}
```

| Field        | Required | Notes                                                                                                                                                                                                |
| ------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`       | yes      | Always `"feature_use"`.                                                                                                                                                                              |
| `feature`    | yes      | Stable feature key: lowercase kebab-case, ≤128 chars, no whitespace. See the catalog below.                                                                                                          |
| `subject`    | yes      | Opaque id: `user:<uid>` signed in, `anon:<id>` anonymous (per-tab id from `src/lib/analytics.ts` or a hash), `mock:<email>` for mock-auth sessions (`notificationPrincipalFromRequest`). ≤128 chars. |
| `timestamp`  | yes      | Epoch **milliseconds**, UTC.                                                                                                                                                                         |
| `properties` | no       | JSON-serialisable, ≤4 KB, aggregate-safe only (enum labels, counts, durations). Never PII.                                                                                                           |

### Accepted ingest aliases

`parseFeatureUsageEvent` (and the report script) also accept the flattened
shape produced by the existing `/api/analytics` ingest route, normalising it
into the canonical event:

```json
{
  "type": "feature_use",
  "feature": "docs-search",
  "anonymousId": "uuid",
  "props": { "…": "…" },
  "timestamp": 1768000000000
}
```

`anonymousId`/`userId` without a `user:`/`anon:`/`mock:` prefix are normalised
to `anon:<value>`.

### Privacy

- `subject` is an opaque identifier only. Never put emails, names, IPs, or
  message content in `subject` or `properties`. (The one sanctioned exception
  is `mock:<email>` from mock auth — a dev/demo mode only; never emit it in
  production.)
- `properties` should carry aggregate-safe context: `{ "source": "header" }`,
  `{ "resultCount": 12 }`, `{ "durationMs": 340 }`.
- Usage events are product telemetry, not operational flag telemetry — if
  your jurisdiction requires consent for product analytics, emit them through
  the consent-gated `trackFeatureUse()` in `src/lib/analytics.ts` rather than
  a raw sink.

## Library API (`src/lib/usage/`)

| Export                         | File           | Purpose                                                                 |
| ------------------------------ | -------------- | ----------------------------------------------------------------------- |
| `FeatureUsageEvent`            | `events.ts`    | Canonical event type.                                                   |
| `createFeatureUsageEvent()`    | `events.ts`    | Validating factory; returns `null` on bad input.                        |
| `parseFeatureUsageEvent()`     | `events.ts`    | Validates unknown JSON (canonical or ingest shape) → event or `null`.   |
| `parseFeatureUsageEventLine()` | `events.ts`    | Parses one JSONL line; skips blanks/malformed.                          |
| `countFeatureUsage()`          | `aggregate.ts` | Per-feature event + unique-subject counts.                              |
| `computeAdoptionRates()`       | `aggregate.ts` | Unique subjects per feature ÷ subject universe (explicit or in-stream). |
| `computeDailyActiveUsers()`    | `aggregate.ts` | DAU-per-feature per UTC day.                                            |
| `computeUsageTotals()`         | `aggregate.ts` | Events / unique subjects / feature counts.                              |
| `summarizeUsage()`             | `aggregate.ts` | All of the above in one call.                                           |
| `filterEventsByWindow()`       | `aggregate.ts` | `[start, end)` epoch-ms window filter.                                  |
| `utcDayStart()`                | `aggregate.ts` | UTC midnight epoch ms, `daysAgo` days back.                             |

All aggregation functions are pure: array in, plain data out. Tests live in
`src/lib/usage/usage.test.ts` (`npm run test:unit -- src/lib/usage`).

## Trackable feature catalog

Feature keys are **stable identifiers** — never rename a key once events are
being collected; add a new key instead. The catalog is derived from the
feature-flag registry (`src/lib/feature-flags/flags.ts`) and the app routes
(`src/app/**/page.tsx`, `src/app/api/**/route.ts`).

### Flag-gated features

Use the flag name as the feature key so flag analytics and usage analytics
join cleanly.

| Feature key       | Flag / source                        | Where it surfaces                                     |
| ----------------- | ------------------------------------ | ----------------------------------------------------- |
| `new-dashboard`   | flag `new-dashboard`                 | Experimental dashboard shell (`/dashboard`, `/app`).  |
| `realtime-collab` | flag `realtime-collab` (25% rollout) | Collaborative editing presence in project files/chat. |
| `docs-search-v2`  | flag `docs-search-v2`                | New docs search index (`/docs`, docs search UI).      |

### Route-level product features

Emit one event per meaningful interaction (open, run, save — not per render).

| Feature key           | Surface (route / component area)                           | Suggested `properties`                     |
| --------------------- | ---------------------------------------------------------- | ------------------------------------------ |
| `agent-run`           | `/app/agent`, `/app/agent/[runId]`, `/projects/[id]/agent` | `{ runId? }` — never prompt content        |
| `agent-chat`          | `/app/chat`, `/projects/[id]/chat`                         | `{ projectId? }`                           |
| `automations`         | `/app/automations`, automation builder components          | `{ action: "create"\|"run"\|"toggle" }`    |
| `files-browser`       | `/app/files`, `/projects/[id]/files`                       | `{ action: "open"\|"upload"\|"delete" }`   |
| `lab-snapshots`       | `/app/lab`, `/projects/[id]/lab`, `(site)/lab`             | `{ action: "capture"\|"diff"\|"restore" }` |
| `search-insights`     | `/app/search-insights`                                     | `{ queryLength }` (not the query itself)   |
| `docs-search`         | docs search UI (`docs-search.tsx`)                         | `{ results: n }`, `{ zeroResults: bool }`  |
| `notifications-inbox` | `/dashboard/notifications`, `/app/account/notifications`   | `{ category }`                             |
| `cohorts`             | `/app/cohorts`                                             | `{ action }`                               |
| `feedback`            | `/app/feedback`, feedback components                       | `{ kind }`                                 |
| `nps`                 | `/app/nps`                                                 | `{ score }`                                |
| `collaboration`       | collab cursors/editor (`src/components/collab/**`)         | `{ sessionId? }`                           |
| `offline-mode`        | PWA offline (`src/lib/pwa/**`)                             | `{ online: bool }`                         |
| `file-tree`           | file tree components (`src/components/file-tree/**`)       | `{ depth }`                                |
| `changelog`           | `/changelog`, `/changelog/[...slug]`                       | `{ slug? }`                                |
| `referral`            | `/referral`, `/r/[code]`                                   | `{ code? }`                                |
| `site-contact`        | `/contact` form                                            | `{ topic }`                                |
| `newsletter`          | newsletter signup                                          | —                                          |

### API-surface features

For API-heavy features, emit from the client after a successful call (or from
the route handler with the session principal as `subject`):

| Feature key         | Endpoint(s)                                                  |
| ------------------- | ------------------------------------------------------------ |
| `api-analytics`     | `POST /api/analytics` (already covered by product analytics) |
| `api-notifications` | `/api/notifications`, `/api/notifications/stream`, `/digest` |
| `api-activity`      | `/api/activity`, `/api/activity/stream`                      |
| `api-auth-2fa`      | `/api/auth/2fa/*`                                            |
| `api-cohorts`       | `/api/cohorts`                                               |
| `api-feedback`      | `/api/feedback`                                              |
| `api-nps`           | `/api/nps`                                                   |
| `api-profile`       | `/api/profile`                                               |

When adding a feature, add its key here **and** emit events — an unused
catalog entry is fine; an untracked shipped feature is a gap.

## Instrumentation guide

### Client (React)

Prefer the consent-gated `trackFeatureUse()` in `src/lib/analytics.ts` for
browser code — it already handles consent, queueing, and POSTs to
`/api/analytics`, which stores `feature_use` events retrievable via
`getAnalyticsSummary`. To feed the JSONL/usage pipeline instead (or in
addition), build an event and hand it to your sink:

```ts
import { createFeatureUsageEvent } from "@/lib/usage"

const event = createFeatureUsageEvent({
  feature: "automations",
  subject: `user:${userId}`, // or `anon:${anonymousId}` when signed out
  properties: { action: "run" },
})
if (event) appendUsageEvent(event) // your JSONL/batch sink
```

`createFeatureUsageEvent` never throws; it returns `null` for invalid input
(empty feature, subject without a `user:`/`anon:`/`mock:` prefix, non-finite
timestamp, oversized properties).

### Server (route handlers / server actions)

Resolve the session principal the same way `/api/analytics/summary` does
(`notificationPrincipalFromRequest`) and use `user:<uid>` / `mock:<email>` as
the subject. If the deployment needs durable storage, mirror the flag
analytics pattern: a JSONL file sink or batched HTTP POST to a collector —
see `docs/feature-flags/analytics.md` for sink implementations you can reuse
(`createJsonlFileSink`, `createHttpSink`).

### Event transport

There is no dedicated usage-ingest endpoint yet. Until one exists, options in
order of preference:

1. Reuse `POST /api/analytics` with `type: "feature_use"` and `feature` set —
   events land in the in-memory store and `parseFeatureUsageEvent` accepts
   that shape directly when exporting.
2. Write JSONL server-side to `data/usage/events.jsonl` (the report default).
3. Batch POST to an external collector, then export to JSONL for reports.

### Reporting

```sh
# Markdown report (default)
node scripts/analytics/usage/report.mjs --file data/usage/events.jsonl

# JSON output
node scripts/analytics/usage/report.mjs --file events.jsonl --json

# Both formats, written to files
node scripts/analytics/usage/report.mjs --file events.jsonl --format both \
  --out-md usage.md --out-json usage.json

# Adoption against an explicit universe (e.g. total signups = 500)
node scripts/analytics/usage/report.mjs --file events.jsonl --total-subjects 500

# Synthetic demo data, no input file needed
node scripts/analytics/usage/report.mjs --demo
```

The report emits: totals (events, unique subjects, features), per-feature
usage counts with adoption rates, and DAU-per-feature per UTC day. Malformed
lines and non-`feature_use` events are skipped and counted on stderr. The
aggregation logic mirrors `src/lib/usage/aggregate.ts` — the vitest suite
pins the semantics; keep the `.mjs` copy in sync when changing either.

## Operational notes

- Feature keys are forever: renaming breaks time-series continuity. Deprecate
  by stopping emission, not by renaming.
- Keep `properties` small and low-cardinality; the store caps serialized
  properties at 4 KB and drops oversized payloads.
- DAU buckets are UTC calendar days — a subject active at 23:59 and 00:01
  counts on two days.
- Adoption rate denominator defaults to distinct subjects **in the stream**;
  pass `--total-subjects` (or `totalSubjects` to `computeAdoptionRates` /
  `summarizeUsage`) for a true install-base adoption figure.
