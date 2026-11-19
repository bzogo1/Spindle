"use client"

/**
 * Minimal data-fetching hooks over the `ApiClient` contract.
 *
 * - Queries expose `{ data, error, isLoading, refetch }` and abort their
 *   in-flight request on unmount or dependency change; state is never updated
 *   after unmount, so the hooks are StrictMode-safe.
 * - `useMutation` wraps write calls with the same state shape.
 *
 * No external data-fetching library is used by design; revisit if cache
 * invalidation or request deduplication becomes necessary.
 */

import { useCallback, useEffect, useRef, useState } from "react"

import { ApiError } from "./client"
import {
  createEmptyAppSettings,
  createEmptyProjectHome,
  createEmptyUsageSummary,
  createEmptyWorkspaceDashboard,
} from "./empty"
import { api } from "./instance"
import {
  createMockStateError,
  getMockLatencyMs,
  getMockState,
  MOCK_STATE_EVENT,
  type MockStateMode,
} from "./mock-state"
import { useMockQuery, type MockQueryResult } from "./use-mock-query"
import type {
  AgentRun,
  AppSettingsData,
  CallOptions,
  ChatMessage,
  LabSession,
  Project,
  ProjectFile,
  ProjectHomeData,
  UsageSummary,
  User,
  WorkspaceDashboard,
} from "./types"

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

export interface MutationResult<TArgs extends unknown[], TResult> {
  mutate: (...args: TArgs) => Promise<TResult>
  data: TResult | undefined
  error: ApiError | null
  isLoading: boolean
  reset: () => void
}

function toApiError(error: unknown): ApiError {
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

function useApiQuery<T>(
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

export function useProjects(): QueryResult<Project[]> {
  return useApiQuery((options) => api.projects.listProjects(options), [], true, [])
}

export function useProject(id: string | undefined): QueryResult<Project> {
  return useApiQuery(
    (options) => {
      // `enabled` guarantees id is set when this runs.
      return api.projects.getProject(id as string, options)
    },
    [id],
    id !== undefined,
  )
}

export function useFiles(projectId?: string): QueryResult<ProjectFile[]> {
  return useApiQuery((options) => api.files.listFiles(projectId, options), [projectId], true, [])
}

export function useLabSessions(projectId?: string): QueryResult<LabSession[]> {
  return useApiQuery((options) => api.lab.listLabSessions(projectId, options), [projectId], true, [])
}

export function useChatMessages(conversationId: string): QueryResult<ChatMessage[]> {
  return useApiQuery(
    (options) => api.chat.listMessages(conversationId, options),
    [conversationId],
    true,
    [],
  )
}

export function useAgentRuns(projectId?: string): QueryResult<AgentRun[]> {
  return useApiQuery((options) => api.agent.listAgentRuns(projectId, options), [projectId], true, [])
}

export function useSession(): QueryResult<User | null> {
  return useApiQuery((options) => api.auth.getSession(options), [], true, null)
}

export function useUsageSummary(): QueryResult<UsageSummary> {
  return useApiQuery((options) => api.usage.getUsageSummary(options), [], true, createEmptyUsageSummary())
}

export function useAppSettings(): MockQueryResult<AppSettingsData> {
  return useMockQuery("app-settings", async () => {
    const [dashboard, usage] = await Promise.all([
      api.dashboard.getWorkspaceDashboard(),
      api.usage.getUsageSummary(),
    ])
    return {
      user: dashboard.user,
      workspace: dashboard.workspace,
      usage,
      generatedAt: dashboard.generatedAt,
    }
  }, { empty: createEmptyAppSettings() })
}

export function useWorkspaceDashboard(): MockQueryResult<WorkspaceDashboard> {
  return useMockQuery("workspace-dashboard", () => api.dashboard.getWorkspaceDashboard(), {
    empty: createEmptyWorkspaceDashboard(),
  })
}

export function useProjectHome(projectId: string): MockQueryResult<ProjectHomeData> {
  return useMockQuery(`project-home:${projectId}`, () => api.dashboard.getProjectHome(projectId), {
    empty: createEmptyProjectHome(projectId),
  })
}

export function useMutation<TArgs extends unknown[], TResult>(
  mutator: (...args: TArgs) => Promise<TResult>,
): MutationResult<TArgs, TResult> {
  const [state, setState] = useState<{
    data: TResult | undefined
    error: ApiError | null
    isLoading: boolean
  }>({ data: undefined, error: null, isLoading: false })
  const mutatorRef = useRef(mutator)
  mutatorRef.current = mutator
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const mutate = useCallback(async (...args: TArgs): Promise<TResult> => {
    setState({ data: undefined, error: null, isLoading: true })
    try {
      const data = await mutatorRef.current(...args)
      if (mountedRef.current) setState({ data, error: null, isLoading: false })
      return data
    } catch (error) {
      const apiError = toApiError(error)
      if (mountedRef.current) setState({ data: undefined, error: apiError, isLoading: false })
      throw apiError
    }
  }, [])

  const reset = useCallback(() => {
    setState({ data: undefined, error: null, isLoading: false })
  }, [])

  return { mutate, ...state, reset }
}
