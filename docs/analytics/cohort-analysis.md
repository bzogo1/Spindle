# Cohort analysis

Acquisition-cohort retention: group users by the week they signed up, then
measure what percentage of each cohort is still active in each subsequent
week (W0 = signup week, W1 = the following week, …).

## Components

| Piece          | Path                                              | Role                                                                                                                                                                                                          |
| -------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core algorithm | `scripts/analytics/cohorts/cohort-core.mjs`       | Dependency-free ES module: record normalization, retention matrix, text/markdown renderers, demo data. Shared verbatim by the CLI and the library so they cannot drift.                                       |
| CLI report     | `scripts/analytics/cohorts/report.mjs`            | `node scripts/analytics/cohorts/report.mjs --demo \| --file <path> \| --stdin [--json] [--markdown] [--format text,json,markdown] [--weeks n] [--max-cohorts n] [--now <iso>]`                                |
| Typed facade   | `src/lib/cohort-analysis/cohort-analysis.ts`      | Re-exports the core with TypeScript types: `classifyRecord`, `recordsToUsers`, `computeRetentionMatrix`, `analyzeRecords`, `formatTextReport`, `formatMarkdownReport`, `generateDemoRecords`, `weekStartUtc`. |
| Tests          | `src/lib/cohort-analysis/cohort-analysis.test.ts` | 17 vitest cases covering week math, record classification, bucketing, matrix semantics, formatting, and demo determinism.                                                                                     |
| Product API    | `src/lib/cohorts.ts` → `GET /api/cohorts`         | **Read-only, owned elsewhere.** See "Relationship to `src/lib/cohorts.ts`" below.                                                                                                                             |

## Methodology

1. **Normalize records** (`recordsToUsers`). Each input record is classified
   as a _signup_, an _activity event_, or a _pre-aggregated user_ (see
   `classifyRecord` for the accepted field aliases — `userId`/`user_id`/`uid`,
   `at`/`occurred_at`/`created_at`, `type`/`event_name`, etc.). Signups and
   pre-aggregated users are collected first; activity events are then bucketed
   into week offsets relative to each user's signup week.
2. **Group by signup week** (`computeRetentionMatrix`). Users are bucketed by
   the Monday 00:00 UTC of their `signedUpAt` week (ISO-8601 week dating,
   matching `weekStartUtc` in `src/lib/cohorts.ts`). Cohorts are emitted
   most-recent-first, capped at `--max-cohorts`.
3. **Compute retention.** For cohort _i_ and week offset _w_, retention =
   `activeUsers / cohortSize`, where a user is active when their event count
   for that offset is > 0. A cell is `complete: false` with
   `retention: null` while its week has not fully elapsed — provisional
   numbers are never reported as final.
4. **Retention curve.** `report.curve[w]` pools `activeUsers / cohortSize`
   across every cohort whose cell for offset _w_ is complete, giving a single
   "what fraction of all users acquired remain active in week N" series.

### Edge-case rules

- Activity timestamped _before_ the signup week (clock skew) clamps to W0.
- Events beyond the `--weeks` window are dropped.
- Activity with no matching signup record is excluded and counted in
  `totals.excludedUsers` (per unique user id).
- Unparseable timestamps and unclassifiable rows are skipped and surfaced in
  `report.input` diagnostics (`unclassifiable`, `invalidTimestamps`,
  `orphanActivity`).
- Signup-only users count toward cohort size with 0% retention — they are
  real acquisitions that never activated.

## Reading the report

Text output is a tab-separated grid; `--markdown` emits a GitHub-flavored
table plus a "Retention curve" section and an input-diagnostics footer.
`--json` emits the full `CohortAnalysisReport` object.

```
Cohort      Size  W0    W1    W2    W3
Nov 9       6     100%  —*    —*    —*
Nov 2       10    70%   50%   —*    —*
Oct 26      5     80%   80%   60%   —*
```

- Each row is one acquisition week; each column is weeks since signup.
- `—*` marks a week still in progress (retention is provisional and excluded
  from the curve). `—` alone means the cohort has no data path to that week.
- Compare **columns**, not rows, for product health: a healthy product shows
  W1/W2 retention that stops falling. A "smile" curve (W2+ > W1) usually means
  a returning-user loop, not noise.
- `avgActiveWeeks` counts only fully-elapsed weeks, so it is comparable
  across cohorts of different ages.

## Input formats

`--file` accepts newline-delimited JSON or a single JSON document (top-level
array, or an object wrapping records under `records`/`users`/`signups`/
`events`/`rows`/`data`). `--demo` feeds deterministic synthetic records
(mulberry32 seed `0xc0ffee`, 48 users over 14 signup weeks) so docs and CI
runs are reproducible.

Accepted record shapes (first match wins):

```jsonl
{"type":"signup","userId":"u1","at":"2026-11-10T09:00:00Z"}
{"user_id":"u2","created_at":"2026-11-11T08:00:00Z"}
{"type":"activity","userId":"u1","at":"2026-11-12T10:00:00Z","count":2}
{"user_id":"u1","occurred_at":"2026-11-19T10:00:00Z","event_name":"page_view"}
{"id":"u1","signedUpAt":"2026-11-10T09:00:00Z","weeklyActivity":[3,1,0]}
{"id":"u2","signedUpAt":"2026-11-10T09:00:00Z","weekly_activity":{"0":1,"2":5}}
```

## Relationship to `src/lib/cohorts.ts`

`src/lib/cohorts.ts` (read-only) powers `GET /api/cohorts` inside the app.
It consumes a fixed-shape `CohortUserInput[]` (`{ id, signedUpAt,
weeklyActivity }`) and currently runs on `generateDemoCohortUsers` because no
user/activity datastore exists yet. Its pure functions (`weekStartUtc`,
`buildCohortReport`) are data-source agnostic.

This module is the offline/offline-pipeline counterpart:

- **Same semantics.** Monday-UTC signup weeks, W0-based activity offsets,
  `retention: null` + `complete: false` for in-progress weeks, most-recent-
  first cohort ordering, and the same `avgActiveWeeks`/`inactiveLatestWeek`
  definitions — so numbers from the CLI and from `/api/cohorts` are
  directly comparable.
- **Different input.** `cohorts.ts` takes pre-aggregated per-user weekly
  counts; this module additionally accepts raw signup/activity records
  (what a DB export or event log actually contains) and normalizes them.
- **Extra outputs.** Adds the pooled retention curve, per-input diagnostics,
  and text/markdown rendering for reports and runbooks.
- **Single implementation.** The algorithm lives once in
  `cohort-core.mjs`; `src/lib/cohort-analysis/cohort-analysis.ts` is a typed
  facade, so library and CLI never diverge. When a real user/activity store
  lands, wire its rows into `recordsToUsers` (or keep feeding
  `CohortUserInput[]` to `buildCohortReport`) — the math is unchanged.

## Running the tests

```bash
npx vitest run src/lib/cohort-analysis/cohort-analysis.test.ts
node scripts/analytics/cohorts/report.mjs --demo --markdown
```
