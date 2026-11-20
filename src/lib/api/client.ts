/**
 * Thin HTTP request wrapper shared by the HTTP adapter.
 *
 * `request<T>` normalizes every failure mode — non-2xx responses, malformed
 * JSON, network failures, timeouts and aborts — into `ApiError` so callers
 * never branch on fetch internals.
 *
 * The only retry is a single 401 recovery: on an unauthorized response the
 * client asks the auth layer to refresh the session (`ensureFreshSession`,
 * which is single-flight across concurrent callers) and retries the original
 * request exactly once. A second 401 — or any non-401 failure — propagates
 * to the caller as-is.
 */

import { ensureFreshSession } from "@/lib/auth/auth-client"

export class ApiError extends Error {
  /** HTTP status, or null for network/abort/timeout failures. */
  readonly status: number | null
  /** Stable machine-readable code, e.g. "not_found", "unauthorized", "network_error". */
  readonly code: string
  /** Correlates with the backend's `x-request-id` response header when present. */
  readonly requestId: string | null
  readonly cause?: unknown

  constructor(init: {
    status: number | null
    code: string
    message: string
    requestId?: string | null
    cause?: unknown
  }) {
    super(init.message)
    this.name = "ApiError"
    this.status = init.status
    this.code = init.code
    this.requestId = init.requestId ?? null
    this.cause = init.cause
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  body?: unknown
  signal?: AbortSignal
  headers?: Record<string, string>
  /** Override the default 15s timeout (mainly for tests). */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 15_000

function requestIdFrom(headers: Headers): string | null {
  return headers.get("x-request-id") ?? headers.get("x-correlation-id")
}

function codeForStatus(status: number): string {
  if (status === 400) return "bad_request"
  if (status === 401) return "unauthorized"
  if (status === 403) return "forbidden"
  if (status === 404) return "not_found"
  if (status === 409) return "conflict"
  if (status === 422) return "validation_error"
  if (status === 429) return "rate_limited"
  if (status >= 500) return "server_error"
  return "http_error"
}

interface ErrorBody {
  code?: unknown
  message?: unknown
  error?: { code?: unknown; message?: unknown }
  requestId?: unknown
}

function errorFromBody(body: unknown, status: number, requestId: string | null): ApiError {
  const parsed = (body ?? {}) as ErrorBody
  const nested = parsed.error ?? {}
  const code = typeof parsed.code === "string" ? parsed.code : nested.code
  const message = typeof parsed.message === "string" ? parsed.message : nested.message
  const bodyRequestId = typeof parsed.requestId === "string" ? parsed.requestId : null

  return new ApiError({
    status,
    code: typeof code === "string" ? code : codeForStatus(status),
    message:
      typeof message === "string" && message.length > 0
        ? message
        : `Request failed with status ${status}.`,
    requestId: requestId ?? bodyRequestId,
  })
}

function joinUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//.test(baseUrl)) {
    return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`
  }
  // Relative base (same-origin "/api" or ""): keep the path relative.
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`
}

/** Single attempt: fetch + normalize. Never retries — see `request` below. */
async function performRequest<T>(
  baseUrl: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body, signal, headers, timeoutMs = DEFAULT_TIMEOUT_MS } = options

  const timeout = AbortSignal.timeout(timeoutMs)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout

  let response: Response
  try {
    response = await fetch(joinUrl(baseUrl, path), {
      method,
      credentials: "include",
      headers: {
        accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: combined,
    })
  } catch (cause) {
    // AbortSignal.timeout rejects with a TimeoutError; caller aborts with
    // AbortError. Distinguish by which signal fired.
    if (
      cause instanceof DOMException &&
      (cause.name === "AbortError" || cause.name === "TimeoutError")
    ) {
      if (signal?.aborted) {
        throw new ApiError({
          status: null,
          code: "aborted",
          message: "The request was cancelled.",
          cause,
        })
      }
      throw new ApiError({
        status: null,
        code: "timeout",
        message: `The request timed out after ${timeoutMs}ms.`,
        cause,
      })
    }
    throw new ApiError({
      status: null,
      code: "network_error",
      message: "The request could not reach the server.",
      cause,
    })
  }

  const requestId = requestIdFrom(response.headers)

  if (response.status === 204) {
    return undefined as T
  }

  const text = await response.text()
  let parsed: unknown
  try {
    parsed = text.length > 0 ? JSON.parse(text) : undefined
  } catch (cause) {
    if (response.ok) {
      throw new ApiError({
        status: response.status,
        code: "invalid_response",
        message: "The server returned a malformed response.",
        requestId,
        cause,
      })
    }
    parsed = undefined
  }

  if (!response.ok) {
    throw errorFromBody(parsed, response.status, requestId)
  }

  return parsed as T
}

/**
 * Performs a JSON request against `baseUrl + path`.
 *
 * - Sends `credentials: "include"` so cookie sessions work same-origin and
 *   cross-origin with proper CORS.
 * - Aborts after `DEFAULT_TIMEOUT_MS` unless the caller's signal fires first.
 * - Returns the parsed JSON body on 2xx; resolves `undefined` for 204.
 * - On a 401, refreshes the session once via `ensureFreshSession` (single-
 *   flight, so concurrent 401s share one refresh) and retries the request a
 *   single time. The retry goes through `performRequest` directly, so it can
 *   never itself trigger another refresh cycle.
 */
export async function request<T>(
  baseUrl: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  try {
    return await performRequest<T>(baseUrl, path, options)
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) {
      throw error
    }
    try {
      await ensureFreshSession()
    } catch {
      // The refresh itself failed — surface the original 401 rather than
      // masking it with the refresh error.
      throw error
    }
    return performRequest<T>(baseUrl, path, options)
  }
}
