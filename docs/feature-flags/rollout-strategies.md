# Feature flag rollout strategies

`src/lib/feature-flags/rollout/` provides composable, pure rollout strategies
that sit **on top of** flag evaluation. They answer one question: _given a
flag's rollout plan, an evaluation context and a timestamp, is the flag
enabled?_

Everything is deterministic — strategies are pure functions of
`(config, context, now)` and never read the system clock or `process.env`.
`now` is always injected, which keeps evaluation testable and stable across
server/client renders.

## Mental model

A **rollout plan** is an ordered list of strategy steps:

```ts
interface RolloutPlan {
  killSwitch?: boolean // highest-precedence emergency disable
  steps: { strategy: string; config?: unknown }[]
}
```

`evaluateRollout(plan, ctx, now)` walks the steps left to right:

| Step verdict | Effect                                           |
| ------------ | ------------------------------------------------ |
| `false`      | Flag disabled; evaluation short-circuits         |
| `true`       | Step agrees; evaluation continues                |
| `null`       | Step abstains (no opinion); evaluation continues |

The flag is **enabled iff no step voted `false`** — steps compose with
logical AND, and abstentions are neutral. `plan.killSwitch` or
`ctx.killSwitch` being `true` disables the flag before any step runs.

## Strategies

All strategies are registered in `rolloutStrategies` and usable by name in a
plan. Each returns a `StrategyOutcome` (`{ verdict, reason }`).

### `percentage` — stable share of users

```ts
{ strategy: "percentage", config: { percent: 25, salt?: "experiment-a" } }
```

Buckets each subject with a deterministic FNV-1a hash of
`salt | flagKey | identity`. `percent <= 0` enables nobody, `>= 100` enables
everybody. Identity resolution order: `ctx.cohort` → `ctx.subjectId` →
`attributes.userId` → `attributes.id` → shared `"anonymous"` bucket.

Because the bucket is stable, raising `percent` from 25 → 50 keeps every
already-enabled user enabled — no re-bucketing.

### `linear` — percentage ramp over time

```ts
{
  strategy: "linear",
  config: {
    startAt: "2025-03-01T00:00:00Z",
    endAt: "2025-03-15T00:00:00Z",
    startPercent: 0,   // default
    endPercent: 100,   // default
    salt?: "ramp-1",
  },
}
```

Interpolates the effective percentage linearly between `startAt` and
`endAt`, then applies the same cohort hash as `percentage`. At the midpoint
of a 0→100 ramp exactly half the cohort is enabled; the enabled set only
grows as the ramp widens. `linearPercentAt()` is exported for tooling that
wants the raw percentage (e.g. progress UI).

### `segment` — plan / env / cohort targeting

```ts
{
  strategy: "segment",
  config: {
    plans: ["pro", "enterprise"],
    envs: ["production"],
    cohorts: ["beta-tester-1"],        // explicit identity allowlist
    cohortPercent: 10,                // …or a gradual cohort rollout
    attributes: { region: ["eu", "us"] },
    salt?: "seg-1",
  },
}
```

All provided criteria must match (AND). An empty config abstains (`null`).
`cohortPercent` reuses the deterministic hash, so cohort membership is
stable across evaluations.

### `schedule` — time-based enable windows

```ts
{
  strategy: "schedule",
  config: {
    timezone: "Europe/Kyiv",          // default for daily windows: UTC
    windows: [
      // One-off absolute window (endAt exclusive):
      { startAt: "2025-06-01T09:00:00Z", endAt: "2025-06-08T18:00:00Z" },
      // Recurring daily window ("HH:mm" wall-clock in `timezone`):
      { start: "09:00", end: "17:00", timezone: "Europe/Kyiv", days: [1,2,3,4,5] },
      // Overnight windows wrap past midnight: 22:00 → 02:00
    ],
  },
}
```

Enabled while `now` is inside **any** window; disabled otherwise. Daily
windows compare wall-clock time via `Intl`, so they follow local time across
DST transitions ("09:00" stays 09:00 local). A wall-clock time that does not
exist on a spring-forward day simply never matches. `days` uses JS
convention (0=Sunday … 6=Saturday).

### `kill-switch` — emergency disable

```ts
{ strategy: "kill-switch", config: true }              // always off
{ strategy: "kill-switch", config: { disabled: true } }
{ strategy: "kill-switch" }                            // reads ctx.killSwitch
```

Can only **disable**, never enable: it returns `false` when triggered and
`null` otherwise. `ctx.killSwitch` triggers it independently of config.
Prefer placing it first in `steps`, or use `plan.killSwitch` /
`ctx.killSwitch` for the built-in highest-precedence short-circuit.

