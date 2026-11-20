# Trace sampling strategy

How transaction trace volume is (and should be) sampled in Sentry for this
app, and how to wire a smarter policy in when the flat
`tracesSampleRate: 0.1` stops being enough.

The decision helpers live in `src/lib/tracing/sampling/policy.ts` — pure
functions, no Sentry dependency, fully unit-tested. **Nothing below is
applied yet**: `src/instrumentation-client.ts`, `src/sentry.server.config.ts`,
and `src/sentry.edge.config.ts` all use the flat
`NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0.1` and are owned by other work.
This document describes the target wiring; adopting it is a separate change.

## Current state

All three runtimes sample 10% of transactions:

| Runtime     | File                            | Mechanism          |
| ----------- | ------------------------------- | ------------------ |
| Browser     | `src/instrumentation-client.ts` | `tracesSampleRate` |
| Node server | `src/sentry.server.config.ts`   | `tracesSampleRate` |
| Edge        | `src/sentry.edge.config.ts`     | `tracesSampleRate` |

Error _events_ are never sampled by Sentry — `beforeSend` filtering only
drops dev noise. The 0.1 ratio only bounds **transaction/span** volume
(perf data), not error fidelity. That is the right default for now: it
keeps p95-style analysis possible while capping span-processing cost.

## Why a flat rate is eventually too coarse

This app has three very different traffic shapes:

- **Marketing/docs pages** (`/`, `/pricing`, `/docs/**`, `/blog/**`) —
  high volume, low diagnostic value per trace, mostly static renders.
- **App routes** (`/projects`, collaboration, settings) — moderate volume,
  high value: these are where real users hit real latency.
- **API routes** (`/api/**`) — potentially very high volume (polling,
  agent streams), mostly machine traffic; slow endpoints still matter.

A single 0.1 either wastes quota on marketing pageloads or starves API
analysis. `tracesSampler` exists precisely for this: it receives the
transaction name and attributes _before_ deciding, so a policy can return
different rates per route.

## The policy module

`src/lib/tracing/sampling/policy.ts` exports:

- `decideTraceSample(ctx, policy)` → `{ sample, rate, source, reason,
forcedBy? }` — the entry point. Deterministic: the same `traceId` (or
  transaction name fallback) always produces the same decision, matching
  how Sentry's own sampler stays consistent across a trace's spans.
- `resolveRate(ctx, policy)` → `{ rate, source }` — rule evaluation only:
  error bias → first matching rule → default.
- `hashToUnit(str)` — FNV-1a hash → `[0,1)` for the deterministic draw.
- `routePattern(pattern)` / `routeRule(patterns, rate, name)` — glob-ish
  route matchers. `*` stays within a path segment, `**` crosses segments;
  patterns match the **full transaction name**, so include the HTTP method
  (`GET /api/**`) for server transactions.
- `durationKeepRule`, `tagKeepRule` — forced-keep builders ("tail-based").
- `recommendedPolicy(overrides)` — a sane starting policy for this app
  (see below).

### Decision order

1. **Forced keeps** (`policy.forcedKeeps`) — if any `when(ctx)` is true,
   the trace is always sampled. These are the "tail-based" rules.
2. **Error bias** — if the context carries an error signal
   (`hasError`, `tags.error`, or `http.status_code >= 500`), the
   `errorRate` (default `1`) applies. Errors are the highest-value traces
   and the cheapest to justify keeping.
3. **Per-route rules** — first match wins, in array order.
4. **Default rate** — the floor for everything unmatched.

## Head sampling vs tail-based sampling — the honest tradeoff

Sentry samples **at transaction start** (`tracesSampler` runs before the
transaction executes). At that moment the trace's duration, error count,
and span tree **do not exist yet**. True tail-based sampling — "keep the
slowest/most error-dense 1% of traces" — is impossible at that point;
it requires buffering all traces and deciding after completion, which
Sentry does not offer natively (it would need a proxy/relay in front of
the ingest endpoint).

What this module does instead:

- **Propagated signals**: if a parent span or upstream service already
  knows the outcome (e.g. a `sentry-trace` header carrying sampled state,
  or attributes like `http.status_code`, `flow=checkout`, `duration_ms`
  injected by middleware), `forcedKeeps` can act on them at sample time.
  This is "informed head sampling" — the practical approximation of
  tail-based rules.
- **Post-hoc filtering**: `forcedKeeps` can also be evaluated later, e.g.
  in a `beforeSendTransaction`-style hook where duration is known, by
  returning `null` for transactions that don't qualify. That trades
  ingest volume for decision quality.

