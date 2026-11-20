# Business metrics

Top-level business metrics for the Spindle research workspace: signups,
activation, a retention proxy, engagement, feature adoption, and a
paid-conversion proxy.

## Components

| Piece                        | Location                              |
| ---------------------------- | ------------------------------------- |
| Metric catalog + computation | `src/lib/metrics/business.ts`         |
| Unit tests                   | `src/lib/metrics/business.test.ts`    |
| Offline report CLI           | `scripts/metrics/business/report.mjs` |
| This document                | `docs/analytics/business-metrics.md`  |

The computation module is pure and data-source agnostic — it takes
normalized signup and analytics-event records and returns a report. The CLI
reads JSONL exports and renders text / JSON / Markdown.

## Metric catalog

| Metric                       | Definition                                                                                                              | Source                                                                                        | Target                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Signups**                  | New accounts in the window, with a daily series                                                                         | `users.created_at` (Prisma `User` model, `prisma/schema.prisma`) or a signups JSONL export    | Growth-plan dependent — no fixed target                                               |
| **Active users (DAU / WAU)** | Distinct subjects (`userId`, else `anonymousId`) with ≥1 analytics event in the trailing 1 or 7 days                    | `/api/analytics` event store (`src/lib/analytics.ts`: `page_view`, `feature_use`, `api_call`) | No target set; WAU/MAU stickiness >20% is a common SaaS bar                           |
| **Activation rate**          | Share of users ≥ `activationWindowDays` (default 7) past signup who recorded a non-`page_view` event within that window | `users.created_at` joined to analytics events by `userId`                                     | Baseline first, then set per onboarding work                                          |
| **Week-1 retention (proxy)** | Share of the fully-observable cohort (signup ∈ [windowStart−7d, now−14d]) with any event on days 7–14 after signup      | Same join as activation                                                                       | Proxy only — see honesty notes                                                        |
| **Engagement**               | Total events ÷ distinct active subjects, split by event type                                                            | Analytics event store                                                                         | n/a                                                                                   |
| **Feature adoption**         | Features ranked by unique subjects (`props.feature` on `feature_use` events)                                            | Analytics event store                                                                         | n/a — guides onboarding/docs priorities                                               |
| **Paid conversions (proxy)** | Count of events named `checkout_completed`, `subscription_started`, `plan_upgraded`, or `purchase`, ÷ signups           | Analytics event store (name match)                                                            | n/a — **billing is not wired** (`src/lib/pricing.ts`: Team/Enterprise are contact-us) |

### Honesty notes

- **Activation and retention are proxies.** They measure analytics activity,
  not verified outcomes. There is no user-activity datastore yet —
  `src/lib/cohorts.ts` documents the same constraint for cohort analysis.
- **No revenue yet.** There is no payment processor and no billing table, so
  the conversion metric is a name-match proxy over analytics events and is
  marked `available: false` / `billingWired: false` in the report. When
  billing lands, replace the proxy with real subscription records.
- **Anonymous traffic** counts toward DAU/WAU via `anonymousId` but can never
  join the signup-based metrics (activation, retention, conversion rate).
- The `/api/analytics` store is **in-memory and per-process** — a multi-instance
  deploy aggregates only its own slice. Treat reports as directional until a
  durable event sink exists.

## Running the report

```bash
# Demo mode — deterministic synthetic data, no inputs needed
node scripts/metrics/business/report.mjs --demo

# Real data — JSONL exports (see "Producing inputs" below)
node scripts/metrics/business/report.mjs \
  --signups data/business/signups.jsonl \
  --events  data/business/events.jsonl \
  --days 30 --format markdown --out-md reports/business.md

# JSON for piping into other tools
node scripts/metrics/business/report.mjs --demo --format json
```

Options: `--days <n>` (window, default 30), `--activation-days <n>` (default 7),
`--format text,json,markdown`, `--out-md`, `--out-json`. Missing input files
warn and are treated as empty — partial data still produces a report.

### Input formats (one JSON object per line)

`signups.jsonl` — any of `id`/`userId`/`email` plus
`signedUpAt`/`createdAt`/`timestamp`:

```json
{ "id": "user-123", "signedUpAt": "2026-01-01T12:00:00Z" }
```

`events.jsonl` — the `/api/analytics` stored-event shape
(`StoredAnalyticsEvent` in `src/lib/analytics.ts`):

```json
{
  "type": "feature_use",
  "name": "lab",
  "feature": "lab",
  "userId": "user:user-123",
  "anonymousId": "…",
  "timestamp": 1767225600000,
  "receivedAt": 1767225600100
}
```

`props.feature` is accepted as a fallback for `feature`. ISO-8601 timestamps
work everywhere epoch-ms does. Malformed lines are skipped with a warning.

### Producing inputs

- **Signups**: export `users.id, users.created_at` from Postgres, e.g.
  `psql "$DATABASE_URL" -c "COPY (SELECT id, created_at FROM users) TO STDOUT" `
  wrapped one JSON object per line, or add a small exporter script when a
  durable analytics pipeline exists.
- **Events**: the analytics store is in-memory today, so there is no built-in
  exporter. When a JSONL/HTTP sink lands for product analytics (the flag
  system already has one — `createJsonlFileSink` in
  `src/lib/feature-flags/analytics/sinks.ts`, see
  `docs/feature-flags/analytics.md`), point `--events` at that file. The
  shapes are intentionally compatible.

## Dashboard tie-in

- **`/api/analytics/summary`** (`src/app/api/analytics/summary/route.ts`)
  already serves per-principal event totals/daily series/top events for the
  in-app dashboard. The business report is the _cross-source_ view on top:
  it joins signups (DB) with events and adds cohort metrics the summary
  endpoint doesn't compute.
- **Deploy dashboard** (`docs/dashboards/deploy-metrics.md`) is the pattern
  to follow for a rendered dashboard: `scripts/deploy/metrics/collect.mjs`
  emits `metrics.json` + a self-contained `index.html`. A future
  `scripts/metrics/business/` HTML renderer could consume `--format json`
  output the same way.
- **Prometheus/log metrics** (`scripts/metrics/log-metrics.mjs`,
  `docs/observability/`) cover infra signals; business metrics stay out of
  the scrape path deliberately — they need joins across sources, not log
  aggregation.
- **Feature-flag analytics** (`docs/feature-flags/analytics.md`) is a
  separate operational stream (`flag_exposure` events). Do not mix it into
  business metrics; use `scripts/feature-flags/report.mjs` for rollout
  actuals.

## Related work owned by parallel efforts

Funnel analysis, cohort retention tables, and A/B test readouts are covered
by sibling docs/scripts — this file owns only the top-level business metric
set above.
