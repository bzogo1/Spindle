"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { ApiError } from "./client"
import {
  createMockStateError,
  getMockLatencyMs,
  getMockState,
  MOCK_STATE_EVENT,
  type MockStateMode,
} from "./mock-state"

export interface MockQueryResult<T> {
  status: "loading" | "error" | "success"
  mode: MockStateMode
  data: T | undefined
  error: ApiError | undefined
  isRetrying: boolean
  refetch: () => void
}

function asApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  return new ApiError({
    status: null,
    code: "unknown",
    message: error instanceof Error ? error.message : "The request failed.",
    cause: error,
  })
}

/**
 * Mock-aware query hook. In mock mode it honors `?mock=loading|empty|error`,
 * `?mockLatency=<ms>`, and `NEXT_PUBLIC_API_MODE`; outside mock mode it simply
 * calls the loader. `empty` is the dataset returned for `?mock=empty`.
 */
export function useMockQuery<T>(
  key: string,
  loader: () => Promise<T>,
  options: { empty?: T; state?: MockStateMode } = {},
): MockQueryResult<T> {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{
    status: "loading" | "error" | "success"
    mode: MockStateMode
    data?: T
    error?: ApiError
  }>({ status: "loading", mode: "loading" })
  const [isRetrying, setIsRetrying] = useState(false)

  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const optionsRef = useRef(options)
  optionsRef.current = options

  const refetch = useCallback(() => setAttempt((value) => value + 1), [])

  useEffect(() => {
    let cancelled = false

    const state = optionsRef.current.state ?? getMockState()

    if (state === "loading") {
      setResult((previous) => ({ status: "loading", mode: state, data: previous.data }))
      setIsRetrying(false)
      return
    }

    if (state === "empty") {
      setResult({ status: "success", mode: state, data: optionsRef.current.empty })
      setIsRetrying(false)
      return
    }

    if (state === "error") {
      setResult((previous) => ({
        status: "error",
        mode: state,
        data: previous.data,
        error: createMockStateError(),
      }))
      setIsRetrying(false)
      return
    }

    setIsRetrying(attempt > 0)
    setResult((previous) => ({ status: "loading", mode: state, data: previous.data }))

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const data = await loaderRef.current()
          if (cancelled) return
          setResult({ status: "success", mode: state, data })
          setIsRetrying(false)
        } catch (error) {
          if (cancelled) return
          setResult((previous) => ({
            status: "error",
            mode: state,
            data: previous.data,
            error: asApiError(error),
          }))
          setIsRetrying(false)
        }
      })()
    }, getMockLatencyMs())

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [key, attempt])

  useEffect(() => {
    const bump = () => setAttempt((value) => value + 1)
    window.addEventListener(MOCK_STATE_EVENT, bump)
    window.addEventListener("popstate", bump)
    return () => {
      window.removeEventListener(MOCK_STATE_EVENT, bump)
      window.removeEventListener("popstate", bump)
    }
  }, [])

  return {
    status: result.status,
    mode: result.mode,
    data: result.data,
    error: result.error,
    isRetrying,
    refetch,
  }
}
