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
  createEmptyAgentRunLogEntry,
  createEmptyAppSettings,
  createEmptyProjectHome,
  createEmptyUsageSummary,
  createEmptyWorkspaceDashboard,
} from "./empty"
import { api } from "./instance"
import type { MockStateMode } from "./mock-state"
import { toApiError, useApiQuery, type QueryResult } from "./use-api-query"
import type {
  AgentRun,
  AgentRunLogEntry,
  AppSettingsData,
  ChatMessage,
  LabSession,
  Project,
  ProjectFile,
  ProjectHomeData,
  UsageSummary,
  User,
  WorkspaceDashboard,
} from "./types"

export interface MutationResult<TArgs extends unknown[], TResult> {
  mutate: (...args: TArgs) => Promise<TResult>
  data: TResult | undefined
  error: ApiError | null
  isLoading: boolean
  reset: () => void
}

/** Aggregate query state without the internal `idle` status. */
export interface ScreenQueryResult<T> {
  status: "loading" | "error" | "success"
  mode: MockStateMode
  data: T | undefined
  error: ApiError | undefined
  isRetrying: boolean
  refetch: () => void
}

function toScreenQuery<T>(query: QueryResult<T>): ScreenQueryResult<T> {
  return {
    status: query.status === "idle" ? "loading" : query.status,
    mode: query.mode,
    data: query.data,
    error: query.error ?? undefined,
    isRetrying: query.isRetrying,
    refetch: query.refetch,
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
  return useApiQuery(
    (options) => api.lab.listLabSessions(projectId, options),
    [projectId],
    true,
    [],
  )
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
  return useApiQuery(
    (options) => api.agent.listAgentRuns(projectId, options),
    [projectId],
    true,
    [],
  )
}

export function useSession(): QueryResult<User | null> {
  return useApiQuery((options) => api.auth.getSession(options), [], true, null)
}

export function useUsageSummary(): QueryResult<UsageSummary> {
  return useApiQuery(
    (options) => api.usage.getUsageSummary(options),
    [],
    true,
    createEmptyUsageSummary(),
  )
}

export function useAppSettings(): ScreenQueryResult<AppSettingsData> {
  return toScreenQuery(
    useApiQuery(
      async (options) => {
        const [dashboard, usage] = await Promise.all([
          api.dashboard.getWorkspaceDashboard(options),
          api.usage.getUsageSummary(options),
        ])
        return {
          user: dashboard.user,
          workspace: dashboard.workspace,
          usage,
          generatedAt: dashboard.generatedAt,
        }
      },
      [],
      true,
      createEmptyAppSettings(),
    ),
  )
}

export function useWorkspaceMembers(): QueryResult<User[]> {
  return useApiQuery((options) => api.dashboard.listWorkspaceMembers(options), [], true, [])
}

export function useWorkspaceDashboard(): ScreenQueryResult<WorkspaceDashboard> {
  return toScreenQuery(
    useApiQuery(
      (options) => api.dashboard.getWorkspaceDashboard(options),
      [],
      true,
      createEmptyWorkspaceDashboard(),
    ),
  )
}

export function useAgentRunLog(): ScreenQueryResult<AgentRunLogEntry[]> {
  return toScreenQuery(
    useApiQuery((options) => api.dashboard.listAgentRunLog(options), [], true, []),
  )
}

export function useAgentRunLogEntry(id: string | undefined): ScreenQueryResult<AgentRunLogEntry> {
  return toScreenQuery(
    useApiQuery(
      (options) => api.dashboard.getAgentRunLogEntry(id as string, options),
      [id],
      id !== undefined,
      id === undefined ? undefined : createEmptyAgentRunLogEntry(id),
    ),
  )
}

export function useProjectHome(projectId: string): ScreenQueryResult<ProjectHomeData> {
  return toScreenQuery(
    useApiQuery(
      (options) => api.dashboard.getProjectHome(projectId, options),
      [projectId],
      true,
      createEmptyProjectHome(projectId),
    ),
  )
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
