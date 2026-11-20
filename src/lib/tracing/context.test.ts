// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  continueTraceFromHeaders,
  continueTraceFromRequest,
  getTraceContext,
  startNewTrace,
  tagRequestContext,
} from "./context"

const sentry = vi.hoisted(() => ({
  continueTrace: vi.fn((_opts: unknown, cb: () => unknown) => cb()),
  getActiveSpan: vi.fn(),
  getTraceData: vi.fn(),
  getCurrentScope: vi.fn(),
  startNewTrace: vi.fn((cb: () => unknown) => cb()),
}))

vi.mock("@sentry/nextjs", () => sentry)

describe("continueTraceFromRequest", () => {
  beforeEach(() => vi.clearAllMocks())

  it("continues the trace from sentry-trace and baggage headers", () => {
    const request = new Request("https://app.test/api/x", {
      headers: { "sentry-trace": "t-s-1", baggage: "sentry-x=y" },
    })

    const result = continueTraceFromRequest(request, () => "ran")

    expect(result).toBe("ran")
    expect(sentry.continueTrace).toHaveBeenCalledWith(
      { sentryTrace: "t-s-1", baggage: "sentry-x=y" },
      expect.any(Function),
    )
  })

  it("runs without continueTrace when no sentry-trace header is present", () => {
    const request = new Request("https://app.test/api/x", {
      headers: { traceparent: "00-t-s-01" },
    })

    expect(continueTraceFromRequest(request, () => 7)).toBe(7)
    expect(sentry.continueTrace).not.toHaveBeenCalled()
  })
})

describe("continueTraceFromHeaders", () => {
  it("passes extracted header values through", () => {
    continueTraceFromHeaders({ sentryTrace: "t-s-0", baggage: undefined }, () => "ok")
    expect(sentry.continueTrace).toHaveBeenCalledWith(
      { sentryTrace: "t-s-0", baggage: undefined },
      expect.any(Function),
    )
  })
})

describe("tagRequestContext", () => {
  it("sets request/user/project tags on the current scope", () => {
    const setTag = vi.fn()
    sentry.getCurrentScope.mockReturnValue({ setTag })

    tagRequestContext({ requestId: "req_1", userId: "user_1", projectId: "proj_1" })

    expect(setTag).toHaveBeenCalledWith("request_id", "req_1")
    expect(setTag).toHaveBeenCalledWith("user_id", "user_1")
    expect(setTag).toHaveBeenCalledWith("project_id", "proj_1")
  })

  it("skips absent fields", () => {
    const setTag = vi.fn()
    sentry.getCurrentScope.mockReturnValue({ setTag })

    tagRequestContext({ requestId: null, userId: undefined })
    expect(setTag).not.toHaveBeenCalled()
  })
})

describe("getTraceContext", () => {
  beforeEach(() => vi.clearAllMocks())

  it("reads ids from the active span and builds propagation headers", () => {
    sentry.getActiveSpan.mockReturnValue({
      spanContext: () => ({ traceId: "trace-1", spanId: "span-1", traceFlags: 1 }),
    })
    sentry.getTraceData.mockReturnValue({
      "sentry-trace": "trace-1-span-1-1",
      baggage: "sentry-env=prod",
      traceparent: "00-trace-1-span-1-01",
    })

    expect(getTraceContext()).toEqual({
      traceId: "trace-1",
      spanId: "span-1",
      sampled: true,
      headers: {
        "sentry-trace": "trace-1-span-1-1",
        baggage: "sentry-env=prod",
        traceparent: "00-trace-1-span-1-01",
      },
    })
  })

  it("falls back to the sentry-trace header for traceId when no span is active", () => {
    sentry.getActiveSpan.mockReturnValue(undefined)
    sentry.getTraceData.mockReturnValue({
      "sentry-trace": "0123456789abcdef0123456789abcdef-0123456789abcdef-0",
    })

    const ctx = getTraceContext()
    expect(ctx.traceId).toBe("0123456789abcdef0123456789abcdef")
    expect(ctx.spanId).toBeUndefined()
    expect(ctx.sampled).toBeUndefined()
    expect(ctx.headers["sentry-trace"]).toBe("0123456789abcdef0123456789abcdef-0123456789abcdef-0")
  })
})

describe("startNewTrace", () => {
  it("delegates to Sentry.startNewTrace", () => {
    expect(startNewTrace(() => "fresh")).toBe("fresh")
    expect(sentry.startNewTrace).toHaveBeenCalled()
  })
})