## Composing strategies

Steps AND together; put the most selective/cheapest checks first:

```ts
import { evaluateRollout } from "@/lib/feature-flags/rollout"

const plan = {
  steps: [
    // 1. Business-hours window (cheap, time-only)
    {
      strategy: "schedule",
      config: { windows: [{ start: "08:00", end: "20:00", timezone: "Europe/Kyiv" }] },
    },
    // 2. Only paid plans in production
    { strategy: "segment", config: { plans: ["pro", "enterprise"], envs: ["production"] } },
    // 3. Gradual ramp to 25% of that audience
    { strategy: "percentage", config: { percent: 25 } },
    // 4. Panic button — disable everything instantly
    { strategy: "kill-switch", config: { disabled: false } },
  ],
}

const result = evaluateRollout(
  plan,
  {
    flagKey: "new-checkout",
    cohort: userId, // or subjectId — see alias below
    plan: user.plan,
    env: process.env.DEPLOY_ENV,
  },
  new Date(),
)
// result.enabled === false  → render old checkout
// result.results            → per-step verdicts + reasons for debugging
```

A timed launch that ramps automatically:

```ts
const plan = {
  steps: [
    { strategy: "kill-switch" },
    { strategy: "segment", config: { envs: ["production"] } },
    {
      strategy: "linear",
      config: { startAt: "2025-03-01T00:00:00Z", endAt: "2025-03-15T00:00:00Z" },
    },
  ],
}
```

## Integration with flag evaluation

The rollout module is **export-only** — it does not modify the core
`evaluateFlag()` path (`../evaluate.ts`, `../flags.ts`, `../types.ts`).

Mapping onto the existing API:

- `FlagEvaluationOptions.subjectId` → `EvaluationContext.cohort` (or the
  `subjectId` alias, which `resolveCohortIdentity()` accepts).
- `environment` → `EvaluationContext.env`.
- Plan/tier → `EvaluationContext.plan`.
- Kill switch → pass `killSwitch: true` in the context (e.g. from an env var
  such as `FEATURE_FLAG_KILL_ALL=on`), or set `plan.killSwitch`.

Suggested wiring (owned by the evaluation layer, not this module):

```ts
function isFlagEnabled(name: FlagName, subjectId?: string): boolean {
  const definition = getFlagDefinition(name)
  if (!definition) return false

  const rollout = rolloutPlans[name] // RolloutPlan | undefined
  if (!rollout) {
    // Fall back to the simple boolean/percentage evaluator.
    return evaluateFlagByName(name, { subjectId })
  }

  const result = evaluateRollout(
    rollout,
    {
      flagKey: name,
      subjectId,
      env: process.env.DEPLOY_ENV ?? clientEnv.NODE_ENV,
      plan: getUserPlan(), // server contexts only
      killSwitch: readFlagEnvOverrides()[flagEnvKey("kill-" + name)] === "on",
    },
    new Date(),
  )
  return result.enabled
}
```

Keep a `RolloutPlan` map next to `featureFlags` (e.g.
`feature-flags/rollout-plans.ts`) so flag definitions stay declarative and
rollout logic stays opt-in per flag.

### Differences from `evaluateFlag` bucketing

`evaluateFlag` hashes `subjectId` alone into 100 buckets. The rollout
strategies hash `salt | flagKey | identity` into 10 000 buckets, so:

- The same user gets **different** buckets for different flags (decorrelated
  rollouts — desirable).
- A user enabled at 25% stays enabled at 50% within a strategy, but the two
  systems' cohorts are **not** interchangeable. Pick one bucketing scheme per
  flag; don't mix `evaluateFlag` percentages with rollout percentages for the
  same flag.

## Extending

```ts
import { registerRolloutStrategy } from "@/lib/feature-flags/rollout"
import type { StrategyFn } from "@/lib/feature-flags/rollout"

const geoStrategy: StrategyFn = (config, ctx) => {
  const countries = (config as { countries: string[] }).countries
  const country = ctx.attributes?.country
  return {
    verdict: typeof country === "string" && countries.includes(country),
    reason: `country ${String(country)}`,
  }
}

registerRolloutStrategy("geo", geoStrategy)
// or pass per-call overrides: evaluateRollout(plan, ctx, now, { geo: geoStrategy })
```

## Testing

`rollout.test.ts` covers boundary percentages (0/100), cohort-hash
stability, segment criteria, daily/overnight/timezone/DST schedule windows,
linear interpolation and monotonic widening, kill-switch precedence, AND
composition, short-circuiting and custom strategies. Run:

```sh
npx vitest run src/lib/feature-flags
```
