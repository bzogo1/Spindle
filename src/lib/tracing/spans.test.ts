// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  activeSpan,
  addSpanEvent,
  setSpanAttributes,
  setSpanStatus,
  startDetachedSpan,
  withManualSpan,
  withSpan,
} from "./spans"

const sentry = vi.hoisted(() => ({
  startSpan: vi.fn(),
  startSpanManual: vi.fn(),
  startInactiveSpan: vi.fn(),
  getActiveSpan: vi.fn(),
  SPAN_STATUS_ERROR: 2,
  SPAN_STATUS_OK: 1,
}))

vi.mock("@sentry/nextjs", () => sentry)

function makeSpan() {
  return {
    setStatus: vi.fn(),
    setAttribute: vi.fn(),
    addEvent: vi.fn(),
    spanContext: () => ({ traceId: "t", spanId: "s", traceFlags: 1 }),
  }
}

describe("withSpan", () => {
  beforeEach(() => vi.clearAllMocks())

  it("passes options through to Sentry.startSpan and returns the callback result", async () => {
    const span = makeSpan()
    sentry.startSpan.mockImplementation((_opts: unknown, cb: (s: unknown) => unknown) => cb(span))

    const result = await withSpan(
      { name: "db.query", op: "db", attributes: { "db.system": "postgres" } },
      async () => 42,
    )

    expect(result).toBe(42)
    expect(sentry.startSpan).toHaveBeenCalledWith(
      { name: "db.query", op: "db", attributes: { "db.system": "postgres" } },
      expect.any(Function),
    )
  })

  it("marks the span failed and rethrows when the callback throws", async () => {
    const span = makeSpan()
    sentry.startSpan.mockImplementation((_o: unknown, cb: (s: unknown) => unknown) => cb(span))

    await expect(
      withSpan({ name: "x" }, async () => {
        throw new Error("boom")
      }),
    ).rejects.toThrow("boom")
    expect(span.setStatus).toHaveBeenCalledWith({ code: 2, message: "internal_error" })
  })

  it("does not mark the span failed on success", async () => {
    const span = makeSpan()
    sentry.startSpan.mockImplementation((_o: unknown, cb: (s: unknown) => unknown) => cb(span))

    await withSpan({ name: "x" }, async () => "ok")
    expect(span.setStatus).not.toHaveBeenCalled()
  })
})

describe("withManualSpan", () => {
  it("provides a finish callback and forwards options", async () => {
    const span = makeSpan()
    const finish = vi.fn()
    sentry.startSpanManual.mockImplementation(
      (_o: unknown, cb: (s: unknown, f: unknown) => unknown) => cb(span, finish),
    )

    const result = await withManualSpan({ name: "job", onlyIfParent: true }, async (_s, f) => {
      f()
      return "done"
    })

    expect(result).toBe("done")
    expect(finish).toHaveBeenCalled()
    expect(sentry.startSpanManual).toHaveBeenCalledWith(
      { name: "job", onlyIfParent: true },
      expect.any(Function),
    )
  })
})

describe("startDetachedSpan", () => {
  it("delegates to startInactiveSpan", () => {
    const span = makeSpan()
    sentry.startInactiveSpan.mockReturnValue(span)
    expect(startDetachedSpan({ name: "background" })).toBe(span)
    expect(sentry.startInactiveSpan).toHaveBeenCalledWith({ name: "background" })
  })
})

describe("span attribute helpers", () => {
  it("setSpanAttributes skips nullish values", () => {
    const span = makeSpan()
    setSpanAttributes(span as never, { a: "1", b: 2, c: undefined, d: null })
    expect(span.setAttribute).toHaveBeenCalledTimes(2)
    expect(span.setAttribute).toHaveBeenCalledWith("a", "1")
    expect(span.setAttribute).toHaveBeenCalledWith("b", 2)
  })

  it("addSpanEvent forwards name and attributes", () => {
    const span = makeSpan()
    addSpanEvent(span as never, "cache.miss", { key: "k" })
    expect(span.addEvent).toHaveBeenCalledWith("cache.miss", { key: "k" })
  })

  it("setSpanStatus forwards the status", () => {
    const span = makeSpan()
    setSpanStatus(span as never, { code: 1 })
    expect(span.setStatus).toHaveBeenCalledWith({ code: 1 })
  })
})

describe("activeSpan", () => {
  it("returns the active span from Sentry", () => {
    const span = makeSpan()
    sentry.getActiveSpan.mockReturnValue(span)
    expect(activeSpan()).toBe(span)
  })
})
