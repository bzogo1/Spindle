import { describe, expect, it } from "vitest"

import { ApiError } from "@/lib/api/client"

import { getErrorReference } from "./error-reference"

describe("getErrorReference", () => {
  it("returns an empty string for missing or primitive errors", () => {
    expect(getErrorReference(undefined)).toBe("")
    expect(getErrorReference(null)).toBe("")
    expect(getErrorReference("boom")).toBe("")
    expect(getErrorReference(42)).toBe("")
  })

  it("returns the request id from an ApiError", () => {
    const error = new ApiError({
      status: 500,
      code: "server_error",
      message: "Failure",
      requestId: "req_api",
    })

    expect(getErrorReference(error)).toBe("req_api")
  })

  it("ignores an ApiError without a request id", () => {
    const error = new ApiError({
      status: 500,
      code: "server_error",
      message: "Failure",
    })

    expect(getErrorReference(error)).toBe("")
  })

  it("reads requestId and requestID from plain error objects", () => {
    expect(getErrorReference({ requestId: "req_lower" })).toBe("req_lower")
    expect(getErrorReference({ requestID: "req_upper" })).toBe("req_upper")
  })

  it("prefers the request id over a digest", () => {
    expect(getErrorReference({ requestId: "req_1", digest: "dig_1" })).toBe("req_1")
  })

  it("falls back to the digest when no request id is present", () => {
    expect(getErrorReference({ digest: "dig_nextjs" })).toBe("dig_nextjs")
  })

  it("returns an empty string for non-string or missing fields", () => {
    expect(getErrorReference({ requestId: 123, digest: "dig_2" })).toBe("dig_2")
    expect(getErrorReference({ digest: 123 })).toBe("")
    expect(getErrorReference({})).toBe("")
    expect(getErrorReference(new Error("plain"))).toBe("")
  })
})
