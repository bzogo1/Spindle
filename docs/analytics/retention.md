# Retention analysis

Day-granularity retention metrics over raw user activity events — N-day
retention, churn, DAU/WAU/MAU activity windows, and a pooled survival curve.

- **Pure logic:** `src/lib/retention.ts` (unit-tested in
  `src/lib/retention.test.ts`). All functions are pure; `now` is injectable.
- **CLI report:** `scripts/analytics/retention/report.mjs`
- **Related:** `src/lib/cohorts.ts` does _weekly_ signup-cohort retention
  from pre-bucketed `weeklyActivity` counts. This module is the
  event-stream counterpart: feed it `{ userId, timestamp }` events and it
  buckets days itself.

## Data source honesty

There is no production user/activity datastore yet (same caveat as
`cohorts.ts`). Until one exists:

- `report.mjs --demo` uses `generateDemoActivityEvents()` — a deterministic
  (seeded PRNG) synthetic population spread over the last 60 days.
- `report.mjs --file events.jsonl` reads a JSONL export. One event per line:

  ```json
  { "userId": "u-123", "timestamp": 1763558400000 }
  ```

  `timestamp` may be epoch milliseconds or an ISO-8601 string. Aliases
  `user_id`/`user` and `ts`/`time` are also accepted. Malformed lines are
  skipped with a warning; events missing a `userId` or with a non-finite
  timestamp are counted under `excludedEvents`.

When a real event source lands (e.g. the `/api/analytics` ingest store),
export its rows to JSONL and run `--file`; no code changes are needed.

## Metric definitions

All day boundaries are **UTC**. A user's **anchor day** is the UTC day of
their earliest event — a "first seen" proxy for signup.

| Metric              | Definition                                                                                                                                                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DAU / WAU / MAU** | Distinct users with ≥1 event in the trailing 1 / 7 / 30 UTC days ending today. MAU is a 30-day approximation, not a calendar month.                                                                                                                                                                           |
| **DAU/WAU ratio**   | `dau / wau` — "stickiness". 1.0 means every weekly-active user was also daily-active; typical consumer products sit around 0.2–0.5.                                                                                                                                                                           |
| **Churn (window)**  | Cohort = users active during the _previous_ `windowDays`-day window. Churned = cohort members with zero events in the latest `windowDays` window. `churnRate = churned / cohortSize`. Default window = 7 days.                                                                                                |
| **N-day retention** | Grouped by anchor day. A user is retained on `dayOffset` N when they have ≥1 event **exactly** on anchor day + N (not "within N days"). Cells whose target day hasn't fully elapsed report `retention: null` / `—`.                                                                                           |
| **Survival curve**  | Pooled across cohorts. At tenure day `d`, only users whose anchor is ≥ `d` days old are _eligible_; _retained_ = eligible users whose last active day is ≥ anchor + `d`. `survival = retained / eligible`. This answers "of users who signed up at least d days ago, what fraction is still around at day d?" |

### Reading the report

- **Activity windows** — headline engagement. Rising DAU with flat WAU means
  the existing base is engaging more deeply; rising WAU with flat DAU means
  reach is growing but shallower.
- **Churn** — weekly (default) involuntary+voluntary silence rate of the
  previously-active base. High churn with stable WAU implies fast
  acquisition masking losses.
- **N-day retention table** — the classic cohort grid at day granularity.
  Compare columns across rows: D1 tells you onboarding quality, D7/D30
  tell you whether the product habit sticks. Small cohorts (size < ~10)
  produce noisy percentages — prefer the pooled survival curve for those.
- **Survival curve** — smooths across cohorts; watch for the "elbow" where
  the slope steepens (the point where casual users drop off).

## Tie-in to cohorts

`src/lib/cohorts.ts` groups users by **signup week** and reports _weekly_
retention (W0…W7). This module groups by **first-activity day** and reports
_day_ retention plus pooled survival.

- Use **cohorts** for the signup-week grid shown in the app UI
  (`GET /api/cohorts`): it answers "how does each signup week retain over
  weeks?"
- Use **retention** for event-stream questions: exact-day N-day retention,
  churn windows, DAU/WAU/MAU stickiness, and survival — none of which the
  weekly bucket model expresses.
- Anchor-day cohorts here ≈ signup-week cohorts in cohorts.ts when events
  start at signup; they diverge for imported users whose first activity
  postdates account creation.

## Usage

```bash
node scripts/analytics/retention/report.mjs --demo            # markdown to stdout
node scripts/analytics/retention/report.mjs --demo --json     # raw JSON
node scripts/analytics/retention/report.mjs --file events.jsonl
node scripts/analytics/retention/report.mjs --file events.jsonl --json > report.json
```

Requires Node ≥ 22.18 (type stripping imports `src/lib/retention.ts`
directly; the repo pins Node 24).
