// GENERATED FILE — do not edit by hand.
// Regenerate with: npx tsx scripts/generate-sdk.ts
// Source of truth: src/app/api/**/route.ts

/**
 * Shared types for the generated Spindle API client.
 */

/** Runtime configuration for the generated client. */
export type SdkConfig = {
  /**
   * Base URL prepended to every endpoint path. Defaults to "" (same origin,
   * e.g. "/api/..." resolved against the page origin in the browser).
   */
  baseUrl?: string
  /** Headers sent with every request (e.g. auth tokens). */
  headers?: Record<string, string>
  /** Fetch implementation override — useful for tests or non-browser runtimes. */
  fetch?: typeof fetch
}

/** Per-request options. */
export type RequestOptions = {
  /** Additional headers merged over the configured defaults. */
  headers?: HeadersInit
  /** Abort signal forwarded to fetch. */
  signal?: AbortSignal
  /**
   * Query string parameters appended to the endpoint path. Undefined
   * values are skipped.
   */
  query?: Record<string, string | number | boolean | undefined>
}

/** Metadata for a single generated endpoint. */
export type EndpointMeta = {
  /** Exported client function name, e.g. "postContact". */
  name: string
  method: string
  /** Route path with dynamic segments as ":name". */
  path: string
  pathParams: string[]
}

/** Error thrown for any non-2xx response. */
export class ApiError extends Error {
  readonly status: number
  /** Parsed response body when available, otherwise the raw text. */
  readonly body: unknown

  constructor(status: number, message: string, body: unknown) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.body = body
  }
}
