/**
 * Outbound webhook retry policy.
 *
 * Pure scheduling/classification helpers plus `executeWithRetry`, which
 * drives an arbitrary send operation through exponential backoff with
 * jitter. The module is transport-agnostic: the caller supplies the send
 * function and maps its failures onto `DeliveryFailure` so the retry
 * policy stays identical whether the sender uses `fetch`, an SDK client,
 * or a queue worker.
 *
 * Contract alignment: this complements `scripts/webhooks/contract/` — the
 * receiver dedupes on the payload `idempotencyKey` / `webhook-id`, so
 * every retry MUST reuse the same Idempotency-Key and body. Helpers here
 * (`idempotencyKeyForEvent`, `IDEMPOTENCY_KEY_HEADER`) pin that.
 */

/** Header receivers dedupe on (contract: `webhookHeadersSchema`). */
export const IDEMPOTENCY_KEY_HEADER = "idempotency-key"

/** Header receivers use as the secondary dedup key (must equal payload.id). */
export const WEBHOOK_ID_HEADER = "webhook-id"

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

export type JitterMode = "full" | "equal" | "none"

export type RetryConfig = {
  /** Total send attempts including the first. Default 5. */
  maxAttempts?: number
  /** First backoff delay in ms before retry #1. Default 1000. */
  baseDelayMs?: number
  /** Cap on any single backoff delay in ms. Default 60_000. */
  maxDelayMs?: number
  /**
   * Jitter applied to each computed delay.
   *  - "full":  delay = random() * backoff            (max decorrelation)
   *  - "equal": delay = backoff/2 + random() * backoff/2
   *  - "none":  delay = backoff
   * Default "full".
   */
  jitter?: JitterMode
  /** Injectable RNG for deterministic tests. Default Math.random. */
  random?: () => number
  /**
   * Injectable sleep so tests never wait real time. Receives the already
   * jittered delay in ms. Default resolves via setTimeout.
   */
  sleep?: (ms: number) => Promise<void>
  /** Extra statuses treated as retryable beyond the defaults. */
  extraRetryableStatuses?: readonly number[]
  /** Extra statuses treated as permanent beyond the defaults. */
  extraPermanentStatuses?: readonly number[]
}

export const DEFAULT_RETRY_CONFIG = {
  maxAttempts: 5,
  baseDelayMs: 1_000,
  maxDelayMs: 60_000,
  jitter: "full",
} as const satisfies Required<
  Pick<RetryConfig, "maxAttempts" | "baseDelayMs" | "maxDelayMs" | "jitter">
>

/* ------------------------------------------------------------------ */
/* Error classification                                                */
/* ------------------------------------------------------------------ */

/**
 * Statuses that are worth retrying: request timeout, too early, rate
 * limited, and transient server-side failures. Everything else in the
 * 4xx range is treated as permanent — the receiver will keep rejecting
 * the same signed body.
 */
export const DEFAULT_RETRYABLE_STATUSES: ReadonlySet<number> = new Set([
  408, // Request Timeout
  425, // Too Early
  429, // Too Many Requests
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
])

/** Explicitly permanent statuses worth naming for readability in docs/tests. */
export const DEFAULT_PERMANENT_STATUSES: ReadonlySet<number> = new Set([
  400, // Bad Request — contract violation
  401, // Unauthorized
  403, // Forbidden
  404, // Not Found — endpoint gone
  405, // Method Not Allowed
  409, // Conflict
  410, // Gone
  413, // Payload Too Large (contract caps at 256 KiB)
  415, // Unsupported Media Type
  422, // Unprocessable Entity
])

/**
 * A failure observed while attempting delivery. `status` is set when the
 * endpoint answered with an HTTP status; `error` carries the thrown
 * value for transport-level failures (DNS, TCP reset, TLS, timeout).
 */
export type DeliveryFailure = {
  status?: number
  error?: unknown
  /** Parsed `Retry-After` hint in ms, when the sender could read it. */
  retryAfterMs?: number
  /** Free-form context (endpoint URL, attempt number) for logs. */
  context?: Record<string, unknown>
}

export type FailureClassification =
  { retryable: true; reason: string } | { retryable: false; reason: string }

