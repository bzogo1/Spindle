# Distributed tracing

How Spindle's Sentry tracing works, what is already instrumented, and how to
add manual spans and propagate trace context across services.

## Current state (already enabled)

Tracing is configured in three Sentry init files — none of them are touched by
`src/lib/tracing/`; that module is additive helpers only.

| Runtime     | File                            | What's enabled                                                                                  |
| ----------- | ------------------------------- | ----------------------------------------------------------------------------------------------- |
| Browser     | `src/instrumentation-client.ts` | `browserTracingIntegration()` (pageload + navigation spans), `tracesSampleRate` 0.1             |
| Node server | `src/sentry.server.config.ts`   | `tracesSampleRate` 0.1, `captureConsoleIntegration` (error/warn), dev-noise `beforeSend` filter |
| Edge        | `src/sentry.edge.config.ts`     | `tracesSampleRate` 0.1                                                                          |

Shared behavior across all three:

- **Sampling**: flat `tracesSampleRate` of `0.1`, overridable in every runtime
  via `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` (no server-only override).
  Error events are never sampled — sampling only affects performance
  transactions/spans.
- **Release**: `SENTRY_RELEASE` → `VERCEL_GIT_COMMIT_SHA`/`GITHUB_SHA` →
  `DEFAULT_SENTRY_RELEASE`, so traces join the same release timeline as errors.
- **Request errors**: `onRequestError = Sentry.captureRequestError` in
  `src/instrumentation.ts` reports exceptions from route handlers, server
  components, and middleware.
- **Request logging**: `withRequestLogging()` in `src/lib/request-logging.ts`
  emits one `api.request` JSON log line per request with `requestId`,
  method, path, status, `durationMs`, `userId`, `projectId`, and adds a Sentry
  breadcrumb for status ≥ 400. The `requestId` is echoed back in the
  `x-request-id` response header.

What Sentry instruments automatically (no code needed):

- Browser pageloads and App Router navigations (`browserTracingIntegration`,
  `onRouterTransitionStart`).
- Server requests: the Next.js SDK wraps route handlers and server components
  in transactions; `tracesSampleRate` bounds volume to ~10% of requests.
- `fetch`/`undici` HTTP client spans on both runtimes (auto-instrumented by
  the SDK), including outgoing `sentry-trace`/`baggage` propagation to
  Sentry-aware backends.

## Module layout — `src/lib/tracing/`

Export-only helpers; nothing here is wired into existing files.

| File                 | Exports                                                                                                                   | Purpose                                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `headers.ts`         | `TRACE_HEADERS`, `extractTraceHeaders`, `outgoingTraceHeaders`, `applyTraceHeaders`, `traceparentHeader`                  | Read/validate incoming `sentry-trace`, `baggage`, `traceparent`, `x-request-id`; build outgoing propagation headers via `Sentry.getTraceData({ propagateTraceparent: true })` |
| `spans.ts`           | `withSpan`, `withManualSpan`, `startDetachedSpan`, `setSpanAttributes`, `addSpanEvent`, `setSpanStatus`, `activeSpan`     | Manual span helpers over `Sentry.startSpan`/`startSpanManual`/`startInactiveSpan` with error-status plumbing                                                                  |
| `context.ts`         | `continueTraceFromRequest`, `continueTraceFromHeaders`, `tagRequestContext`, `getTraceContext`, `startNewTrace`           | Continue an incoming trace outside auto-instrumented paths; tag the scope with `request_id`/`user_id`/`project_id`; read the active trace                                     |
| `sample-rate.ts`     | `DEFAULT_TRACES_SAMPLE_RATE`, `TRACES_SAMPLE_RATE_ENV`, `parseSampleRate`, `resolveTracesSampleRate`, `makeTracesSampler` | Sampling rate constants/env parsing plus a simple `tracesSampler`-compatible factory                                                                                          |
| `sampling/policy.ts` | `decideTraceSample`, `resolveRate`, `routeRule`, `recommendedPolicy`, …                                                   | Declarative per-route sampling policy (see `docs/observability/trace-sampling.md`)                                                                                            |

All helpers are safe to call when Sentry is uninitialized or a span is not
sampled — callbacks still run, so business logic never depends on tracing.

## Adding manual spans

Wrap a unit of work in `withSpan`. Keep `name` low-cardinality (route
templates, not raw ids) and pick an `op` from the usual categories
(`db.query`, `http.client`, `function`, `queue.publish`).

