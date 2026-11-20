# Webhook Retry Logic

Status: **module in place; no outbound webhook sender exists in `src/` yet.**

This document describes the retry policy for outbound webhook deliveries,
the module that implements it (`src/lib/webhooks/retry.ts`), its
configuration surface, and how to integrate it when the first sender
lands. It complements `contract-testing.md`, which defines the wire
contract the receiver enforces.

## Why retries need care here

The contract (`scripts/webhooks/contract/`) makes deliveries **at-least-
once by design**: receivers dedupe on the payload `idempotencyKey`
(header `Idempotency-Key` as fallback) and `webhook-id`/`payload.id`,
acknowledging duplicates with `200 { duplicate: true }`. That means:

- A retry is only safe if it reuses the **same signed body** and the
  **same Idempotency-Key** — never mint a fresh key per attempt.
- A `200` response is the only unambiguous success. Everything else is
  classified below.
- Because dedup is receiver-side, a retry after a _timeout_ is safe even
  if the receiver actually processed the first attempt: the replay is
  flagged `duplicate` and not reprocessed.

## Module layout

`src/lib/webhooks/retry.ts` is transport-agnostic — it schedules and
classifies, the caller supplies the send function.

| Export                                         | Purpose                                                                                       |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `executeWithRetry`                             | Drives `send` through the retry loop; returns a `RetryResult` union                           |
| `classifyDeliveryFailure`                      | Maps `{ status?, error?, retryAfterMs? }` → retryable / permanent                             |
| `backoffMs` / `nextDelayMs`                    | Exponential schedule + jitter + `Retry-After` handling                                        |
| `applyJitter`                                  | `full` / `equal` / `none` jitter modes                                                        |
| `resolveRetryConfig`                           | Fills defaults (`maxAttempts: 5`, `baseDelayMs: 1000`, `maxDelayMs: 60000`, `jitter: "full"`) |
| `DeliveryHttpError`                            | Throw from `send` to report an HTTP status                                                    |
| `PermanentDeliveryError`                       | Marks a failure as never-retryable (e.g. local serialization bug)                             |
| `idempotencyKeyForEvent`                       | Derives a stable `idem_<eventId>` key (≤255 chars, sanitized)                                 |
| `IDEMPOTENCY_KEY_HEADER` / `WEBHOOK_ID_HEADER` | Contract header names (`idempotency-key`, `webhook-id`)                                       |
| `isAttemptFailureResult`                       | Type guard for the `{ ok:false, failure }` alternative to throwing                            |

## Strategy

### Backoff

Delay before retry _n_ (1-based):

```
raw    = min(baseDelayMs * 2^(n-1), maxDelayMs)     // 1s, 2s, 4s, 8s, … capped at 60s
jitter = per `jitter` mode, RNG injectable via config.random
delay  = max(jittered, min(Retry-After, 2 * maxDelayMs))   // when the endpoint sent one
```

- **full** (default): `random() * raw` — maximum decorrelation, prevents
  thundering-herd retries when many deliveries hit the same endpoint.
- **equal**: `raw/2 + random() * raw/2`.
- **none**: `raw` — for tests or when the sender already staggers.