/**
 * Marks an error as never worth retrying regardless of transport shape —
 * use when the payload itself is known-bad (e.g. local serialization
 * failure) and no HTTP attempt was made.
 */
export class PermanentDeliveryError extends Error {
  readonly cause?: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = "PermanentDeliveryError"
    this.cause = cause
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error
}

/** True for the fetch/undici transport failures that never reached a 4xx verdict. */
function isNetworkError(error: unknown): boolean {
  if (error instanceof PermanentDeliveryError) return false
  if (!(error instanceof Error)) return true // thrown non-Error = transport oddity
  // AbortError from our own request timeout is retryable: the receiver may
  // not have processed the body, and the Idempotency-Key makes a replay safe.
  if (error.name === "AbortError" || error.name === "TimeoutError") return true
  // Node socket/DNS codes surface as `code` on the error object.
  const code = (error as NodeJS.ErrnoException).code
  if (typeof code === "string") {
    return [
      "ECONNRESET",
      "ECONNREFUSED",
      "ECONNABORTED",
      "EPIPE",
      "ETIMEDOUT",
      "EAI_AGAIN",
      "ENETUNREACH",
      "EHOSTUNREACH",
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_HEADERS_TIMEOUT",
      "UND_ERR_BODY_TIMEOUT",
      "UND_ERR_SOCKET",
    ].includes(code)
  }
  // fetch() rejects with TypeError("fetch failed") for transport problems.
  if (error instanceof TypeError) return true
  return false
}

/**
 * Classifies a delivery failure as retryable or permanent.
 *
 * Rules, in order:
 *  1. `PermanentDeliveryError` → permanent.
 *  2. HTTP status present → retryable iff in the retryable set (or
 *     `extraRetryableStatuses`); explicitly permanent statuses and all
 *     other 4xx → permanent.
 *  3. No status (thrown transport error) → retryable for network-class
 *     errors (fetch TypeError, socket/DNS codes, timeouts); permanent for
 *     anything else (programmer error, bad URL).
 */
export function classifyDeliveryFailure(
  failure: DeliveryFailure,
  config: Pick<RetryConfig, "extraRetryableStatuses" | "extraPermanentStatuses"> = {},
): FailureClassification {
  const { status, error } = failure

  if (error instanceof PermanentDeliveryError) {
    return { retryable: false, reason: `permanent_error: ${error.message}` }
  }

  if (status !== undefined) {
    const extraRetryable = config.extraRetryableStatuses ?? []
    const extraPermanent = config.extraPermanentStatuses ?? []
    // Explicit config overrides win over the built-in sets so operators
    // can promote/demote statuses without forking the module.
    if (extraPermanent.includes(status)) {
      return { retryable: false, reason: `permanent_status_${status}` }
    }
    if (extraRetryable.includes(status)) {
      return { retryable: true, reason: `retryable_status_${status}` }
    }
    if (DEFAULT_PERMANENT_STATUSES.has(status)) {
      return { retryable: false, reason: `permanent_status_${status}` }
    }
    if (DEFAULT_RETRYABLE_STATUSES.has(status)) {
      return { retryable: true, reason: `retryable_status_${status}` }
    }
    // Unknown status: 5xx unknowns are treated as transient, other unknowns permanent.
    if (status >= 500 && status < 600) {
      return { retryable: true, reason: `retryable_status_${status}` }
    }
    return { retryable: false, reason: `permanent_status_${status}` }
  }

  if (error !== undefined) {
    if (isNetworkError(error)) {
      return { retryable: true, reason: `network_error: ${errorName(error)}` }
    }
    return { retryable: false, reason: `non_retryable_error: ${errorName(error)}` }
  }

  return { retryable: false, reason: "empty_failure" }
}

/* ------------------------------------------------------------------ */
/* Backoff schedule                                                    */
/* ------------------------------------------------------------------ */

export type ResolvedRetryConfig = Required<
  Pick<RetryConfig, "maxAttempts" | "baseDelayMs" | "maxDelayMs" | "jitter">
> & {
  random: () => number
  sleep: (ms: number) => Promise<void>
  extraRetryableStatuses: readonly number[]
  extraPermanentStatuses: readonly number[]
}

