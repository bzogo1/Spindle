// @vitest-environment node

import { describe, expect, it, vi } from "vitest"

import {
  applyJitter,
  backoffMs,
  classifyDeliveryFailure,
  DeliveryHttpError,
  executeWithRetry,
  IDEMPOTENCY_KEY_HEADER,
  idempotencyKeyForEvent,
  isAttemptFailureResult,
  nextDelayMs,
  PermanentDeliveryError,
  resolveRetryConfig,
  WEBHOOK_ID_HEADER,
  type RetryConfig,
} from "./retry"

function fastConfig(overrides: RetryConfig = {}): RetryConfig {
  return {
    maxAttempts: 4,
    baseDelayMs: 100,
    maxDelayMs: 10_000,
    jitter: "none",
    sleep: async () => {},
    ...overrides,
  }
}

function sleeper() {
  const sleeps: number[] = []
  return {
    sleeps,
    sleep: async (ms: number) => {
      sleeps.push(ms)
    },
  }
}

describe("constants", () => {
  it("pins the contract header names", () => {
    expect(IDEMPOTENCY_KEY_HEADER).toBe("idempotency-key")
    expect(WEBHOOK_ID_HEADER).toBe("webhook-id")
  })
})

describe("classifyDeliveryFailure", () => {
  it.each([408, 425, 429, 500, 502, 503, 504])("treats status %i as retryable", (status) => {
    expect(classifyDeliveryFailure({ status }).retryable).toBe(true)
  })

  it.each([400, 401, 403, 404, 405, 409, 410, 413, 415, 422])(
    "treats status %i as permanent",
    (status) => {
      expect(classifyDeliveryFailure({ status }).retryable).toBe(false)
    },
  )

  it("treats unknown 5xx as retryable and unknown 4xx as permanent", () => {
    expect(classifyDeliveryFailure({ status: 599 }).retryable).toBe(true)
    expect(classifyDeliveryFailure({ status: 418 }).retryable).toBe(false)
    expect(classifyDeliveryFailure({ status: 302 }).retryable).toBe(false)
  })

  it("honours extra retryable/permanent status overrides", () => {
    expect(
      classifyDeliveryFailure({ status: 409 }, { extraRetryableStatuses: [409] }).retryable,
    ).toBe(true)
    expect(
      classifyDeliveryFailure({ status: 503 }, { extraPermanentStatuses: [503] }).retryable,
    ).toBe(false)
  })

  it("treats fetch TypeError as a retryable network error", () => {
    const err = new TypeError("fetch failed")
    const result = classifyDeliveryFailure({ error: err })
    expect(result.retryable).toBe(true)
    expect(result.reason).toContain("network_error")
  })

  it("treats socket/DNS error codes as retryable", () => {
    for (const code of ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN"]) {
      const err = Object.assign(new Error("socket"), { code })
      expect(classifyDeliveryFailure({ error: err }).retryable).toBe(true)
    }
  })

  it("treats abort/timeout as retryable (idempotency key makes replay safe)", () => {
    const abort = new Error("aborted")
    abort.name = "AbortError"
    expect(classifyDeliveryFailure({ error: abort }).retryable).toBe(true)
    const timeout = new Error("timed out")
    timeout.name = "TimeoutError"
    expect(classifyDeliveryFailure({ error: timeout }).retryable).toBe(true)
  })

  it("treats non-network thrown errors as permanent", () => {
    const err = new RangeError("bad input")
    expect(classifyDeliveryFailure({ error: err }).retryable).toBe(false)
    expect(classifyDeliveryFailure({ error: err }).reason).toContain("non_retryable_error")
  })

  it("treats PermanentDeliveryError as permanent even alongside a status", () => {
    const err = new PermanentDeliveryError("serialization failed")
    const result = classifyDeliveryFailure({ status: 503, error: err })
    expect(result.retryable).toBe(false)
    expect(result.reason).toContain("permanent_error")
  })

  it("classifies an empty failure as permanent", () => {
    expect(classifyDeliveryFailure({}).retryable).toBe(false)
  })
})

