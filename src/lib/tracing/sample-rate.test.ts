import { describe, expect, it } from "vitest"

import {
  DEFAULT_TRACES_SAMPLE_RATE,
  makeTracesSampler,
  parseSampleRate,
  resolveTracesSampleRate,
} from "./sample-rate"

describe("parseSampleRate", () => {
  it("accepts numbers in [0, 1]", () => {
    expect(parseSampleRate("0.5")).toBe(0.5)
    expect(parseSampleRate("0")).toBe(0)
    expect(parseSampleRate("1")).toBe(1)
  })

  it("accepts percentage strings", () => {
    expect(parseSampleRate("10%")).toBe(0.1)
    expect(parseSampleRate("100%")).toBe(1)
  })

  it("rejects out-of-range and non-numeric values", () => {
    expect(parseSampleRate("2")).toBeUndefined()
    expect(parseSampleRate("-0.1")).toBeUndefined()
    expect(parseSampleRate("abc")).toBeUndefined()
    expect(parseSampleRate("")).toBeUndefined()
    expect(parseSampleRate(null)).toBeUndefined()
    expect(parseSampleRate(undefined)).toBeUndefined()
    expect(parseSampleRate("150%")).toBeUndefined()
  })
})

describe("resolveTracesSampleRate", () => {
  it("uses the env override when valid", () => {
    expect(resolveTracesSampleRate("0.25")).toBe(0.25)
  })

  it("falls back to the default", () => {
    expect(resolveTracesSampleRate(undefined)).toBe(DEFAULT_TRACES_SAMPLE_RATE)
    expect(resolveTracesSampleRate("garbage")).toBe(DEFAULT_TRACES_SAMPLE_RATE)
  })
})

describe("makeTracesSampler", () => {
  it("drops health checks, always samples errors, uses base rate otherwise", () => {
    const sampler = makeTracesSampler(0.2)

    expect(sampler({ isHealthCheck: true })).toBe(0)
    expect(sampler({ hasError: true })).toBe(1)
    expect(sampler({ name: "GET /api/x" })).toBe(0.2)
  })

  it("defaults to the shared default rate", () => {
    expect(makeTracesSampler()({})).toBe(DEFAULT_TRACES_SAMPLE_RATE)
  })
})