export function resolveRetryConfig(config: RetryConfig = {}): ResolvedRetryConfig {
  const maxAttempts = Math.max(
    1,
    Math.floor(config.maxAttempts ?? DEFAULT_RETRY_CONFIG.maxAttempts),
  )
  const baseDelayMs = Math.max(0, config.baseDelayMs ?? DEFAULT_RETRY_CONFIG.baseDelayMs)
  const maxDelayMs = Math.max(baseDelayMs, config.maxDelayMs ?? DEFAULT_RETRY_CONFIG.maxDelayMs)
  return {
    maxAttempts,
    baseDelayMs,
    maxDelayMs,
    jitter: config.jitter ?? DEFAULT_RETRY_CONFIG.jitter,
    random: config.random ?? Math.random,
    sleep:
      config.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
    extraRetryableStatuses: config.extraRetryableStatuses ?? [],
    extraPermanentStatuses: config.extraPermanentStatuses ?? [],
  }
}

/**
 * Raw exponential backoff for a 1-based retry number (1 = first retry,
 * i.e. after attempt 1 failed): base * 2^(retry-1), capped at maxDelayMs.
 */
export function backoffMs(retryNumber: number, config: ResolvedRetryConfig): number {
  const exponent = Math.max(0, retryNumber - 1)
  const raw = config.baseDelayMs * 2 ** Math.min(exponent, 30) // guard against overflow
  return Math.min(raw, config.maxDelayMs)
}

/** Applies the configured jitter mode to a raw backoff value. */
export function applyJitter(rawMs: number, jitter: JitterMode, random: () => number): number {
  const r = Math.min(Math.max(random(), 0), 0.999999)
  switch (jitter) {
    case "none":
      return rawMs
    case "equal":
      return Math.round(rawMs / 2 + r * (rawMs / 2))
    case "full":
    default:
      return Math.round(r * rawMs)
  }
}

/**
 * Delay before retry `retryNumber` (1-based), honoring `Retry-After`:
 * the effective delay is max(jittered backoff, retryAfterMs capped at
 * maxDelayMs*2 so a hostile header can't stall the worker forever).
 */
export function nextDelayMs(
  retryNumber: number,
  failure: DeliveryFailure,
  config: ResolvedRetryConfig,
): number {
  const raw = backoffMs(retryNumber, config)
  const jittered = applyJitter(raw, config.jitter, config.random)
  const retryAfter = failure.retryAfterMs
  if (retryAfter !== undefined && Number.isFinite(retryAfter) && retryAfter > 0) {
    const capped = Math.min(retryAfter, config.maxDelayMs * 2)
    return Math.max(jittered, Math.round(capped))
  }
  return jittered
}

/* ------------------------------------------------------------------ */
/* Idempotency helpers                                                 */
/* ------------------------------------------------------------------ */

/**
 * Stable Idempotency-Key for a webhook event. Derived deterministically
 * from the event id so every retry of the same logical delivery carries
 * the identical key — receivers dedupe on it. Distinct events must get
 * distinct ids upstream; do not derive from timestamps.
 */
export function idempotencyKeyForEvent(eventId: string): string {
  const trimmed = eventId.trim()
  if (!trimmed) throw new PermanentDeliveryError("idempotencyKeyForEvent: empty event id")
  const safe = trimmed.replace(/[^A-Za-z0-9_.:-]/g, "_")
  return `idem_${safe}`.slice(0, 255)
}

/* ------------------------------------------------------------------ */
/* Execution                                                           */
/* ------------------------------------------------------------------ */

export type RetryAttemptRecord = {
  attempt: number
  /** ms slept before this attempt (0 for the first). */
  delayMs: number
  ok: boolean
  failure?: DeliveryFailure
  reason?: string
}

export type RetrySuccess<T> = {
  ok: true
  value: T
  attempts: number
  records: RetryAttemptRecord[]
}

export type RetryExhausted = {
  ok: false
  reason: "permanent_failure" | "attempts_exhausted" | "non_retryable_failure"
  attempts: number
  lastFailure?: DeliveryFailure
  lastError?: unknown
  records: RetryAttemptRecord[]
}

export type RetryResult<T> = RetrySuccess<T> | RetryExhausted