describe("backoff schedule", () => {
  const config = resolveRetryConfig({ baseDelayMs: 1000, maxDelayMs: 60_000, jitter: "none" })

  it("doubles each retry and caps at maxDelayMs", () => {
    expect(backoffMs(1, config)).toBe(1000)
    expect(backoffMs(2, config)).toBe(2000)
    expect(backoffMs(3, config)).toBe(4000)
    expect(backoffMs(10, config)).toBe(60_000)
  })

  it("applyJitter: none returns raw, equal halves the spread, full is [0, raw)", () => {
    expect(applyJitter(1000, "none", () => 0.9)).toBe(1000)
    expect(applyJitter(1000, "equal", () => 0)).toBe(500)
    expect(applyJitter(1000, "equal", () => 0.5)).toBe(750)
    expect(applyJitter(1000, "full", () => 0)).toBe(0)
    expect(applyJitter(1000, "full", () => 0.5)).toBe(500)
    expect(applyJitter(1000, "full", () => 0.999)).toBeLessThan(1000)
    expect(applyJitter(1000, "full", () => 0.999)).toBeGreaterThanOrEqual(998)
  })

  it("nextDelayMs honours Retry-After above the jittered backoff", () => {
    const cfg = resolveRetryConfig({
      baseDelayMs: 100,
      maxDelayMs: 10_000,
      jitter: "none",
    })
    expect(nextDelayMs(1, { retryAfterMs: 5000 }, cfg)).toBe(5000)
    expect(nextDelayMs(1, { retryAfterMs: 50 }, cfg)).toBe(100)
    // Retry-After is capped at 2x maxDelayMs so a hostile header can't stall forever.
    expect(nextDelayMs(1, { retryAfterMs: 999_999 }, cfg)).toBe(20_000)
  })
})

describe("idempotencyKeyForEvent", () => {
  it("derives a stable key from the event id", () => {
    expect(idempotencyKeyForEvent("evt_01ABC")).toBe("idem_evt_01ABC")
    expect(idempotencyKeyForEvent("evt_01ABC")).toBe(idempotencyKeyForEvent("evt_01ABC"))
  })

  it("sanitizes unsafe characters and rejects empty ids", () => {
    expect(idempotencyKeyForEvent("evt a/b?c")).toBe("idem_evt_a_b_c")
    expect(() => idempotencyKeyForEvent("   ")).toThrow(PermanentDeliveryError)
  })

  it("caps the key at 255 chars", () => {
    expect(idempotencyKeyForEvent("x".repeat(400))).toHaveLength(255)
  })
})

