/**
 * HTTP adapter — implements `ApiClient` on top of `request()` from
 * `../client`. Endpoint paths follow the conventions agreed for the backend;
 * adjust them here (and in the contract tests) as DEV-4 lands.
 */

import { ApiError, request } from "../client"
import type {
  CallOptions,
  AgentApi,
  AgentRun,
  ApiClient,
  AuthApi,
  ChatApi,
  ChatMessage,
  CreateAgentRunInput,
  CreateLabSessionInput,
  CreateProjectInput,
  DashboardApi,
  FilesApi,
  LabApi,
  LabSession,
  LoginInput,
  Project,
  ProjectFile,
  ProjectHomeData,
  ProjectsApi,
  SendChatMessageInput,
  UpdateProjectInput,
  UsageApi,
  UsageSummary,
  User,
  WorkspaceDashboard,
} from "../types"

export interface HttpClientOptions {
  /** API root, e.g. "https://api.example.com" or same-origin "/api". */
  baseUrl: string
}

export function createHttpClient({ baseUrl }: HttpClientOptions): ApiClient {
  const get = <T>(path: string, options?: CallOptions) =>
    request<T>(baseUrl, path, { signal: options?.signal })
  const post = <T>(path: string, body: unknown, options?: CallOptions) =>
    request<T>(baseUrl, path, { method: "POST", body, signal: options?.signal })
  const patch = <T>(path: string, body: unknown, options?: CallOptions) =>
    request<T>(baseUrl, path, { method: "PATCH", body, signal: options?.signal })
  const del = <T>(path: string, options?: CallOptions) =>
    request<T>(baseUrl, path, { method: "DELETE", signal: options?.signal })

  const projects: ProjectsApi = {
    listProjects: (options) => get<Project[]>("/projects", options),
    getProject: (id, options) => get<Project>(`/projects/${id}`, options),
    createProject: (input: CreateProjectInput, options) =>
      post<Project>("/projects", input, options),
    updateProject: (id, input: UpdateProjectInput, options) =>
      patch<Project>(`/projects/${id}`, input, options),
    deleteProject: (id, options) => del<void>(`/projects/${id}`, options),
  }

  const files: FilesApi = {
    listFiles: (projectId, options) =>
      get<ProjectFile[]>(
        projectId ? `/files?projectId=${encodeURIComponent(projectId)}` : "/files",
        options,
      ),
    getFile: (id, options) => get<ProjectFile>(`/files/${id}`, options),
    deleteFile: (id, options) => del<void>(`/files/${id}`, options),
  }

  const lab: LabApi = {
    listLabSessions: (projectId, options) =>
      get<LabSession[]>(
        projectId ? `/lab/sessions?projectId=${encodeURIComponent(projectId)}` : "/lab/sessions",
        options,
      ),
    getLabSession: (id, options) => get<LabSession>(`/lab/sessions/${id}`, options),
    createLabSession: (input: CreateLabSessionInput, options) =>
      post<LabSession>("/lab/sessions", input, options),
  }

  const chat: ChatApi = {
    listMessages: (conversationId, options) =>
      get<ChatMessage[]>(
        `/chat/conversations/${encodeURIComponent(conversationId)}/messages`,
        options,
      ),
    sendMessage: (input: SendChatMessageInput, options) =>
      post<ChatMessage>("/chat/messages", input, options),
  }

  const agent: AgentApi = {
    listAgentRuns: (projectId, options) =>
      get<AgentRun[]>(
        projectId ? `/agent/runs?projectId=${encodeURIComponent(projectId)}` : "/agent/runs",
        options,
      ),
    getAgentRun: (id, options) => get<AgentRun>(`/agent/runs/${id}`, options),
    createAgentRun: (input: CreateAgentRunInput, options) =>
      post<AgentRun>("/agent/runs", input, options),
    cancelAgentRun: (id, options) => post<AgentRun>(`/agent/runs/${id}/cancel`, {}, options),
  }

  const auth: AuthApi = {
    getSession: async (options) => {
      try {
        return await get<User>("/auth/session", options)
      } catch (error) {
        // No session is a normal state, not an error for callers.
        if (error instanceof ApiError && error.status === 401) return null
        throw error
      }
    },
    login: (input: LoginInput, options) => post<User>("/auth/login", input, options),
    logout: (options) => post<void>("/auth/logout", {}, options),
  }

  const usage: UsageApi = {
    getUsageSummary: (options) => get<UsageSummary>("/usage/summary", options),
  }

  const dashboard: DashboardApi = {
    getWorkspaceDashboard: (options) => get<WorkspaceDashboard>("/dashboard", options),
    getProjectHome: (projectId, options) =>
      get<ProjectHomeData>(`/projects/${encodeURIComponent(projectId)}/home`, options),
  }

  return { projects, files, lab, chat, agent, auth, usage, dashboard }
}
