import { getTraceData } from "@sentry/nextjs"

/**
 * Trace propagation header names.
 *
 * Sentry uses two headers for its own format — `sentry-trace` (trace/span ids
 * plus the sampling decision) and `baggage` (the dynamic sampling context) —
 * and W3C Trace Context adds `traceparent` for interoperability with OTel and
 * other instrumented services. `x-request-id` is Spindle's own correlation id
 * from `src/lib/request-logging.ts`; it travels alongside, not inside, the
 * trace headers.
 */
export const TRACE_HEADERS = {
  sentryTrace: "sentry-trace",
  baggage: "baggage",
  traceparent: "traceparent",
  requestId: "x-request-id",
} as const

export type IncomingTraceHeaders = {
  sentryTrace?: string
  baggage?: string
  traceparent?: string
  requestId?: string
}

/** Header values that are safe to echo into logs and docs: bounded charset, no CRLF. */
const safeHeaderValue = /^[\x21-\x7E]{1,256}$/

const requestIdPattern = /^[A-Za-z0-9._:-]{1,128}$/

function clean(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed && safeHeaderValue.test(trimmed) ? trimmed : undefined
}

function cleanRequestId(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed && requestIdPattern.test(trimmed) ? trimmed : undefined
}

/** Reads the trace and correlation headers from an incoming Request/Headers. */
export function extractTraceHeaders(
  headers: Headers | Record<string, string | null | undefined>,
): IncomingTraceHeaders {
  const get = (name: string) =>
    headers instanceof Headers
      ? headers.get(name)
      : (headers[name] ?? headers[name.toLowerCase()] ?? null)

  return {
    sentryTrace: clean(get(TRACE_HEADERS.sentryTrace)),
    baggage: clean(get(TRACE_HEADERS.baggage)),
    traceparent: clean(get(TRACE_HEADERS.traceparent)),
    requestId: cleanRequestId(get(TRACE_HEADERS.requestId)),
  }
}

/**
 * The trace headers to attach to an *outgoing* request (fetch, upstream API
 * call). Returns `sentry-trace`, `baggage`, and `traceparent` when Sentry has
 * an active trace; `{}` otherwise. Spread the result into a `Headers` object
 * or a fetch `headers` init.
 *
 * If an external propagator (e.g. an OTel integration) is registered and no
 * Sentry span is active, `getTraceData` returns `{}` on purpose — the external
 * propagator then owns the outgoing headers.
 */
export function outgoingTraceHeaders(
  options?: Parameters<typeof getTraceData>[0],
): Record<string, string> {
  const data = getTraceData({ propagateTraceparent: true, ...options })
  const headers: Record<string, string> = {}

  if (data["sentry-trace"]) headers[TRACE_HEADERS.sentryTrace] = data["sentry-trace"]
  if (data.baggage) headers[TRACE_HEADERS.baggage] = data.baggage
  if (data.traceparent) headers[TRACE_HEADERS.traceparent] = data.traceparent

  return headers
}

/** Copies trace headers from `source` onto `target`, overwriting existing values. */
export function applyTraceHeaders(
  target: Headers,
  source: Headers | Record<string, string | null | undefined>,
) {
  const incoming = extractTraceHeaders(source)

  if (incoming.sentryTrace) target.set(TRACE_HEADERS.sentryTrace, incoming.sentryTrace)
  if (incoming.baggage) target.set(TRACE_HEADERS.baggage, incoming.baggage)
  if (incoming.traceparent) target.set(TRACE_HEADERS.traceparent, incoming.traceparent)
}

/**
 * Copies only the W3C `traceparent` and `baggage`-compatible correlation id
 * for non-Sentry consumers. Kept separate from `applyTraceHeaders` so callers
 * can opt into partial propagation.
 */
export function traceparentHeader(headers: Headers) {
  return headers.get(TRACE_HEADERS.traceparent)
}
