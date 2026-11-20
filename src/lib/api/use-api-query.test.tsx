import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "./client"
import { notifyMockStateChange } from "./mock-state"
import type { CallOptions } from "./types"
import { toApiError, useApiQuery } from "./use-api-query"

function setSearch(search: string) {
  window.history.replaceState(null, "", `/${search}`)
}

describe("useApiQuery", () => {
  beforeEach(() => {
    setSearch("")
  })

  it("stays idle and never calls the fetcher when disabled", async () => {
    const fetcher = vi.fn(async () => "data")
    const { result, rerender } = renderHook(({ enabled }) => useApiQuery(fetcher, [], enabled), {
      initialProps: { enabled: false },
    })

    expect(result.current.status).toBe("idle")
    expect(result.current.isLoading).toBe(false)
    expect(result.current.isRetrying).toBe(false)

    // Flush effects; the disabled branch must not schedule a fetch.
    await act(async () => {})
    expect(fetcher).not.toHaveBeenCalled()

    rerender({ enabled: true })
    await waitFor(() => expect(result.current.status).toBe("success"))
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(result.current.data).toBe("data")
  })

  it("reports the loading mock state without calling the fetcher", async () => {
    setSearch("?mock=loading")
    const fetcher = vi.fn(async () => "data")

    const { result } = renderHook(() => useApiQuery(fetcher, []))

    await waitFor(() => expect(result.current.mode).toBe("loading"))
    expect(result.current.status).toBe("loading")
    expect(result.current.isLoading).toBe(true)
    expect(result.current.error).toBeNull()

    await act(async () => {})
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("resolves the empty mock state with the provided empty value", async () => {
    setSearch("?mock=empty")
    const empty: string[] = []
    const fetcher = vi.fn(async () => ["real"])

    const { result } = renderHook(() => useApiQuery(fetcher, [], true, empty))

    await waitFor(() => expect(result.current.status).toBe("success"))
    expect(result.current.mode).toBe("empty")
    expect(result.current.isEmpty).toBe(true)
    expect(result.current.data).toBe(empty)
    expect(result.current.error).toBeNull()

    await act(async () => {})
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("surfaces the error mock state as an ApiError", async () => {
    setSearch("?mock=error")
    const fetcher = vi.fn(async () => "data")

    const { result } = renderHook(() => useApiQuery(fetcher, []))

    await waitFor(() => expect(result.current.status).toBe("error"))
    expect(result.current.mode).toBe("error")
    expect(result.current.error).toBeInstanceOf(ApiError)
    expect(result.current.error).toMatchObject({ status: 503, code: "mock_error" })
    expect(result.current.isLoading).toBe(false)

    await act(async () => {})
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("fetches on mount, forwards the abort signal, and resolves data", async () => {
    const signals: AbortSignal[] = []
    const fetcher = vi.fn((options: CallOptions) => {
      signals.push(options.signal as AbortSignal)
      return Promise.resolve("payload")
    })

    const { result } = renderHook(() => useApiQuery(fetcher, []))

    // The first render reports loading before the timeout fires.
    expect(result.current.status).toBe("loading")
    expect(result.current.isLoading).toBe(true)

    await waitFor(() => expect(result.current.status).toBe("success"))
    expect(result.current.data).toBe("payload")
    expect(result.current.error).toBeNull()
    expect(result.current.isEmpty).toBe(false)
    expect(result.current.isRetrying).toBe(false)

    expect(signals).toHaveLength(1)
    expect(signals[0]).toBeInstanceOf(AbortSignal)
    expect(signals[0].aborted).toBe(false)
  })

  it("wraps non-ApiError rejections and preserves ApiError instances", async () => {
    const failing = renderHook(() =>
      useApiQuery(() => Promise.reject(new Error("network down")), []),
    )
    await waitFor(() => expect(failing.result.current.status).toBe("error"))
    expect(failing.result.current.error).toMatchObject({
      code: "unknown_error",
      message: "network down",
    })
    failing.unmount()

    const apiError = new ApiError({ status: 418, code: "teapot", message: "short and stout" })
    const passthrough = renderHook(() => useApiQuery(() => Promise.reject(apiError), []))
    await waitFor(() => expect(passthrough.result.current.status).toBe("error"))
    expect(passthrough.result.current.error).toBe(apiError)
  })

  it("sets isRetrying while a refetch is in flight and clears it on success", async () => {
    const resolvers: Array<(value: string) => void> = []
    const fetcher = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolvers.push(resolve)
        }),
    )

    const { result } = renderHook(() => useApiQuery(fetcher, []))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    expect(result.current.isRetrying).toBe(false)

    act(() => result.current.refetch())
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.isRetrying).toBe(true))
    expect(result.current.isLoading).toBe(true)

    await act(async () => {
      resolvers[1]("retried")
      await Promise.resolve()
    })
    await waitFor(() => expect(result.current.status).toBe("success"))
    expect(result.current.data).toBe("retried")
    expect(result.current.isRetrying).toBe(false)
  })

  it("refetches when dependencies change and aborts the previous signal", async () => {
    const signals: AbortSignal[] = []
    const fetcher = vi.fn((options: CallOptions) => {
      signals.push(options.signal as AbortSignal)
      return Promise.resolve("ok")
    })

    const { result, rerender } = renderHook(({ dep }) => useApiQuery(fetcher, [dep]), {
      initialProps: { dep: "a" },
    })
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(result.current.status).toBe("success"))

    rerender({ dep: "b" })
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.status).toBe("success"))

    expect(signals[0].aborted).toBe(true)
    expect(signals[1].aborted).toBe(false)
  })

  it("discards stale results that resolve after a dependency change", async () => {
    const resolvers: Array<(value: string) => void> = []
    const fetcher = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolvers.push(resolve)
        }),
    )

    const { result, rerender } = renderHook(({ dep }) => useApiQuery(fetcher, [dep]), {
      initialProps: { dep: "first" },
    })
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))

    rerender({ dep: "second" })
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))

    // The newer request resolves first and wins.
    await act(async () => {
      resolvers[1]("second-result")
      await Promise.resolve()
    })
    await waitFor(() => expect(result.current.data).toBe("second-result"))

    // The stale request resolves late and must be ignored.
    await act(async () => {
      resolvers[0]("first-result")
      await Promise.resolve()
    })
    await act(async () => {})
    expect(result.current.data).toBe("second-result")
    expect(result.current.status).toBe("success")
  })

  it("aborts the in-flight signal on unmount", async () => {
    let signal: AbortSignal | undefined
    const fetcher = vi.fn((options: CallOptions) => {
      signal = options.signal
      return new Promise<string>(() => {})
    })

    const { unmount } = renderHook(() => useApiQuery(fetcher, []))
    await waitFor(() => expect(fetcher).toHaveBeenCalled())

    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal?.aborted).toBe(false)

    unmount()
    expect(signal?.aborted).toBe(true)
  })

  it("refetches when the mock state change event fires", async () => {
    const fetcher = vi.fn(async () => "data")
    const { result } = renderHook(() => useApiQuery(fetcher, []))
    await waitFor(() => expect(result.current.status).toBe("success"))
    expect(fetcher).toHaveBeenCalledTimes(1)

    await act(async () => {
      notifyMockStateChange()
      await Promise.resolve()
    })
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  })
})

describe("toApiError", () => {
  it("passes ApiError through and wraps unknown values", () => {
    const apiError = new ApiError({ status: 500, code: "x", message: "x" })
    expect(toApiError(apiError)).toBe(apiError)

    const wrapped = toApiError("nope")
    expect(wrapped).toBeInstanceOf(ApiError)
    expect(wrapped.code).toBe("unknown_error")
    expect(wrapped.message).toBe("An unexpected error occurred.")
  })
})
