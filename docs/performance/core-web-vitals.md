# Core Web Vitals tracking

`src/lib/web-vitals/` collects the five Core Web Vitals in the browser and
reports them through pluggable, consent-gated sinks.

## Why a fallback instead of the `web-vitals` package

`web-vitals` is present in `node_modules` only as a **transitive** dependency
of `@sentry/browser-utils` — it is not a direct dependency in `package.json`,
and adding it was out of scope. The collector therefore re-implements the same
measurements on the Performance Timeline APIs (`PerformanceObserver`,
`performance.getEntriesByType("navigation")`), with no runtime dependency.

If `web-vitals` is ever promoted to a direct dependency, `collector.ts` is the
only file that needs replacing — the metric shape (`VitalsMetric`), ratings,
sinks, consent gate, and `initWebVitals` wiring stay the same.

## Module layout

| File                 | Contents                                                                     |
| -------------------- | ---------------------------------------------------------------------------- |
| `types.ts`           | `VitalsMetric`, `VitalsSink`, `rateVitalsMetric()` with CWV thresholds       |
| `collector.ts`       | `startVitalsCollection()` — PerformanceObserver-based LCP/CLS/INP/FCP/TTFB   |
| `sinks.ts`           | `createConsoleVitalsSink`, `createBeaconVitalsSink`, `createJsonlVitalsSink` |
| `reporter.ts`        | `createVitalsReporter()` (consent gate) and `initWebVitals()`                |
| `index.ts`           | Barrel exports                                                               |
| `web-vitals.test.ts` | Vitest suite (23 tests)                                                      |

## What is measured

- **LCP** — latest `largest-contentful-paint` entry's `renderTime` (falls back
  to `loadTime`, then `startTime`). Finalized on `pagehide` /
  `visibilitychange` → hidden.
- **CLS** — cumulative layout shift using the spec's session-window rules
  (1s gap closes a window, 5s caps it; max window wins). Entries with
  `hadRecentInput` are ignored. Same lifecycle as LCP.
- **INP** — longest Event Timing `event` entry duration. Entries with
  `interactionId === 0` are skipped; the observer uses `durationThreshold: 16`
  like the `web-vitals` library. This is still an approximation: it takes the
  longest event duration rather than grouping events into interactions the way
  true INP does.
- **FCP** — first `first-contentful-paint` paint entry. Reported as soon as it
  is observed.
- **TTFB** — `responseStart - fetchStart` of the navigation timing entry.
  Full page loads only; client-side navigations produce no navigation entry
  (Sentry browser tracing already covers those spans).

Each metric reports **at most once per page load**, with a `good` /
`needs-improvement` / `poor` rating using the standard thresholds
(LCP 2.5s/4s, CLS 0.1/0.25, INP 200/500ms, FCP 1.8s/3s, TTFB 800/1800ms).

## Consent gating

Reporting is gated on the **`analytics`** consent category from
`src/lib/consent.ts` (there is no dedicated vitals category, and `consent.ts`
is shared). The gate is checked per metric at report time:

- Undecided or rejected → metrics are dropped, nothing reaches a sink.
- Granted → metrics flow to the configured sinks.
- Revoked mid-session → pending/final reports are dropped ("nothing leaves the
  browser", same rule as Sentry replay in `instrumentation-client.ts`).

Collection itself is passive — `PerformanceObserver` only reads data the
browser already produces — so it is safe to run before the visitor decides;
only the `record()` path checks consent. This matters because LCP/CLS/INP
finalize on `pagehide`, usually after the banner has been answered.

## Sinks

- `createConsoleVitalsSink()` — `console.debug` per metric. Installed by
  `initWebVitals` automatically outside production.
- `createBeaconVitalsSink(url)` — buffers metrics and POSTs
  `{ metrics: [...] }` as JSON. Prefers `navigator.sendBeacon` (survives page
  unload, which is exactly when LCP/CLS/INP finalize) and falls back to
  `fetch` with `keepalive`. `initWebVitals` flushes it on `pagehide` and on
  `visibilitychange` → hidden.
- `createJsonlVitalsSink(path)` — appends one JSON object per line; server-only
  in practice (lazy `node:fs/promises` import), useful for local pipelines.

All sinks are best-effort: failures are swallowed so telemetry can never break
the app.

## Wiring (documented, not applied)

`src/instrumentation-client.ts` is shared and was intentionally **not**
modified. To activate tracking, add:

```ts
import { initWebVitals } from "@/lib/web-vitals"

// anywhere after Sentry.init — collection is passive and consent-gated
initWebVitals({ endpoint: "/api/vitals" })
```

That one line is sufficient for development (console sink) plus production
beacon reporting once an ingest route exists. Options:

- `endpoint` — beacon target. **No `/api/vitals` route exists yet**; without
  it, production installs no network sink (console only in non-production).
  A future route should accept `POST { metrics: VitalsMetric[] }`, validate
  the shape, re-check the `analytics` consent cookie server-side (same pattern
  as `/api/analytics`), and store or forward the aggregates.
- `sinks` — pass explicit sinks instead of the defaults (e.g. a JSONL sink in
  a Node context, or a composite).
- `isAllowed` — override the consent predicate (defaults to
  `hasConsent("analytics")`).
- `observerFactory`, `now`, `makeId`, `path` — test/advanced hooks.

`initWebVitals` returns a teardown function that disconnects observers and
flushes sinks; it no-ops during SSR.

## Tests

```bash
npx vitest run src/lib/web-vitals/web-vitals.test.ts
```

The suite injects a fake `PerformanceObserver` factory and asserts metric
values, ratings, CLS session-window math, INP `interactionId` filtering,
single-report semantics, pagehide/visibilitychange finalization, the consent
gate (including the real `writeConsent` cookie path), and all three sinks.
