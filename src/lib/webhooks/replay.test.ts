import { describe, expect, it, vi } from "vitest"

import {
  parseReplayJsonl,
  prepareDelivery,
  replayDeliveries,
  replayJsonl,
  summarizeReplayResults,
  type StoredWebhookRecord,
} from "./replay"

/**
 * Replay engine tests. All network I/O goes through an injected fetchImpl
 * mock — no real HTTP, deterministic ordering assertions.
 */

const ENDPOINT = "https://hooks.example.com/webhooks/inbound"

function record(overrides: Partial<StoredWebhookRecord> = {}): StoredWebhookRecord {
  return {
    rawBody: JSON.stringify({
      id: "evt_replay_0001",
      type: "contact.form.submitted",
      idempotencyKey: "idem_orig_0001",
      data: { object: { email: "a@example.com" } },
    }),
    headers: {
      "webhook-id": "evt_replay_0001",
      "idempotency-key": "idem_orig_0001",
      "webhook-signature": "t=1,v1=deadbeef",
    },
    endpoint: ENDPOINT,
    recordedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  }
}

function jsonResponse(status: number, body: unknown = { received: true }): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function mockFetch(handler?: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  const calls: { url: string; init?: RequestInit }[] = []
  const impl = vi.fn(async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    if (handler) return handler(String(url), init)
    return jsonResponse(200)
  })
  // The engine only needs the fetch call signature; cast keeps TS happy.
  return { calls, impl: impl as unknown as typeof fetch }
}

describe("parseReplayJsonl", () => {
  it("parses valid lines and skips blanks", () => {
    const input = `${JSON.stringify(record())}\n\n  \n${JSON.stringify(record({ endpoint: "https://b.example.com" }))}\n`
    const { records, errors } = parseReplayJsonl(input)
    expect(errors).toHaveLength(0)
    expect(records).toHaveLength(2)
    expect(records[1]?.endpoint).toBe("https://b.example.com")
  })

  it("collects malformed lines with 1-based line numbers", () => {
    const input = `${JSON.stringify(record())}\n{bad json\n[1,2,3]\n`
    const { records, errors } = parseReplayJsonl(input)
    expect(records).toHaveLength(1)
    expect(errors.map((e) => e.line)).toEqual([2, 3])
  })
})