export type ExecuteWithRetryOptions<T> = {
  /**
   * Performs one send attempt. Return the delivered value on success, or
   * throw / return a `DeliveryFailure`-shaped rejection. To report an HTTP
   * status without throwing, throw a `DeliveryHttpError` (below) or return
   * `{ ok: false, failure }` — see `isDeliveryFailureResult`.
   */
  send: (attempt: number, idempotencyKey: string) => Promise<T>
  /** Stable key reused verbatim on every attempt. */
  idempotencyKey: string
  config?: RetryConfig
}

/**
 * Error carrying an HTTP status for classification — throw this from
 * `send` when the endpoint answered with a non-2xx status.
 */
export class DeliveryHttpError extends Error {
  readonly status: number
  readonly retryAfterMs?: number

  constructor(status: number, message?: string, retryAfterMs?: number) {
    super(message ?? `webhook delivery failed with status ${status}`)
    this.name = "DeliveryHttpError"
    this.status = status
    this.retryAfterMs = retryAfterMs
  }
}

/** Result shape `send` may return instead of throwing for a failed attempt. */
export type AttemptFailureResult = { ok: false; failure: DeliveryFailure }

export function isAttemptFailureResult(value: unknown): value is AttemptFailureResult {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { ok?: unknown }).ok === false &&
    typeof (value as { failure?: unknown }).failure === "object"
  )
}

function toDeliveryFailure(thrown: unknown): DeliveryFailure {
  if (thrown instanceof DeliveryHttpError) {
    return { status: thrown.status, retryAfterMs: thrown.retryAfterMs, error: thrown }
  }
  return { error: thrown }
}

/**
 * Runs `send` up to `maxAttempts` times with exponential backoff + jitter.
 *
 * - Success on any attempt returns `{ ok: true, value, attempts, records }`.
 * - A permanent classification (4xx contract rejection, PermanentDeliveryError,
 *   non-network throw) stops immediately with `reason: "permanent_failure"`.
 * - Retryable failures sleep `nextDelayMs` then retry; exhaustion returns
 *   `reason: "attempts_exhausted"`.
 *
 * The same `idempotencyKey` is passed to every attempt — never mint a new
 * key per try, or receiver-side dedup is defeated.
 */
export async function executeWithRetry<T>(
  options: ExecuteWithRetryOptions<T>,
): Promise<RetryResult<T>> {
  const config = resolveRetryConfig(options.config)
  const records: RetryAttemptRecord[] = []

  if (!options.idempotencyKey || options.idempotencyKey.trim() === "") {
    return {
      ok: false,
      reason: "permanent_failure",
      attempts: 0,
      records,
      lastFailure: { error: new PermanentDeliveryError("idempotencyKey is required") },
    }
  }

  // Delay slept before the *next* attempt; consumed at the top of the loop.
  let pendingDelayMs = 0

  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    const delayMs = pendingDelayMs
    pendingDelayMs = 0

    let failure: DeliveryFailure | undefined
    let thrown: unknown
    let value: T | undefined
    let succeeded = false

    try {
      const outcome = await options.send(attempt, options.idempotencyKey)
      if (isAttemptFailureResult(outcome)) {
        failure = outcome.failure
      } else {
        value = outcome as T
        succeeded = true
      }
    } catch (err) {
      thrown = err
      failure = toDeliveryFailure(err)
    }

    if (succeeded) {
      records.push({ attempt, delayMs, ok: true })
      return { ok: true, value: value as T, attempts: attempt, records }
    }

    const classification = classifyDeliveryFailure(failure as DeliveryFailure, config)
    records.push({
      attempt,
      delayMs,
      ok: false,
      failure,
      reason: classification.reason,
    })

    if (!classification.retryable) {
      return {
        ok: false,
        reason: "permanent_failure",
        attempts: attempt,
        lastFailure: failure,
        lastError: thrown ?? failure?.error,
        records,
      }
    }

    if (attempt === config.maxAttempts) break

    // `attempt` is the 1-based retry number for the upcoming try.
    const wait = nextDelayMs(attempt, failure as DeliveryFailure, config)
    await config.sleep(wait)
    pendingDelayMs = wait
  }

  const last = records[records.length - 1]
  return {
    ok: false,
    reason: "attempts_exhausted",
    attempts: config.maxAttempts,
    lastFailure: last?.failure,
    lastError: last?.failure?.error,
    records,
  }
}