```ts
import { withSpan, setSpanAttributes } from "@/lib/tracing"

export async function loadProjectWithTasks(projectId: string) {
  return withSpan({ name: "db.project-with-tasks", op: "db.query" }, async (span) => {
    const project = await db.query.projects.findFirst({ where: eq(projects.id, projectId) })
    setSpanAttributes(span, { "project.found": Boolean(project) })
    return project
  })
}
```

For spans that must stay open across several `await` boundaries, use
`withManualSpan` and call `finish()` when done. For fire-and-forget work that
must not nest under the caller's span, use `startDetachedSpan` and finish the
returned span yourself.

Inside a `withRequestLogging` route handler, spans started with `withSpan`
automatically become children of the request transaction — no extra wiring.

## Propagating trace context

**Incoming**: for code paths Sentry doesn't auto-wrap (e.g. work deferred with
Next's `after()`, queue consumers, webhook receivers), continue the caller's
trace explicitly:

```ts
import { continueTraceFromRequest } from "@/lib/tracing"

export async function processWebhook(request: Request) {
  return continueTraceFromRequest(request, async () => {
    // spans started here join the sender's trace
  })
}
```

`continueTrace` understands `sentry-trace` + `baggage` only. A bare W3C
`traceparent` from a non-Sentry caller does **not** continue into a Sentry
trace — a new trace starts — but `traceparent` is still forwarded verbatim to
outgoing requests so OTel-instrumented downstream services keep a consistent
chain.

**Outgoing**: spread `outgoingTraceHeaders()` (or `getTraceContext().headers`)
into fetch/init headers for non-auto-instrumented clients:

```ts
const res = await fetch(upstreamUrl, {
  headers: { ...outgoingTraceHeaders(), "content-type": "application/json" },
})
```

**Scope tags**: call `tagRequestContext({ requestId, userId, projectId })`
where `setRequestLogContext` is called so every captured error carries the
same ids as the `api.request` log line.

## Correlating traces with logs and SLOs

- **Logs** (`src/lib/logger.ts`, `src/lib/request-logging.ts`): each request
  emits `event: "api.request"` with `requestId`, `durationMs`, `status`,
  `userId`, `projectId`. To join a log line to a Sentry trace, tag the scope
  with the same ids via `tagRequestContext` — error events then show
  `request_id`/`user_id`/`project_id` tags, and the request's Sentry
  transaction shows the same `requestId` in its span attributes/tags when set.
  `withRequestLogging` already adds a breadcrumb (`category: "api"`) with the
  `requestId` for status ≥ 400, so a Sentry issue links back to the exact log
  line.
- **SLOs** (`docs/slo/service-level-objectives.md`): the server transaction
  duration is the source for request-latency SLOs; `api.request` `durationMs`
  is the log-side equivalent. When investigating an SLO burn, open the Sentry
  trace for a sampled request to see which span (DB, fetch, render) consumed
  the budget.
- **Log aggregation** (`docs/observability/log-aggregation.md`): the shipper
  forwards pino JSON verbatim; trace ids are not currently logged. If you add
  `getTraceContext().traceId` to request-scoped log fields in the future,
  Loki/Vector queries can join `requestId` → Sentry trace directly.

## Sampling guidance

- **Keep the flat 0.1 default.** Each request emits one transaction; server
  span volume — not main-thread cost — is what sampling bounds. Error events
  are unaffected.
- **Raise** `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` temporarily when
  investigating a perf regression or validating new instrumentation (e.g.
  `0.5`–`1.0` for a short window), then revert.
- **Per-transaction sampling**: `makeTracesSampler()` in `sample-rate.ts`
  provides a `tracesSampler`-compatible policy (drop health checks, always
  sample errors). It is intentionally not wired — adopting it means replacing
  `tracesSampleRate` with `tracesSampler` in the three init files, which also
  requires mapping Sentry's real sampler context (`samplingContext.transactionContext.name`,
  `attributes`) onto `SamplerContext`.
- **Cardinality**: never put raw ids, emails, or query strings in span names
  or attributes. Span attributes accept only primitives and homogeneous
  primitive arrays (`SpanAttributeValue`); secrets are covered by the same
  rules as log redaction — don't put them on spans either.

## Tests

`src/lib/tracing/*.test.ts` cover header extraction/validation, outgoing
propagation headers, span helpers, trace continuation, scope tagging, and the
sampling helpers — all with `@sentry/nextjs` mocked via `vi.mock`, matching the
pattern in `src/lib/request-logging.test.ts`.
