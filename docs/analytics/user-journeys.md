# User journeys

Cross-page, multi-step flows measured end to end: sign-up → first project,
invite → accept, OAuth sign-in, and so on. Journey analytics answers "where do
users drop out of the flows that matter?" — distinct from the aggregate
counters in `src/lib/analytics.ts` and from the funnel/cohort/retention
analyses owned by sibling docs.

## Components

| Piece             | Path                                    | Role                                                                                             |
| ----------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Journey catalog   | `src/lib/journey/definitions.ts`        | Ordered step lists per journey; source of truth for step ids and `stepIndex`.                    |
| Session stitching | `src/lib/journey/session.ts`            | Per-tab-session id (`sessionStorage`) attached to every journey event.                           |
| Tracker           | `src/lib/journey/tracker.ts`            | `trackJourneyStep()` / `trackJourneyStart()` — typed, consent-gated wrapper over `trackEvent()`. |
| Funnel analyzer   | `scripts/analytics/journey/analyze.mjs` | Offline CLI that rebuilds funnels from JSONL event exports.                                      |

## Event schema

Every journey step emits one analytics event through the existing pipeline
(`trackEvent` → `/api/analytics` → in-memory store / exports):

```json
{
  "name": "journey_step",
  "type": "feature_use",
  "props": {
    "journey": "signup_to_first_project",
    "step": "signup_submitted",
    "stepIndex": 2,
    "journeySessionId": "js-…",
    "…caller props…": "…"
  },
  "timestamp": 1700000000000,
  "anonymousId": "…"
}
```

- `stepIndex` is the 0-based position from `definitions.ts`; analysis uses it
  for ordering and falls back to first-seen timestamp when absent.
- Reserved props (`journey`, `step`, `stepIndex`, `journeySessionId`) cannot be
  overridden by callers; extra props are capped at 16 keys.
- Unknown journeys/steps are dropped silently — call sites never throw.

## Identity and stitching

Three keys combine to reconstruct a journey across anonymous → authenticated
boundaries:

| Key                | Scope                                             | Set by                                         |
| ------------------ | ------------------------------------------------- | ---------------------------------------------- |
| `anonymousId`      | per browser tab, not persisted                    | `src/lib/analytics.ts` on every event          |
| `journeySessionId` | per tab session (`sessionStorage`)                | `src/lib/journey/session.ts` on journey events |
| `userId`           | session principal (`user:<uid>` / `mock:<email>`) | `/api/analytics` ingest, server-side           |

The analyzer picks a subject per event in the order `journeySessionId` →
`userId` → `anonymousId`. `journeySessionId` is the only key present on both
sides of the anonymous → authenticated boundary (it is emitted on every
journey event and survives sign-in), so it must win: preferring `userId`
first would split pre-auth and post-auth steps into two subjects and drive
completion rates to ~0. `anonymousId` resets on reload while
`journeySessionId` survives reloads within the tab, making the session id
the most stable anonymous key; `userId` is only a fallback for events
missing a session id. Consent: journey events ride the `analytics` consent
category — nothing is sent before the visitor opts in, and the queue is
dropped if they reject.

## Journey catalog

Steps are declared in `src/lib/journey/definitions.ts`. Treat step ids as
stable: renaming one splits historical funnels. Append new steps at the end
of a journey or add a new journey id.

### `signup_to_first_project` — activation

| #   | Step                    | Where                   |
| --- | ----------------------- | ----------------------- |
| 1   | `landing_view`          | `/`, `/pricing`         |
| 2   | `signup_view`           | `/sign-up`              |
| 3   | `signup_submitted`      | `POST /api/auth/signup` |
| 4   | `email_verified`        | `/verify-email`         |
| 5   | `workspace_ready`       | `/app`, `/dashboard`    |
| 6   | `project_create_opened` | `/projects`             |
| 7   | `project_created`       | projects API adapter    |
| 8   | `first_project_view`    | `/projects/[projectId]` |

### `invite_to_accept` — team growth

`invite_sent` (`/app/dashboard/members`) → `invite_link_opened` →
`invite_accepted` (members API adapter) → `workspace_joined` →
`first_project_view`.

### `passwordless_signin`

