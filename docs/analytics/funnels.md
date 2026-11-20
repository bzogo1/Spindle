# Funnel analysis

Ordered step-conversion analysis over product-analytics events: where users
enter a flow, where they drop off, how long they spend between steps, and
what fraction completes end-to-end.

## Components

| Piece         | Path                                  | Purpose                                                                                     |
| ------------- | ------------------------------------- | ------------------------------------------------------------------------------------------- |
| Funnel engine | `src/lib/funnel/index.ts`             | Typed step matchers, funnel definitions, pure analysis functions, deterministic demo events |
| Unit tests    | `src/lib/funnel/index.test.ts`        | Vitest coverage for matching, ordering, windows, conversions, demo data                     |
| CLI report    | `scripts/analytics/funnel/report.mjs` | JSONL → text/JSON funnel report (`--demo`, `--file`, `--stdin`, `--funnel`, `--format`)     |

The engine is intentionally dependency-free and import-free so
`report.mjs` can import the `.ts` file directly — Node ≥22.18 strips types
natively. Keep `index.ts` erasable-TS-only (no enums, no parameter
properties) and do not add imports to it.

## Event model

Funnels operate on the event shape produced by `src/lib/analytics.ts`
(`StoredAnalyticsEvent` is a compatible superset):

```json
{
  "name": "page_view",
  "type": "page_view",
  "path": "/sign-up",
  "feature": "project_created",
  "endpoint": "/api/auth/signup",
  "props": { "anonymousId": "…" },
  "timestamp": 1700000000000,
  "actorId": "user:abc"
}
```

- **Actor identity**: `actorId` → `anonymousId` → `props.anonymousId`, in
  that order. Events with no identifier are skipped and counted in
  `skippedEvents` — they are never merged into a shared "anonymous" actor.
- **Ordering**: an actor "reaches" step _i_ when they have a matching event
  at/after the timestamp matched for step _i−1_. Repeated events are fine;
  the earliest ordered match wins.
- **`windowMs`**: when a funnel definition sets it, every step must complete
  within that span of the first matched step. Journeys that expire mid-funnel
  count as drop-off at the step they were on.

## Funnel catalog

Defined in `FUNNELS` (`src/lib/funnel/index.ts`), inferred from app routes
(`src/app/(auth)`, `src/app/(app)`, `src/app/api/auth/*`).

| id                    | Flow                 | Steps                                                                            | Window |
| --------------------- | -------------------- | -------------------------------------------------------------------------------- | ------ |
| `signup_activation`   | Signup → activation  | sign-up page → `/api/auth/signup` → email verify → first project → app dashboard | 7d     |
| `passwordless_signin` | Passwordless sign-in | sign-in page → magic-link request → link verify → app                            | 1h     |
| `invite_join`         | Invite → join        | invite sent → link opened → accepted → team screen                               | 14d    |
| `project_creation`    | Project creation     | projects list → project created → project opened                                 | 1d     |
| `feedback_submission` | Feedback             | feedback opened → `/api/feedback` POST                                           | 1d     |

Each step is an `anyOf` list of `StepMatcher`s. A matcher ANDs the fields it
specifies: `names` (exact event names), `type`, `path` (exact, top-level or
`props.path`), `pathPrefix`, `endpoint` (exact), `feature`, and `props`
(subset equality). Matchers deliberately accept **both** explicit event
names (`signup_submitted`, emitted via `trackEvent`) **and** the
`api_call`/`page_view` shapes `/api/analytics` already records, so funnels
light up with whatever instrumentation exists.

## Instrumentation guide

Client-side, use the consent-gated helpers in `src/lib/analytics.ts`:

```ts
import { trackEvent, trackFeatureUse, trackPageView } from "@/lib/analytics"

trackPageView("/sign-up") // page_view + path
trackFeatureUse("project_created", { projectId })
trackEvent("invite_sent", { role: "editor" })
```

Server-side producers call `recordAnalyticsEvents(events, { userId })` —
events land in the same store `/api/analytics` reads, so
`GET /api/analytics/summary` and funnel tooling see one stream.

When adding a new funnel:

1. Add a `FunnelDefinition` to `FUNNELS` (or pass a custom one to
   `analyzeFunnel`/`analyzeFunnels`).
2. Prefer `anyOf` matchers that accept the natural `page_view`/`api_call`
   shape first, with explicit event names as a fallback.
3. Set `windowMs` to the longest plausible completion time — too tight and
   real users look like drop-off; too loose and stale re-entries inflate
   conversion.
4. Extend `generateDemoFunnelEvents`'s `DEMO_SURVIVAL` table so `--demo`
   keeps producing plausible numbers.

## Reading results

`FunnelReport` per funnel:

- `totalActors` — distinct actors with ≥1 event matching any step
  (includes actors who only _entered_ a later step out of order).
- Per step: `reached` (ordered completions), `entered` (any matching event,
  order ignored), `conversionFromPrevious`, `conversionFromTop`,
  `dropOff`/`droppedHere`, `medianTimeToNextMs`/`avgTimeToNextMs` (time
  between this step and the next, over actors who did both).
- `overallConversion` — `reached[last] / reached[0]`.

Interpretation notes:

- `entered > reached` on a step means people hit that step without having
  completed the ordered prefix — investigate instrumentation or genuine
  re-entry.
- `conversionFromPrevious = null` means the denominator was 0 (no data),
  not 0% conversion.
- Time-to-next on the last step is always null — there is no next step.
- Cross-funnel name collisions (e.g. `project_created` appears in two
  funnels) inflate `totalActors` slightly; `reached` stays correct because
  ordering is enforced.

## CLI

```bash
# All catalog funnels over synthetic data
node scripts/analytics/funnel/report.mjs --demo

# Real events (JSONL; one event per line or {"events":[...]} batches)
node scripts/analytics/funnel/report.mjs --file data/analytics/events.jsonl
cat events.jsonl | node scripts/analytics/funnel/report.mjs --stdin

# One funnel, JSON output for downstream tooling
node scripts/analytics/funnel/report.mjs --demo --funnel signup_activation --format json
```

Exit codes: `0` ok, `2` usage error (bad flag, unknown funnel/format).
