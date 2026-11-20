import * as Sentry from "@sentry/nextjs"

import { extractTraceHeaders, TRACE_HEADERS } from "./headers"

/**
 * Trace-context helpers: continuing an incoming distributed trace, attaching
 * correlation ids to the Sentry scope, and reading the active trace.
 *
 * `continueTrace` only understands `sentry-trace` + `baggage`. A bare W3C
 * `traceparent` (from a non-Sentry caller) is *not* continued into a Sentry
 * trace — Sentry would start a new trace. `traceparent` is still propagated
 * verbatim to outgoing requests via `outgoingTraceHeaders`, so downstream
 * OTel-instrumented services see a consistent parent chain.
 */

/** Snapshot of the trace identifiers for the current scope/span. */
export type TraceContext = {
  traceId?: string
  spanId?: string
  sampled?: boolean
  /** Serialized headers suitable for outgoing propagation. */
  headers: Record<string, string>
}

/**
 * Runs `fn` with the incoming request's trace continued, so spans started
 * inside `fn` become children of the caller's trace. Use inside route
 * handlers / server actions that run *outside* the automatically-instrumented
 * request transaction (e.g. work deferred with `after()`, or entry points
 * Sentry doesn't wrap).
 *
 * If the request carries no `sentry-trace` header, `fn` runs in a fresh trace
 * — the same behavior as a request with no incoming trace.
 */
export function continueTraceFromRequest<T>(request: Request, fn: () => T): T {
  const { sentryTrace, baggage } = extractTraceHeaders(request.headers)
  return continueTraceFromHeaders({ sentryTrace, baggage }, fn)
}

/** Same as `continueTraceFromRequest` for already-extracted header values. */
export function continueTraceFromHeaders<T>(
  headers: { sentryTrace?: string; baggage?: string },
  fn: () => T,
): T {
  if (!headers.sentryTrace) return fn()

  return Sentry.continueTrace({ sentryTrace: headers.sentryTrace, baggage: headers.baggage }, fn)
}

/**
 * Tags the current scope with Spindle's correlation ids so every captured
 * error event carries them and can be joined to the `api.request` log line.
 * Call once per request after the request id and user/project ids are known —
 * typically right where `setRequestLogContext` is called.
 */
export function tagRequestContext(fields: {
  requestId?: string | null
  userId?: string | null
  projectId?: string | null
}) {
  const scope = Sentry.getCurrentScope()

  if (fields.requestId) scope.setTag("request_id", fields.requestId)
  if (fields.userId) scope.setTag("user_id", fields.userId)
  if (fields.projectId) scope.setTag("project_id", fields.projectId)
}

/**
 * Reads the active trace context. Returns ids from the active span when one
 * exists, falling back to the scope's propagation context (set for incoming
 * requests even before the first span starts). The `headers` field is ready
 * to spread into outgoing request headers.
 */
export function getTraceContext(): TraceContext {
  const span = Sentry.getActiveSpan()
  const spanContext = span?.spanContext()

  const traceData = Sentry.getTraceData({ propagateTraceparent: true })
  const headers: Record<string, string> = {}
  if (traceData["sentry-trace"]) headers[TRACE_HEADERS.sentryTrace] = traceData["sentry-trace"]
  if (traceData.baggage) headers[TRACE_HEADERS.baggage] = traceData.baggage
  if (traceData.traceparent) headers[TRACE_HEADERS.traceparent] = traceData.traceparent

  return {
    traceId: spanContext?.traceId ?? traceData["sentry-trace"]?.split("-")[0],
    spanId: spanContext?.spanId,
    sampled: spanContext ? (spanContext.traceFlags & 1) === 1 : undefined,
    headers,
  }
}

/**
 * Starts a new root trace for `fn`, detached from any incoming trace. Use
 * sparingly — for work that must not join the caller's distributed trace
 * (e.g. health-check fan-out, synthetic probes).
 */
export function startNewTrace<T>(fn: () => T): T {
  return Sentry.startNewTrace(fn)
}
