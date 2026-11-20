import * as Sentry from "@sentry/nextjs"
import type { Span } from "@sentry/nextjs"

/**
 * Thin helpers around `Sentry.startSpan` / `startSpanManual` /
 * `startInactiveSpan`. These are safe to call anywhere in server code — when
 * Sentry is uninitialized or a span is not sampled they still invoke the
 * callback, so business logic never depends on tracing being enabled.
 *
 * `@sentry/nextjs` does not re-export the `StartSpanOptions`/`SpanStatus`
 * types or the `SPAN_STATUS_*` constants, so they are derived from the
 * function signatures below.
 */

/** Options accepted by `Sentry.startSpan` (name, op, attributes, onlyIfParent…). */
export type SpanStartOptions = Parameters<typeof Sentry.startSpan>[0]

/** Status object accepted by `Span.setStatus` (`{ code: 0|1|2, message? }`). */
export type SpanStatusInput = Parameters<Span["setStatus"]>[0]

/** A single span attribute value: string, number, boolean, or a homogeneous
 * primitive array. */
export type SpanAttributeValue = NonNullable<Parameters<Span["setAttribute"]>[1]>

/** Attributes accepted by the Sentry span API. */
export type SpanAttributesInput = Record<string, SpanAttributeValue | null | undefined>

export type NamedSpanOptions = {
  /** Span name — appears as the transaction/span title in Sentry. Keep it
   * low-cardinality: prefer route templates (`/api/projects/[id]`) over raw
   * ids. */
  name: string
  /** Span `op`, a category used for grouping (e.g. `http.server`, `db.query`,
   * `function`, `http.client`). */
  op?: string
  attributes?: SpanStartOptions["attributes"]
  /** If true, the span is only created when an active parent span exists. */
  onlyIfParent?: boolean
}

function failSpan(span: Span) {
  span.setStatus({ code: 2, message: "internal_error" })
}

/**
 * Runs `fn` inside a span that is active for the callback's duration and is
 * automatically finished when the callback resolves or rejects. Equivalent to
 * `Sentry.startSpan` plus attribute/exception plumbing.
 *
 * Errors thrown inside `fn` mark the span failed before being rethrown, so
 * the span shows the failure even when the error is later swallowed.
 */
export function withSpan<T>(
  options: NamedSpanOptions,
  fn: (span: Span) => T | Promise<T>,
): Promise<T> {
  return Promise.resolve(
    Sentry.startSpan({ ...options }, async (span) => {
      try {
        return await fn(span)
      } catch (cause) {
        failSpan(span)
        throw cause
      }
    }),
  )
}

/**
 * Same as `withSpan` but gives the callback an explicit `finish` so the span
 * can span multiple `await` boundaries or stay open across manual checkpoints.
 * Call `finish()` when the work is done; unmatched manual spans are
 * force-finished by Sentry at transaction end.
 */
export function withManualSpan<T>(
  options: NamedSpanOptions,
  fn: (span: Span, finish: () => void) => T | Promise<T>,
): Promise<T> {
  return Promise.resolve(
    Sentry.startSpanManual({ ...options }, async (span, finish) => {
      try {
        return await fn(span, finish)
      } catch (cause) {
        failSpan(span)
        throw cause
      }
    }),
  )
}

/**
 * Creates a span that is NOT set active on the current scope. Use for
 * background work (fire-and-forget jobs, deferred writes) where child spans
 * should not nest under the caller's active span. Returns the `Span`; the
 * caller owns finishing it.
 */
export function startDetachedSpan(options: NamedSpanOptions): Span {
  return Sentry.startInactiveSpan({ ...options })
}

/** Sets attributes on an existing span. No-op for undefined/null values. */
export function setSpanAttributes(span: Span, attributes: SpanAttributesInput) {
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) continue
    span.setAttribute(key, value)
  }
}

/** Records a timestamped event on a span (visible in the span's "Events" list). */
export function addSpanEvent(
  span: Span,
  name: string,
  attributes?: Record<string, SpanAttributeValue | undefined>,
) {
  span.addEvent(name, attributes)
}

/** Marks a span's status explicitly. Use `code: 1` (OK) / `code: 2` (ERROR),
 * or `Sentry.getSpanStatusFromHttpCode(status)` for HTTP-style codes. */
export function setSpanStatus(span: Span, status: SpanStatusInput) {
  span.setStatus(status)
}

/** The span currently active on the scope, if any. */
export function activeSpan(): Span | undefined {
  return Sentry.getActiveSpan()
}
