// @vitest-environment node

import { describe, expect, it, vi } from "vitest"

import {
  applyTraceHeaders,
  extractTraceHeaders,
  outgoingTraceHeaders,
  TRACE_HEADERS,
  traceparentHeader,
} from "./headers"

const { getTraceData } = vi.hoisted(() => ({ getTraceData: vi.fn() }))

vi.mock("@sentry/nextjs", () => ({ getTraceData }))

describe("extractTraceHeaders", () => {
  it("reads all trace headers from a Headers instance", () => {
    const headers = new Headers({
      "sentry-trace": "abc123-def456-1",
      baggage: "sentry-trace_id=abc123",
      traceparent: "00-abc123-def456-01",
      "x-request-id": "req_123",
    })

    expect(extractTraceHeaders(headers)).toEqual({
      sentryTrace: "abc123-def456-1",
      baggage: "sentry-trace_id=abc123",
      traceparent: "00-abc123-def456-01",
      requestId: "req_123",
    })
  })

  it("reads lowercase keys from a plain record", () => {
    expect(extractTraceHeaders({ "sentry-trace": "t-s-1", "x-request-id": "req_9" })).toMatchObject(
      { sentryTrace: "t-s-1", requestId: "req_9" },
    )
  })

  it("drops header values with unsafe characters or excessive length", () => {
    // A plain record can carry values a Headers instance would reject.
    const headers = {
      "sentry-trace": "bad\r\nvalue",
      baggage: `x${"y".repeat(300)}`,
      traceparent: "00-abc-def-01",
      "x-request-id": "bad id with spaces",
    }

    const result = extractTraceHeaders(headers)
    expect(result.sentryTrace).toBeUndefined()
    expect(result.baggage).toBeUndefined()
    expect(result.requestId).toBeUndefined()
    expect(result.traceparent).toBe("00-abc-def-01")
  })

  it("returns an empty object for missing headers", () => {
    expect(extractTraceHeaders(new Headers())).toEqual({
      sentryTrace: undefined,
      baggage: undefined,
      traceparent: undefined,
      requestId: undefined,
    })
  })
})

describe("outgoingTraceHeaders", () => {
  it("maps getTraceData output onto header names", () => {
    getTraceData.mockReturnValue({
      "sentry-trace": "t-s-1",
      baggage: "sentry-environment=prod",
      traceparent: "00-t-s-01",
    })

    expect(outgoingTraceHeaders()).toEqual({
      [TRACE_HEADERS.sentryTrace]: "t-s-1",
      [TRACE_HEADERS.baggage]: "sentry-environment=prod",
      [TRACE_HEADERS.traceparent]: "00-t-s-01",
    })
    expect(getTraceData).toHaveBeenCalledWith({ propagateTraceparent: true })
  })

  it("returns an empty object when there is no active trace", () => {
    getTraceData.mockReturnValue({})
    expect(outgoingTraceHeaders()).toEqual({})
  })

  it("merges caller-supplied getTraceData options", () => {
    getTraceData.mockReturnValue({})
    outgoingTraceHeaders({ span: undefined })
    expect(getTraceData).toHaveBeenCalledWith({ propagateTraceparent: true, span: undefined })
  })
})

describe("applyTraceHeaders", () => {
  it("copies trace headers onto the target", () => {
    const target = new Headers()
    applyTraceHeaders(
      target,
      new Headers({
        "sentry-trace": "t-s-1",
        baggage: "sentry-x=y",
        traceparent: "00-t-s-01",
        "x-request-id": "req_1",
      }),
    )

    expect(target.get("sentry-trace")).toBe("t-s-1")
    expect(target.get("baggage")).toBe("sentry-x=y")
    expect(target.get("traceparent")).toBe("00-t-s-01")
    // x-request-id is a correlation id, not a trace header — not copied.
    expect(target.get("x-request-id")).toBeNull()
  })
})

describe("traceparentHeader", () => {
  it("returns the traceparent value or null", () => {
    expect(traceparentHeader(new Headers({ traceparent: "00-a-b-01" }))).toBe("00-a-b-01")
    expect(traceparentHeader(new Headers())).toBeNull()
  })
})
