"use client"

/**
 * Abort-aware query core shared by the resource and workspace hooks.
 *
 * Every fetch runs with a fresh `AbortSignal` that is aborted on unmount or
 * dependency change, and results are discarded once the effect is no longer
 * active. `?mock=loading|empty|error` and `?mockLatency=<ms>` are honored while
 * the mock adapter is selected (`demo`/`demoLatency` work as aliases).
 */

import { useCallback, useEffect, useRef, useState } from "react"

import { ApiError } from "./client"
import {
  createMockStateError,
  getMockLatencyMs,
  getMockState,
  MOCK_STATE_EVENT,
  type MockStateMode,
} from "./mock-state"
import type { CallOptions } from "./types"

export type QueryStatus = "idle" | "loading" | "error" | "success"

export interface QueryResult<T> {
  data: T | undefined
  error: ApiError | null
  isLoading: boolean
  isRetrying: boolean
  isEmpty: boolean
  mode: MockStateMode
  status: QueryStatus
  refetch: () => void
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  return new ApiError({
    status: null,
    code: "unknown_error",
    message: error instanceof Error ? error.message : "An unexpected error occurred.",
    cause: error,
  })
}

interface QueryState<T> {
  status: QueryStatus
  mode: MockStateMode
  data: T | undefined
  error: ApiError | null
  isEmpty: boolean
}

export function useApiQuery<T>(
  fetcher: (options: CallOptions) => Promise<T>,
  deps: readonly unknown[],
  enabled = true,
  empty?: T,
): QueryResult<T> {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<QueryState<T>>(() => ({
    status: enabled ? "loading" : "idle",
    mode: enabled ? getMockState() : "ready",
    data: undefined,
    error: null,
    isEmpty: false,
  }))
  const [isRetrying, setIsRetrying] = useState(false)
  // Keep the latest fetcher/empty value without retriggering the effect.
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const emptyRef = useRef(empty)
  emptyRef.current = empty

  const refetch = useCallback(() => setAttempt((value) => value + 1), [])

  useEffect(() => {
    const bump = () => setAttempt((value) => value + 1)
    window.addEventListener(MOCK_STATE_EVENT, bump)
    window.addEventListener("popstate", bump)
    return () => {
      window.removeEventListener(MOCK_STATE_EVENT, bump)
      window.removeEventListener("popstate", bump)
    }
  }, [])

  useEffect(() => {
    if (!enabled) {
      setResult({ status: "idle", mode: "ready", data: undefined, error: null, isEmpty: false })
      setIsRetrying(false)
      return
    }

    const mode = getMockState()

    if (mode === "loading") {
      setResult((previous) => ({
        ...previous,
        status: "loading",
        mode,
        error: null,
        isEmpty: false,
      }))
      setIsRetrying(false)
      return
    }

    if (mode === "empty") {
      setResult({ status: "success", mode, data: emptyRef.current, error: null, isEmpty: true })
      setIsRetrying(false)
      return
    }

    if (mode === "error") {
      setResult((previous) => ({
        status: "error",
        mode,
        data: previous.data,
        error: createMockStateError(),
        isEmpty: false,
      }))
      setIsRetrying(false)
      return
    }

    const controller = new AbortController()
    let active = true

    setIsRetrying(attempt > 0)
    setResult((previous) => ({
      ...previous,
      status: "loading",
      mode,
      error: null,
      isEmpty: false,
    }))

    const timer = window.setTimeout(() => {
      fetcherRef
        .current({ signal: controller.signal })
        .then((data) => {
          if (active) {
            setResult({ status: "success", mode, data, error: null, isEmpty: false })
            setIsRetrying(false)
          }
        })
        .catch((error: unknown) => {
          if (active && !controller.signal.aborted) {
            setResult((previous) => ({
              status: "error",
              mode,
              data: previous.data,
              error: toApiError(error),
              isEmpty: false,
            }))
            setIsRetrying(false)
          }
        })
    }, getMockLatencyMs())

    return () => {
      active = false
      window.clearTimeout(timer)
      controller.abort()
    }
    // deps are provided by the caller; fetcher/empty are read through refs.
  }, [...deps, attempt, enabled])

  return {
    data: result.data,
    error: result.error,
    isLoading: result.status === "loading",
    isRetrying,
    isEmpty: result.isEmpty,
    mode: result.mode,
    status: result.status,
    refetch,
  }
}
