import { randomUUID } from "node:crypto"
import type { Logger } from "pino"

import { logger as defaultLogger, REDACTED } from "../logger"
import { contextFields, contextFieldsFrom, getLogContext, runWithLogContextStore } from "./context"
import type { LogContextFields } from "./context"

/**
 * HTTP request logging for route handlers that do not use
 * `withRequestLogging` (src/lib/request-logging.ts) — e.g. plain `Request`
 * handlers, webhooks, or non-Next fetch-style endpoints.
 *
 * Emits the same `api.request` event shape as `withRequestLogging` so log
 * dashboards treat both wrappers identically. Differences:
 * - Works with any `Request` (not only `NextRequest`) and any handler
 *   signature via rest arguments.
 * - Runs the handler inside `runWithLogContext`, so `getContextLogger()` and
 *   `getLogContext()` work in services called downstream without threading
 *   the request object through.
 * - Does not write Sentry breadcrumbs; use `withRequestLogging` for app API
 *   routes that want Sentry correlation.
 */

export type HttpLoggingOptions = {
  logger?: Logger
}

const requestIdPattern = /^[A-Za-z0-9._:-]{1,128}$/

function normalizeRequestId(value: string | null) {
  const trimmed = value?.trim()
  return trimmed && requestIdPattern.test(trimmed) ? trimmed : undefined
}

function requestPath(url: string) {
  try {
    return new URL(url).pathname
  } catch {
    return REDACTED
  }
}

function describeError(cause: unknown) {
  if (cause instanceof Error) {
    return { type: cause.name, message: cause.message }
  }
  return { type: typeof cause, message: String(cause) }
}

function withRequestIdHeader(response: Response, requestId: string) {
  if (response.headers.get("x-request-id") === requestId) return response

  try {
    response.headers.set("x-request-id", requestId)
    return response
  } catch {
    const headers = new Headers(response.headers)
    headers.set("x-request-id", requestId)
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }
}

/**
 * Emits one `api.request` summary line for a completed request. Prefer
 * `withHttpLogging` for new handlers; this is for cases where timing or the
 * response is produced outside a wrapper.
 */
export function logHttpRequest(input: {
  request: Request
  response: Response
  durationMs: number
  logger?: Logger
  error?: unknown
}) {
  const { request, response, durationMs } = input
  const fields = contextFields()
  const requestId =
    typeof fields.requestId === "string" ? fields.requestId : requestIdFromHeader(request)

  ;(input.logger ?? defaultLogger).info(
    {
      event: "api.request",
      requestId,
      method: request.method.toUpperCase(),
      path: requestPath(request.url),
      status: response.status,
      durationMs: Math.round(durationMs * 10) / 10,
      ...fields,
      ...(input.error !== undefined ? { error: describeError(input.error) } : {}),
    },
    "api request",
  )
}

function requestIdFromHeader(request: Request) {
  return normalizeRequestId(request.headers.get("x-request-id")) ?? null
}

/**
 * Wraps a request handler: generates/propagates `x-request-id`, enters a log
 * context for the duration of the handler, emits one `api.request` line, and
 * rethrows handler errors after logging them.
 *
 * ```ts
 * export const POST = withHttpLogging(async (request: Request) => {
 *   const log = getContextLogger()
 *   log.info({ event: "webhook.received" }, "webhook received")
 *   return Response.json({ ok: true })
 * })
 * ```
 */
export function withHttpLogging<A extends unknown[]>(
  handler: (request: Request, ...args: A) => Response | Promise<Response>,
  { logger: base = defaultLogger }: HttpLoggingOptions = {},
) {
  return async function loggedHttpHandler(request: Request, ...args: A): Promise<Response> {
    const requestId = normalizeRequestId(request.headers.get("x-request-id")) ?? randomUUID()
    // The store object is shared with the handler: `extendLogContext` calls
    // inside it mutate `context`, so the summary line below picks up
    // userId/projectId even though the ALS scope has exited by then.
    const context: LogContextFields = { ...getLogContext(), requestId }
    const method = request.method.toUpperCase()
    const path = requestPath(request.url)
    const startedAt = performance.now()
    let status = 500
    let error: { type: string; message: string } | undefined

    try {
      const response = await runWithLogContextStore(context, () => handler(request, ...args))
      status = response.status
      return withRequestIdHeader(response, requestId)
    } catch (cause) {
      error = describeError(cause)
      throw cause
    } finally {
      base.info(
        {
          event: "api.request",
          requestId,
          method,
          path,
          status,
          durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
          // `context` is the same object the handler mutated via
          // `extendLogContext`, so userId/projectId set mid-request appear
          // here even though the ALS scope has already exited.
          ...contextFieldsFrom(context),
          ...(error ? { error } : {}),
        },
        "api request",
      )
    }
  }
}
