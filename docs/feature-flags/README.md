# Feature flags

A small, dependency-free feature flag system for the App Router. Flags are
declared in a typed registry, evaluated identically on the server and in the
browser, and can be overridden per environment without a redeploy.

## Layout

| File                                | Purpose                                                              |
| ----------------------------------- | -------------------------------------------------------------------- |
| `src/lib/feature-flags/types.ts`    | `FlagDefinition`, `FlagTarget`, `FlagDefaults`                       |
| `src/lib/feature-flags/flags.ts`    | The registry (`featureFlags`) and `FlagName` type                    |
| `src/lib/feature-flags/evaluate.ts` | Pure evaluation: env keys, override parsing, hashing                 |
| `src/lib/feature-flags/env.ts`      | Reads `FEATURE_FLAG_*` from `process.env` (server only)              |
| `src/lib/feature-flags/server.ts`   | `getFeatureFlag()` / `getFeatureFlags()` for RSCs and route handlers |
| `src/lib/feature-flags/index.ts`    | Client-safe barrel (types, registry, pure evaluation)                |
| `src/components/feature-flags/`     | `FeatureFlagsProvider`, `useFeatureFlag`, anonymous subject id       |

## Defining a flag

Add an entry to `featureFlags` in `src/lib/feature-flags/flags.ts`:

```ts
"my-new-feature": {
  name: "my-new-feature",
  description: "What it does and when it should be removed.",
  defaults: {
    fallback: false,               // required; applies to any unnamed env
    development: true,
    test: true,
    production: { percentage: 25 },// optional percentage rollout
  },
},
```

A default is either a `boolean` or `{ percentage: number }` (0–100). The
registry key must equal `name`, and `FlagName` is derived from the keys, so
call sites are type-checked.

## Evaluation order

1. **Env override** — `FEATURE_FLAG_<NAME>` (see below).
2. **`defaults[environment]`** — the environment name passed to the evaluator
   (`NODE_ENV` by default; pass e.g. `staging` to use a staging entry).
3. **`defaults.fallback`**.

A `{ percentage }` target enables the flag when
`hashToBucket(subjectId) < percentage`. The bucket is a deterministic FNV-1a
hash of the subject id, so a given user sees the same result on every render,
deploy, and device that shares the id — and roughly `percentage`% of all
subjects are enabled.

## Env override contract

`FEATURE_FLAG_<NAME>` where `<NAME>` is the flag name upper-cased with
non-alphanumerics collapsed to `_`:

| Value                                 | Effect                                       |
| ------------------------------------- | -------------------------------------------- |
| `on`, `true`, `1`, `yes`, `enabled`   | Force on                                     |
| `off`, `false`, `0`, `no`, `disabled` | Force off                                    |
| `0`–`100` or `NN%`                    | Percentage rollout for the evaluated subject |
| anything else / empty                 | Ignored (falls through to defaults)          |

Examples: `FEATURE_FLAG_NEW_DASHBOARD=on`, `FEATURE_FLAG_REALTIME_COLLAB=10%`.

These variables are **server-side only**. They are a dynamic family, so they
cannot live in the static zod schema in `src/lib/env.server.ts`; the single
reader is `src/lib/feature-flags/env.ts`. They are intentionally not added to
`.env.example` — document them here instead.

## Server usage (React Server Components, actions, route handlers)

```ts
import { getFeatureFlag, getFeatureFlags } from "@/lib/feature-flags/server"

export default async function Page() {
  const showNewDashboard = getFeatureFlag("new-dashboard", {
    subjectId: session?.user.id, // pass a stable id for % rollouts
  })
  // ...
}
```

`getFeatureFlags()` evaluates the whole registry — useful for embedding a
snapshot. Both read `FEATURE_FLAG_*` overrides automatically and default the
environment to `clientEnv.NODE_ENV`; pass `environment` to evaluate against a
different name (e.g. `VERCEL_ENV`).

Do **not** import `@/lib/feature-flags/server` from a client component — it is
deliberately excluded from the `@/lib/feature-flags` barrel.

## Client usage

```tsx
"use client"

import { useFeatureFlag } from "@/components/feature-flags/use-feature-flag"

export function DashboardToggle() {
  const enabled = useFeatureFlag("new-dashboard")
  return enabled ? <NewDashboard /> : <OldDashboard />
}
```

Optionally wrap the tree once:

```tsx
<FeatureFlagsProvider subjectId={user.id} environment="production">
  <App />
</FeatureFlagsProvider>
```

Provider props:

- `subjectId` — stable id for rollouts (defaults to a random anonymous id
  persisted in `localStorage` under `spindle_ff_subject`).
- `environment` — defaults to `clientEnv.NODE_ENV`.
- `overrides` — explicit `FEATURE_FLAG_*` map; the browser cannot enumerate
  `process.env`, so client-evaluated flags only honor overrides passed here.
  For override-sensitive flags, evaluate on the server and pass the boolean
  as a prop instead.

### Hydration note

`useFeatureFlag` evaluates without a subject id on the server and first client
render (so markup matches), then re-evaluates with the real subject after
mount. Percentage-rollout flags can flip once after hydration — keep
rollout-gated UI tolerant of that, or resolve server-side.

## Consent

Flag evaluation itself sets no cookies and sends no telemetry. The only
storage it touches is the anonymous rollout id in `localStorage`
(`spindle_ff_subject`) — a random pseudonymous identifier with no PII,
classified as essential storage alongside `spindle-site-theme`. If a flag
gates a feature that itself requires a consent category (analytics, replay),
gate that feature separately with `hasConsent()` from `src/lib/consent.ts`;
flags are not a consent mechanism.

## Testing

Unit tests live next to the code (`evaluate.test.ts`,
`use-feature-flag.test.tsx`). To exercise evaluation directly:

```ts
import { evaluateFlagByName } from "@/lib/feature-flags"

evaluateFlagByName("realtime-collab", {
  environment: "production",
  subjectId: "user-123",
  overrides: { FEATURE_FLAG_REALTIME_COLLAB: "on" },
})
```