describe("executeWithRetry", () => {
  it("returns success on the first attempt without sleeping", async () => {
    const { sleeps, sleep } = sleeper()
    const send = vi.fn(async () => "delivered")
    const result = await executeWithRetry({
      send,
      idempotencyKey: "idem_1",
      config: { ...fastConfig(), sleep },
    })
    expect(result).toMatchObject({ ok: true, value: "delivered", attempts: 1 })
    expect(send).toHaveBeenCalledTimes(1)
    expect(sleeps).toEqual([])
  })

  it("retries retryable failures with exponential delays and a stable key", async () => {
    const { sleeps, sleep } = sleeper()
    const keys: string[] = []
    let calls = 0
    const send = vi.fn(async (_attempt: number, key: string) => {
      calls += 1
      keys.push(key)
      if (calls < 3) throw new DeliveryHttpError(503, "unavailable")
      return "ok"
    })

    const result = await executeWithRetry({
      send,
      idempotencyKey: "idem_stable",
      config: { ...fastConfig({ baseDelayMs: 100 }), sleep },
    })

    expect(result).toMatchObject({ ok: true, value: "ok", attempts: 3 })
    expect(send).toHaveBeenCalledTimes(3)
    // jitter "none": delays are exactly 100 then 200.
    expect(sleeps).toEqual([100, 200])
    // The same idempotency key went out on every attempt.
    expect(keys).toEqual(["idem_stable", "idem_stable", "idem_stable"])
    if (result.ok) {
      expect(result.records.map((r) => [r.attempt, r.delayMs, r.ok])).toEqual([
        [1, 0, false],
        [2, 100, false],
        [3, 200, true],
      ])
    }
  })

  it("stops immediately on a permanent status without retrying", async () => {
    const { sleeps, sleep } = sleeper()
    const send = vi.fn(async () => {
      throw new DeliveryHttpError(400, "invalid_payload")
    })
    const result = await executeWithRetry({
      send,
      idempotencyKey: "idem_x",
      config: { ...fastConfig(), sleep },
    })
    expect(result).toMatchObject({ ok: false, reason: "permanent_failure", attempts: 1 })
    expect(send).toHaveBeenCalledTimes(1)
    expect(sleeps).toEqual([])
  })

  it("stops immediately on PermanentDeliveryError", async () => {
    const send = vi.fn(async () => {
      throw new PermanentDeliveryError("cannot serialize")
    })
    const result = await executeWithRetry({
      send,
      idempotencyKey: "idem_x",
      config: fastConfig(),
    })
    expect(result).toMatchObject({ ok: false, reason: "permanent_failure" })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it("exhausts attempts on persistent retryable failures", async () => {
    const { sleeps, sleep } = sleeper()
    const send = vi.fn(async () => {
      throw new TypeError("fetch failed")
    })
    const result = await executeWithRetry({
      send,
      idempotencyKey: "idem_x",
      config: { ...fastConfig({ maxAttempts: 3, baseDelayMs: 10 }), sleep },
    })
    expect(result).toMatchObject({ ok: false, reason: "attempts_exhausted", attempts: 3 })
    expect(send).toHaveBeenCalledTimes(3)
    expect(sleeps).toEqual([10, 20]) // no sleep after the final attempt
  })

  it("supports send returning an AttemptFailureResult instead of throwing", async () => {
    const { sleeps, sleep } = sleeper()
    let calls = 0
    const send = vi.fn(async () => {
      calls += 1
      if (calls === 1) return { ok: false as const, failure: { status: 429 } }
      return { delivered: true }
    })
    const result = await executeWithRetry({
      send,
      idempotencyKey: "idem_y",
      config: { ...fastConfig({ baseDelayMs: 50 }), sleep },
    })
    expect(result).toMatchObject({ ok: true, attempts: 2 })
    expect(sleeps).toEqual([50])
  })

  it("rejects an empty idempotency key without calling send", async () => {
    const send = vi.fn(async () => "x")
    const result = await executeWithRetry({ send, idempotencyKey: "  ", config: fastConfig() })
    expect(result).toMatchObject({ ok: false, reason: "permanent_failure", attempts: 0 })
    expect(send).not.toHaveBeenCalled()
  })

  it("applies jitter via injected random", async () => {
    const { sleeps, sleep } = sleeper()
    let calls = 0
    const send = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new DeliveryHttpError(503)
      return "ok"
    })
    const result = await executeWithRetry({
      send,
      idempotencyKey: "idem_z",
      config: {
        ...fastConfig({ baseDelayMs: 1000 }),
        sleep,
        jitter: "full",
        random: () => 0.5,
      },
    })
    expect(result.ok).toBe(true)
    expect(sleeps).toEqual([500])
  })

  it("honours Retry-After from DeliveryHttpError", async () => {
    const { sleeps, sleep } = sleeper()
    let calls = 0
    const send = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new DeliveryHttpError(429, "rate limited", 7000)
      return "ok"
    })
    await executeWithRetry({
      send,
      idempotencyKey: "idem_ra",
      config: { ...fastConfig({ baseDelayMs: 100, maxDelayMs: 60_000 }), sleep },
    })
    expect(sleeps).toEqual([7000])
  })
})

describe("isAttemptFailureResult", () => {
  it("detects the failure-result shape only", () => {
    expect(isAttemptFailureResult({ ok: false, failure: { status: 500 } })).toBe(true)
    expect(isAttemptFailureResult({ ok: true, value: 1 })).toBe(false)
    expect(isAttemptFailureResult("nope")).toBe(false)
    expect(isAttemptFailureResult({ ok: false })).toBe(false)
  })
})
