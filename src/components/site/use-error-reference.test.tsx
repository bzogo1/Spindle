import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }))

vi.mock("@sentry/nextjs", () => ({ captureException }))

import { useErrorReference } from "./use-error-reference"

describe("useErrorReference", () => {
  beforeEach(() => {
    captureException.mockReset()
  })

  afterEach(() => {
    Reflect.deleteProperty(navigator, "clipboard")
  })

  it("reports an error once and exposes the Sentry event id", () => {
    captureException.mockReturnValue("event-123")
    const error = new Error("boom")

    const { result, rerender } = renderHook(({ value }) => useErrorReference(value), {
      initialProps: { value: error },
    })

    expect(captureException).toHaveBeenCalledTimes(1)
    expect(captureException).toHaveBeenCalledWith(error)
    expect(result.current.reference).toBe("event-123")

    rerender({ value: error })
    expect(captureException).toHaveBeenCalledTimes(1)
  })

  it("falls back to the server digest when Sentry returns no event id", () => {
    captureException.mockReturnValue("")

    const { result } = renderHook(() => useErrorReference({ digest: "digest-abc" }))

    expect(result.current.reference).toBe("digest-abc")
  })

  it("never exposes the error message as the reference", () => {
    captureException.mockReturnValue("")

    const { result } = renderHook(() => useErrorReference(new Error("secret internal detail")))

    expect(result.current.reference).toBe("")
  })

  it("copies the reference to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })
    captureException.mockReturnValue("event-456")

    const { result } = renderHook(() => useErrorReference(new Error("boom")))

    await act(async () => {
      await result.current.copyReference()
    })

    expect(writeText).toHaveBeenCalledWith("event-456")
    expect(result.current.copied).toBe(true)
  })
})