Recommendation: start with informed head sampling (error bias + route
rules + a few propagated-attribute keeps). Only invest in real tail-based
infrastructure if quota pressure or a specific slow-path investigation
demands it — the cost is a buffering proxy, not a config flag.

## Cost / performance tradeoffs

- **Span processing is billed per span**, not per transaction. Long traces
  with many spans (agent streams, collaboration pages) cost disproportionately;
  a `durationMs`/`span_count` keep rule concentrates budget exactly there.
- **Sampling decision cost is negligible** — one hash + a few regex tests
  per transaction. No measurable request-path impact.
- **Higher rates on app routes buy real signal**: p95/p99 per-route
  latency, N+1 DB query patterns in traces, and distributed-trace
  continuity all need enough samples to be statistically meaningful.
  15% on app routes is a reasonable ceiling before quota becomes the
  binding constraint.
- **Marketing pages at 10%** is already generous; they are mostly static
  and their perf signal is covered by Web Vitals (`web-vitals` lib) more
  cheaply than distributed traces.
- **API routes at 2%** sounds aggressive but API transactions are numerous
  and repetitive; errors still come through at `errorRate: 1`, and the
  `durationKeepRule` catches genuinely slow endpoints.

## Recommended config for this app

`recommendedPolicy()` encodes:

| Route class        | Pattern                                   | Rate        | Rationale                             |
| ------------------ | ----------------------------------------- | ----------- | ------------------------------------- |
| API reads          | `GET /api/**`                             | 0.02        | High volume, repetitive               |
| API writes / app   | `POST /api/**`, `/app/**`, `/projects/**` | 0.15        | User-facing, highest diagnostic value |
| Marketing/docs     | `/`, `/pricing`, `/docs/**`, `/blog/**`   | 0.10        | Keep parity with current global rate  |
| Static assets      | `/_next/**`                               | 0           | Not worth tracing                     |
| Errors (any route) | error signal                              | 1.0         | Never drop                            |
| Slow traces        | `durationMs >= 5000` (propagated)         | forced keep | User-visible pain                     |
| Business flows     | `tags.flow === "checkout"`                | forced keep | Funnel-critical                       |

Tune against the actual Sentry quota: if span usage is under ~50%, raise
`app-routes` first; if over, drop `api-low-volume` and `marketing-docs`
before touching error coverage.

## Wiring into Sentry (documented, not applied)

`tracesSampler` **replaces** `tracesSampleRate` — set one or the other,
not both. The shape, per runtime:

```ts
// browser — src/instrumentation-client.ts (DO NOT edit; illustration only)
tracesSampler: (samplingContext) => {
  // samplingContext has: name, attributes, parentSampled, ...
  const decision = decideTraceSample(
    {
      transactionName: samplingContext.name ?? "",
      traceId: samplingContext.attributes?.["sentry.trace_id"] as string | undefined,
      attributes: samplingContext.attributes,
      tags: samplingContext.attributes as Record<string, string | undefined>,
    },
    recommendedPolicy(),
  )
  return decision.rate // Sentry applies its own consistent draw
},
```

For the boolean-vs-rate distinction: returning `decision.rate` lets
Sentry's built-in per-trace-id consistency do the draw; returning
`decision.sample ? 1 : 0` forces our deterministic decision. Prefer the
rate form — Sentry's draw is already trace-consistent and our `sample`
flag exists mainly for tests and the preview script.

Server (`sentry.server.config.ts`) and edge (`sentry.edge.config.ts`)
versions differ only in available attributes: server transactions expose
`http.route`/`http.target` and the request method, so API route rules can
match on `attributes["http.route"]` instead of parsing the name. Edge has
the least context — keep it on the default rate or a simplified policy.

Notes:

- `parentSampled` in the sampling context should be honored: if the
  parent was sampled, return `1` to keep the distributed trace whole —
  add a forced keep or an early return for that case when wiring.
- Keep `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` working as an escape
  hatch: when the env var is set, skip `tracesSampler` entirely (flat
  rate), so incidents/debugging can force a uniform rate without a deploy.
- Error _events_ need no sampling change — they are already unsampled.
  The error bias here only affects which **transactions** get kept.

## Previewing decisions

`scripts/tracing/sampling-preview.mjs` simulates the policy over sample
transaction names:

```bash
npx tsx scripts/tracing/sampling-preview.mjs --demo
npx tsx scripts/tracing/sampling-preview.mjs "GET /api/projects" "GET /api/projects/123/runs" "/docs/getting-started"
```

`--demo` runs a representative mix of marketing, app, and API transaction
names through `recommendedPolicy()` and prints keep/drop per trace.