`signin_view` (`/sign-in`) → `magic_link_requested`
(`POST /api/auth/passwordless/request`) → `magic_link_opened`
(`/magic-link`) → `session_established` (`GET /api/auth/session`).

### `oauth_signin`

`signin_view` → `oauth_started` (`GET /api/auth/oauth/[provider]`) →
`oauth_callback` (`/oauth/callback`) → `session_established`.

### `referral_signup`

`referral_landing` (`/r/[code]`) → `referral_stored`
(`localStorage spindle.referral-invite`, see `src/lib/referral.ts`) →
`signup_submitted` → `email_verified` → `first_project_view`.

### `agent_task`

`project_opened` → `agent_panel_opened` (`/projects/[projectId]/agent`) →
`prompt_submitted` → `run_completed` (`/app/agent/[runId]`).

### `feedback_submission`

`feedback_view` (`/app/feedback`, `/app/nps`) → `feedback_draft` (optional) →
`feedback_submitted` (`POST /api/feedback` or `/api/nps`).

## Instrumentation guide

Import from the barrel and call at the moment the step actually happens
(submit accepted, page rendered, callback returned) — not on click intent.

```ts
import { trackJourneyStep, trackJourneyStart } from "@/lib/journey"

// Entry point of a funnel
trackJourneyStart("signup_to_first_project", "signup_view")

// Mid-funnel step with aggregate context
trackJourneyStep("signup_to_first_project", "signup_submitted", {
  provider: "email", // safe: enum-ish, non-identifying
})

// Completion
trackJourneyStep("agent_task", "run_completed", { runCount: 1 })
```

Rules:

- Client components, route handlers, and server actions may all call it;
  `trackEvent` no-ops outside the browser, so guard server-side emission
  deliberately if you need server-produced journey events.
- Props must be aggregate and non-identifying — same rule as `trackEvent`.
  Never pass emails, names, project content, or prompt text.
- One `journeySessionId` covers all journeys in a tab session; if a user runs
  two journeys concurrently the analyzer still attributes steps correctly
  because each event carries its `journey` id.

## Analysis

### Funnel CLI

```bash
# From a JSONL export of stored analytics events:
node scripts/analytics/journey/analyze.mjs events.jsonl
node scripts/analytics/journey/analyze.mjs events.jsonl --json
node scripts/analytics/journey/analyze.mjs events.jsonl --journey signup_to_first_project

# Or pipe directly:
cat events.jsonl | node scripts/analytics/journey/analyze.mjs - --json
```

Input is newline-delimited JSON; each line is either a stored event
(`{ name, props, timestamp, userId, anonymousId }`) or an
`{ events: [...] }` payload envelope. Blank/malformed lines are skipped.

Per journey the report contains, for every step in catalog order:

- `subjectsReached` — distinct subjects that progressed to at least this step
- `stepOverStepConversion` — reached ÷ previous step reached
- `overallConversion` — reached ÷ all subjects seen in the journey
- `medianTimeFromStartMs` — median elapsed time from the subject's first
  journey event to first reaching the step
- `eventCount` — raw event volume (includes repeats and out-of-order hits)

Plus `subjects`, `completed`, and `completionRate` per journey.

Funnel semantics: a subject counts as reaching every step up to its furthest
reached rank (ordered progression is assumed); events for earlier steps seen
after a later step still count once the subject got there.

### Queries against the live store

The `/api/analytics` store is per-process and in-memory; for durable analysis
export events to JSONL and use the CLI above. Equivalent ad-hoc queries:

```bash
# Raw journey events only
jq -c 'select(.name == "journey_step")' events.jsonl

# Count subjects per journey/step (journeySessionId preferred, userId/anonymousId fallback)
jq -r '.props.journey + " " + .props.step + " " + (.props.journeySessionId // .userId // .anonymousId)' \
  events.jsonl | sort -u | jq -R -s 'split("\n") | group_by(.[0:1]) | map({journey: .[0].split(" ")[0], steps: ([.[].split(" ")[1:2]] | unique | length)})'
```

## Tests

- `src/lib/journey/journey.test.ts` — catalog integrity, session id
  lifecycle, tracker validation/prop-sanitising (mocks `trackEvent`).
- `src/lib/journey/analyze-cli.test.ts` — runs the CLI end-to-end against
  fixture JSONL (funnel math, stitching priority, envelope parsing).