describe("prepareDelivery", () => {
  it("keeps the original idempotency key and headers", () => {
    const result = prepareDelivery(record())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const d = result.delivery
    expect(d.endpoint).toBe(ENDPOINT)
    expect(d.headers["idempotency-key"]).toBe("idem_orig_0001")
    expect(d.headers["webhook-id"]).toBe("evt_replay_0001")
    expect(d.rawBody).toContain("idem_orig_0001")
    expect(d.idempotencyKey).toBe("idem_orig_0001")
    expect(d.eventType).toBe("contact.form.submitted")
  })

  it("mints a new idempotency key in body and header for mode 'new'", () => {
    const result = prepareDelivery(record(), {
      idempotency: "new",
      newIdempotencyKey: () => "idem_fresh_42",
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const d = result.delivery
    expect(d.headers["idempotency-key"]).toBe("idem_fresh_42")
    expect(d.rawBody).toContain("idem_fresh_42")
    expect(d.rawBody).not.toContain("idem_orig_0001")
    // Other payload fields survive the rewrite.
    expect(d.rawBody).toContain("evt_replay_0001")
    expect(d.idempotencyKey).toBe("idem_fresh_42")
  })

  it("applies the signer after idempotency rewriting", () => {
    const seen: string[] = []
    const result = prepareDelivery(record(), {
      idempotency: "new",
      newIdempotencyKey: () => "idem_fresh_42",
      signer: (rawBody) => {
        seen.push(rawBody)
        return { "webhook-signature": "t=9,v1=signed" }
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.delivery.headers["webhook-signature"]).toBe("t=9,v1=signed")
    // Signer saw the REWRITTEN body (contains the fresh key).
    expect(seen[0]).toContain("idem_fresh_42")
  })

  it("endpoint option overrides record.endpoint", () => {
    const result = prepareDelivery(record(), { endpoint: "https://override.example.com" })
    expect(result.ok && result.delivery.endpoint).toBe("https://override.example.com")
  })

  it("fails cleanly without an endpoint or body", () => {
    expect(prepareDelivery({ rawBody: "{}" }).ok).toBe(false)
    expect(prepareDelivery({ endpoint: ENDPOINT })).toMatchObject({
      ok: false,
      error: "missing_body",
    })
  })

  it("serializes payload when rawBody is absent", () => {
    const result = prepareDelivery({
      payload: { id: "evt_x_12345678", idempotencyKey: "idem_x_12345678" },
      endpoint: ENDPOINT,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.delivery.rawBody).toContain("evt_x_12345678")
  })
})

describe("replayDeliveries", () => {
  it("delivers records sequentially in input order", async () => {
    const { calls, impl } = mockFetch()
    const records = [record(), record(), record()]
    const results = await replayDeliveries(records, { fetchImpl: impl })

    expect(calls).toHaveLength(3)
    expect(results.map((r) => r.status)).toEqual(["delivered", "delivered", "delivered"])
    expect(results.every((r) => r.attempts === 1)).toBe(true)
    // Sequential: each call awaited before next — order matches input.
    expect(calls.map((c) => c.url)).toEqual([ENDPOINT, ENDPOINT, ENDPOINT])
  })

  it("respects concurrency in parallel mode and preserves result order", async () => {
    let inFlight = 0
    let maxInFlight = 0
    const impl = (async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight -= 1
      return jsonResponse(200)
    }) as unknown as typeof fetch

    const records = Array.from({ length: 6 }, (_, i) =>
      record({
        rawBody: JSON.stringify({ id: `evt_par_${i}abcdef`, idempotencyKey: `idem_par_${i}` }),
      }),
    )
    const results = await replayDeliveries(records, {
      fetchImpl: impl,
      order: "parallel",
      concurrency: 2,
    })

    expect(maxInFlight).toBeLessThanOrEqual(2)
    expect(maxInFlight).toBeGreaterThan(1) // actually parallel, not sequential
    expect(results).toHaveLength(6)
    expect(results.map((r) => r.index)).toEqual([0, 1, 2, 3, 4, 5])
    expect(results.every((r) => r.status === "delivered")).toBe(true)
  })

  it("dry-run prepares deliveries without calling fetch", async () => {
    const { calls, impl } = mockFetch()
    const results = await replayDeliveries([record()], {
      fetchImpl: impl,
      dryRun: true,
      signer: () => ({ "webhook-signature": "t=1,v1=x" }),
    })
    expect(calls).toHaveLength(0)
    expect(results[0]?.status).toBe("dry-run")
    expect(results[0]?.endpoint).toBe(ENDPOINT)
    expect(results[0]?.idempotencyKey).toBe("idem_orig_0001")
  })

  it("marks receiver duplicates", async () => {
    const { impl } = mockFetch(() => jsonResponse(200, { received: true, duplicate: true }))
    const results = await replayDeliveries([record()], { fetchImpl: impl })
    expect(results[0]?.status).toBe("duplicate")
    expect(results[0]?.duplicate).toBe(true)
  })

  it("fails on 4xx without retrying, fails with retries exhausted on 5xx", async () => {
    const { calls: calls4xx, impl: impl4xx } = mockFetch(() => jsonResponse(400, { error: "bad" }))
    const r4 = await replayDeliveries([record()], { fetchImpl: impl4xx, retries: 2 })
    expect(r4[0]?.status).toBe("failed")
    expect(r4[0]?.httpStatus).toBe(400)
    expect(r4[0]?.attempts).toBe(1)
    expect(calls4xx).toHaveLength(1)

    const { calls: calls5xx, impl: impl5xx } = mockFetch(() => jsonResponse(503))
    const r5 = await replayDeliveries([record()], { fetchImpl: impl5xx, retries: 2 })
    expect(r5[0]?.status).toBe("failed")
    expect(r5[0]?.attempts).toBe(3)
    expect(calls5xx).toHaveLength(3)
  })

  it("retries then succeeds on transient network errors", async () => {
    let n = 0
    const impl = (async () => {
      n += 1
      if (n < 3) throw new Error("ECONNRESET")
      return jsonResponse(200)
    }) as unknown as typeof fetch

    const results = await replayDeliveries([record()], { fetchImpl: impl, retries: 3, delayMs: 0 })
    expect(results[0]?.status).toBe("delivered")
    expect(results[0]?.attempts).toBe(3)
  })

  it("skips records that fail preparation and continues the batch", async () => {
    const { calls, impl } = mockFetch()
    const results = await replayDeliveries([{ rawBody: "not json at all" }, record()], {
      fetchImpl: impl,
    })
    // First record has a body but no endpoint → skipped.
    expect(results[0]?.status).toBe("skipped")
    expect(results[0]?.error).toBe("missing_endpoint")
    expect(results[1]?.status).toBe("delivered")
    expect(calls).toHaveLength(1)
  })

  it("sorts by recordedAt when requested", async () => {
    const order: string[] = []
    const impl = (async (_url: unknown, init?: RequestInit) => {
      order.push(String((init?.body as string) ?? ""))
      return jsonResponse(200)
    }) as unknown as typeof fetch

    const late = record({
      recordedAt: "2025-01-03T00:00:00.000Z",
      rawBody: JSON.stringify({ id: "evt_late_123456", marker: "late" }),
    })
    const early = record({
      recordedAt: "2025-01-01T00:00:00.000Z",
      rawBody: JSON.stringify({ id: "evt_early_12345", marker: "early" }),
    })
    await replayDeliveries([late, early], { fetchImpl: impl, sort: "recordedAt" })
    expect(order[0]).toContain("early")
    expect(order[1]).toContain("late")
  })

  it("applies delayMs between sequential deliveries", async () => {
    const { impl } = mockFetch()
    const start = Date.now()
    await replayDeliveries([record(), record()], { fetchImpl: impl, delayMs: 20 })
    // Two delays of ~20ms between/around sends.
    expect(Date.now() - start).toBeGreaterThanOrEqual(35)
  })

  it("reports progress via onProgress", async () => {
    const { impl } = mockFetch()
    const seen: number[] = []
    await replayDeliveries([record(), record()], {
      fetchImpl: impl,
      onProgress: (r) => seen.push(r.index),
    })
    expect(seen.sort()).toEqual([0, 1])
  })
})

describe("replayJsonl + summarize", () => {
  it("end-to-end: parse JSONL then replay", async () => {
    const { impl, calls } = mockFetch(() => jsonResponse(200, { duplicate: false }))
    const jsonl = [record(), record()].map((r) => JSON.stringify(r)).join("\n")
    const parseErrors: unknown[] = []
    const { results, parseErrors: errs } = await replayJsonl(jsonl, {
      fetchImpl: impl,
      onParseErrors: (e) => parseErrors.push(...e),
    })
    expect(errs).toHaveLength(0)
    expect(parseErrors).toHaveLength(0)
    expect(calls).toHaveLength(2)
    expect(summarizeReplayResults(results)).toMatchObject({ delivered: 2, failed: 0 })
  })
})
