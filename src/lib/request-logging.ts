import * as Sentry from "@sentry/nextjs"
import type { Logger } from "pino"
import type { NextRequest } from "next/server"
import { randomUUID } from "node:crypto"

import { logger as defaultLogger, REDACTED } from "./logger"

/**
 * Request tracing for route handlers.
 *
 * Wrap a handler once and every request produces exactly one JSON summary line
 * containing the request id, method, path, status, duration, and the user and
 * project ids set by the handler. Errors also leave a Sentry breadcrumb so a
 * captured event explains which request failed.
 *
 * Paths only are logged: query strings can carry signed URL signatures and
 * tokens, so they never reach the logger.
 */

export type RequestLogFields = {
  userId?: string | null
  projectId?: string | null
}

type RequestLogState = RequestLogFields & {
  requestId: string
  logger: Logger
}

const states = new WeakMap<Request, RequestLogState>()

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

function addBreadcrumb(input: {
  requestId: string
  method: string
  path: string
  status: number
  error?: { type: string; message: string }
}) {
  Sentry.addBreadcrumb({
    category: "api",
    level: input.status >= 500 ? "error" : "warning",
    message: `${input.method} ${input.path} -> ${input.status}`,
    data: {
      requestId: input.requestId,
      method: input.method,
      path: input.path,
      status: input.status,
      ...(input.error ? { error: input.error.type, reason: input.error.message } : {}),
    },
  })
}

function withRequestIdHeader(response: Response, requestId: string) {
  if (response.headers.get("x-request-id") === requestId) return response

  try {
    response.headers.set("x-request-id", requestId)
    return response
  } catch {
    // Some responses are built with immutable headers.
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
 * Adds the request's ids to the summary line. Call this once the session and
 * project have been resolved; a request without a wrapper is a no-op.
 */
export function setRequestLogContext(request: Request, fields: RequestLogFields) {
  const state = states.get(request)
  if (!state) return

  if (fields.userId !== undefined) state.userId = fields.userId
  if (fields.projectId !== undefined) state.projectId = fields.projectId
}

/** The request-scoped logger, already bound to the request id. */
export function getRequestLogger(request: Request): Logger {
  return states.get(request)?.logger ?? defaultLogger
}

export type RequestLoggingOptions = {
  logger?: Logger
}

export function withRequestLogging<Context>(
  handler: (request: NextRequest, context: Context) => Response | Promise<Response>,
  { logger: requestLog = defaultLogger }: RequestLoggingOptions = {},
) {
  return async function loggedRequestHandler(
    request: NextRequest,
    context: Context,
  ): Promise<Response> {
    const requestId = normalizeRequestId(request.headers.get("x-request-id")) ?? randomUUID()
    const state: RequestLogState = { requestId, logger: requestLog.child({ requestId }) }
    states.set(request, state)

    const method = request.method.toUpperCase()
    const path = requestPath(request.url)
    const startedAt = performance.now()
    let status = 500
    let error: { type: string; message: string } | undefined

    try {
      const response = await handler(request, context)
      status = response.status

      if (status >= 400) {
        addBreadcrumb({ requestId, method, path, status })
      }

      return withRequestIdHeader(response, requestId)
    } catch (cause) {
      error = describeError(cause)

      addBreadcrumb({ requestId, method, path, status, error })

      // The Sentry `onRequestError` hook in instrumentation.ts reports the
      // exception; rethrowing keeps Next's default error response intact.
      throw cause
    } finally {
      states.delete(request)

      requestLog.info(
        {
          event: "api.request",
          requestId,
          method,
          path,
          status,
          durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
          userId: state.userId ?? null,
          projectId: state.projectId ?? null,
          ...(error ? { error } : {}),
        },
        "api request",
      )
    }
  }
}