`Retry-After` (parsed by the caller into `retryAfterMs`, or thrown via
`DeliveryHttpError`'s third arg) can only _increase_ the delay, capped at
`2 * maxDelayMs` so a hostile/buggy header cannot stall a worker
indefinitely.

### Classification

`classifyDeliveryFailure` resolves in order:

1. `PermanentDeliveryError` → **permanent**.
2. HTTP status present:
   - `extraPermanentStatuses` → permanent (operator override wins first)
   - `extraRetryableStatuses` → retryable
   - `DEFAULT_PERMANENT_STATUSES` (`400, 401, 403, 404, 405, 409, 410, 413, 415, 422`)
     → permanent — these are contract violations; resending the same
     signed body will fail identically.
   - `DEFAULT_RETRYABLE_STATUSES` (`408, 425, 429, 500, 502, 503, 504`)
     → retryable.
   - Unknown status: any other `5xx` → retryable; everything else → permanent.
3. No status (thrown transport error) → **retryable** for network-class
   failures: `fetch` `TypeError`, `AbortError`/`TimeoutError`, and Node
   socket/DNS codes (`ECONNRESET`, `ECONNREFUSED`, `EPIPE`, `ETIMEDOUT`,
   `EAI_AGAIN`, `ENETUNREACH`, `EHOSTUNREACH`, `UND_ERR_*`). Any other
   thrown error → **permanent** (programmer error, bad URL).

Retries stop on the first permanent classification or when
`maxAttempts` is exhausted — the function never throws for delivery
failures; it returns `{ ok: false, reason, attempts, lastFailure, records }`.

### Max attempts

Default **5** total attempts (1 initial + 4 retries), worst-case added
latency ≈ 1+2+4+8 = 15s of sleeps plus jitter (well under typical queue
visibility timeouts). Tune via `maxAttempts`; keep the product of
`maxAttempts × per-attempt timeout` below your worker's visibility
timeout.

### Idempotency

- Derive the key once per logical delivery:
  `const key = idempotencyKeyForEvent(payload.id)` → `idem_<sanitized id>`.
- Pass the **same** key to every `send` attempt — `executeWithRetry`
  hands it to `send(attempt, idempotencyKey)` and rejects empty keys
  before the first attempt.
- Resend the **byte-identical body**. The signature covers the raw body;
  re-serializing JSON (key order, whitespace) produces a different
  signature and a different dedup surface. Keep the serialized string.

## Configuration

```ts
const result = await executeWithRetry({
  idempotencyKey: idempotencyKeyForEvent(payload.id),
  send: async (attempt, key) => {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "webhook-id": payload.id,
        [IDEMPOTENCY_KEY_HEADER]: key,
      },
      body: rawBody, // pre-serialized, identical across attempts
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      const retryAfter = parseRetryAfterMs(res.headers.get("retry-after"))
      throw new DeliveryHttpError(res.status, `status ${res.status}`, retryAfter)
    }
    return res.json()
  },
  config: {
    maxAttempts: 5, // total tries
    baseDelayMs: 1_000, // first backoff
    maxDelayMs: 60_000, // cap
    jitter: "full",
    extraRetryableStatuses: [], // e.g. provider-specific 4xx worth retrying
    extraPermanentStatuses: [], // e.g. demote 429 if the provider can't throttle
    // random / sleep are injectable for tests — never needed in prod code
  },
})
```

`send` may alternatively return `{ ok: false, failure: { status?, error?, retryAfterMs? } }`
instead of throwing; `isAttemptFailureResult` discriminates the shapes.

## Integration notes

- **Where it plugs in:** when `src/lib/webhooks/` gains a sender (or an
  outbound queue worker appears), wrap the HTTP POST in `send` as above.
  Do not call `executeWithRetry` from inside a request handler on the hot
  path — retries belong in a worker/queue with its own visibility timeout.
- **Per-attempt timeout:** the module does not time out `send` itself;
  give each attempt its own `AbortSignal.timeout` (a timeout surfaces as
  `AbortError`/`TimeoutError` → classified retryable, which is correct —
  the receiver may or may not have processed it, and dedup covers both).
- **Dead-lettering:** on `attempts_exhausted`, hand the delivery to your
  DLQ/alerting path (`docs/incidents/webhook-delivery-failures.md` covers
  the incident runbook). `records` carries per-attempt delays and failure
  reasons for forensics.
- **Clock skew / signature freshness:** the contract's 300s signature
  tolerance (`SIGNATURE_TOLERANCE_SECONDS`) bounds replay. With the
  default schedule the last retry lands ~15–30s after the first attempt —
  comfortably inside tolerance. If `maxAttempts`/`maxDelayMs` are raised
  dramatically, re-sign per attempt is _not_ an option (body must stay
  identical); instead accept that very old retries will fail signature
  verification as `timestamp_out_of_tolerance` (400 → permanent → stop).
- **Tests:** `src/lib/webhooks/retry.test.ts` injects `sleep`/`random`
  for determinism. The contract suite's mock receiver
  (`scripts/webhooks/contract/receiver.ts`) is the natural end-to-end
  target for a future sender test: point `send` at
  `receiver.start()`, sign with `buildSignatureHeader`, and assert
  `duplicate: true` on retried deliveries.

## Operational defaults rationale

| Knob          | Default | Rationale                                            |
| ------------- | ------- | ---------------------------------------------------- |
| `maxAttempts` | 5       | Covers brief 5xx/429 windows; bounds worst-case cost |
| `baseDelayMs` | 1000    | Above typical LB health-check flap intervals         |
| `maxDelayMs`  | 60000   | Below most queue visibility timeouts (5–15 min)      |
| `jitter`      | full    | Prevents synchronized retry storms across tenants    |
