/**
 * HTTP adapter — implements `ApiClient` on top of `request()` from
 * `../client`. Endpoint paths follow the conventions agreed for the backend;
 * adjust them here (and in the contract tests) as DEV-4 lands.
 */

import { ApiError, request } from "../client"
import type {
  AddProjectMemberInput,
  AddUploadsInput,
  AddUploadsResult,
  AgentWorkspace,
  CallOptions,
  AgentApi,
  AgentRun,
  AgentRunLogEntry,
  ApiClient,
  AuthApi,
  ChatApi,
  ChatMessage,
  ChatWorkspace,
  CreateAgentRunInput,
  CreateFolderInput,
  CreateLabSessionInput,
  CreateProjectInput,
  DashboardApi,
  FilesApi,
  FilesWorkspace,
  LabApi,
  LabSession,
  LabWorkspace,
  LoginInput,
  MoveFileNodesInput,
  Project,
  ProjectFile,
  ProjectHomeData,
  ProjectMember,
  ProjectMemberGrantRole,
  ProjectsApi,
  RenameFileNodeInput,
  RestoreFileNodeVersionInput,
  SendChannelMessageInput,
  SendChatMessageInput,
  TrashFileNodesInput,
  UpdateProjectInput,
  UploadAction,
  UsageApi,
  UsageSummary,
  User,
  WorkspaceApi,
  WorkspaceDashboard,
} from "../types"

export interface HttpClientOptions {
  /**
   * API root. When selected via `NEXT_PUBLIC_API_MODE=http`, the env schema
   * requires `NEXT_PUBLIC_API_URL` to be an absolute URL; a relative "/api"
   * is only the fallback used when the variable is unset (see `instance.ts`).
   */
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

  // Member management lives under the project resource; `projectPath` is
  // declared below with the workspace routes and is safe to reference here
  // because these closures only run after the client is constructed.
  const memberPath = (projectId: string, memberId?: string) =>
    `${projectPath(projectId)}/members${memberId ? `/${encodeURIComponent(memberId)}` : ""}`

  const projects: ProjectsApi = {
    listProjects: (options) => get<Project[]>("/projects", options),
    getProject: (id, options) => get<Project>(`/projects/${id}`, options),
    createProject: (input: CreateProjectInput, options) =>
      post<Project>("/projects", input, options),
    updateProject: (id, input: UpdateProjectInput, options) =>
      patch<Project>(`/projects/${id}`, input, options),
    deleteProject: (id, options) => del<void>(`/projects/${id}`, options),
    addProjectMember: (id, input: AddProjectMemberInput, options) =>
      post<ProjectMember>(memberPath(id), input, options),
    updateProjectMemberRole: (id, memberId, role: ProjectMemberGrantRole, options) =>
      patch<ProjectMember>(memberPath(id, memberId), { role }, options),
    removeProjectMember: (id, memberId, options) => del<void>(memberPath(id, memberId), options),
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
    listWorkspaceMembers: (options) => get<User[]>("/workspace/members", options),
    getProjectHome: (projectId, options) =>
      get<ProjectHomeData>(`/projects/${encodeURIComponent(projectId)}/home`, options),
    listAgentRunLog: (options) => get<AgentRunLogEntry[]>("/dashboard/agent-runs", options),
    getAgentRunLogEntry: (id, options) =>
      get<AgentRunLogEntry>(`/dashboard/agent-runs/${encodeURIComponent(id)}`, options),
    cancelAgentRunLogEntry: (id, options) =>
      post<AgentRunLogEntry>(`/dashboard/agent-runs/${encodeURIComponent(id)}/cancel`, {}, options),
  }

  const projectPath = (projectId: string) => `/projects/${encodeURIComponent(projectId)}`
  /**
   * Canonical workspace scheme: every project-screen operation lives under
   * `/projects/:id/workspace/<screen>` (`files`, `chat`, `lab`, `agent`) so
   * reads and mutations share one resource tree per screen. No backend
   * routes exist yet (DEV-4); keep this namespace when they land.
   */
  const workspacePath = (projectId: string, screen: "files" | "chat" | "lab" | "agent") =>
    `${projectPath(projectId)}/workspace/${screen}`

  const workspace: WorkspaceApi = {
    getFiles: (projectId, options) =>
      get<FilesWorkspace>(workspacePath(projectId, "files"), options),
    createFolder: (projectId, input: CreateFolderInput, options) =>
      post<FilesWorkspace>(`${workspacePath(projectId, "files")}/folders`, input, options),
    renameFileNode: (projectId, input: RenameFileNodeInput, options) =>
      patch<FilesWorkspace>(
        `${workspacePath(projectId, "files")}/nodes/${encodeURIComponent(input.id)}`,
        { name: input.name },
        options,
      ),
    moveFileNodes: (projectId, input: MoveFileNodesInput, options) =>
      post<FilesWorkspace>(`${workspacePath(projectId, "files")}/nodes/move`, input, options),
    trashFileNodes: (projectId, input: TrashFileNodesInput, options) =>
      post<FilesWorkspace>(`${workspacePath(projectId, "files")}/nodes/trash`, input, options),
    restoreFileNodeVersion: (projectId, input: RestoreFileNodeVersionInput, options) =>
      post<FilesWorkspace>(
        `${workspacePath(projectId, "files")}/nodes/${encodeURIComponent(input.id)}/versions/${encodeURIComponent(input.versionId)}/restore`,
        {},
        options,
      ),
    addUploads: (projectId, input: AddUploadsInput, options) =>
      post<AddUploadsResult>(`${workspacePath(projectId, "files")}/uploads`, input, options),
    tickUploads: (projectId, options) =>
      post<FilesWorkspace>(`${workspacePath(projectId, "files")}/uploads/tick`, {}, options),
    updateUpload: (projectId, uploadId, action: UploadAction, options) =>
      post<FilesWorkspace>(
        `${workspacePath(projectId, "files")}/uploads/${encodeURIComponent(uploadId)}/actions`,
        { action },
        options,
      ),

    getChat: (projectId, options) => get<ChatWorkspace>(workspacePath(projectId, "chat"), options),
    selectChatChannel: (projectId, channelId, options) =>
      post<ChatWorkspace>(
        `${workspacePath(projectId, "chat")}/channels/${encodeURIComponent(channelId)}/select`,
        {},
        options,
      ),
    setChatAnonymous: (projectId, anonymous, options) =>
      post<ChatWorkspace>(`${workspacePath(projectId, "chat")}/anonymous`, { anonymous }, options),
    setChatBotEnabled: (projectId, enabled, options) =>
      post<ChatWorkspace>(`${workspacePath(projectId, "chat")}/bot`, { enabled }, options),
    createChatChannel: (projectId, input, options) =>
      post<ChatWorkspace>(`${workspacePath(projectId, "chat")}/channels`, input, options),
    toggleChatReaction: (projectId, messageId, emoji, options) =>
      post<ChatWorkspace>(
        `${workspacePath(projectId, "chat")}/messages/${encodeURIComponent(messageId)}/reactions`,
        { emoji },
        options,
      ),
    sendChannelMessage: (projectId, input: SendChannelMessageInput, options) =>
      post<ChatWorkspace>(`${workspacePath(projectId, "chat")}/messages`, input, options),
    settleChannelMessages: (projectId, options) =>
      post<ChatWorkspace>(`${workspacePath(projectId, "chat")}/messages/settle`, {}, options),
    retryChannelMessage: (projectId, messageId, options) =>
      post<ChatWorkspace>(
        `${workspacePath(projectId, "chat")}/messages/${encodeURIComponent(messageId)}/retry`,
        {},
        options,
      ),

    getLab: (projectId, options) => get<LabWorkspace>(workspacePath(projectId, "lab"), options),
    selectLabEnvironment: (projectId, environmentId, options) =>
      post<LabWorkspace>(
        `${workspacePath(projectId, "lab")}/environments/${encodeURIComponent(environmentId)}/select`,
        {},
        options,
      ),
    startLabEnvironment: (projectId, environmentId, options) =>
      post<LabWorkspace>(
        `${workspacePath(projectId, "lab")}/environments/${encodeURIComponent(environmentId)}/start`,
        {},
        options,
      ),
    completeLabEnvironmentStart: (projectId, environmentId, options) =>
      post<LabWorkspace>(
        `${workspacePath(projectId, "lab")}/environments/${encodeURIComponent(environmentId)}/complete`,
        {},
        options,
      ),
    stopLabEnvironment: (projectId, environmentId, options) =>
      post<LabWorkspace>(
        `${workspacePath(projectId, "lab")}/environments/${encodeURIComponent(environmentId)}/stop`,
        {},
        options,
      ),
    pingLabEnvironment: (projectId, environmentId, options) =>
      post<LabWorkspace>(
        `${workspacePath(projectId, "lab")}/environments/${encodeURIComponent(environmentId)}/ping`,
        {},
        options,
      ),

    getAgent: (projectId, options) =>
      get<AgentWorkspace>(workspacePath(projectId, "agent"), options),
    updateAgentConfig: (projectId, config, options) =>
      patch<AgentWorkspace>(`${workspacePath(projectId, "agent")}/config`, config, options),
    startAgentRun: (projectId, prompt, config, options) =>
      post<AgentWorkspace>(
        `${workspacePath(projectId, "agent")}/runs`,
        config ? { prompt, config } : { prompt },
        options,
      ),
    retryAgentRun: (projectId, runId, options) =>
      post<AgentWorkspace>(
        `${workspacePath(projectId, "agent")}/runs/${encodeURIComponent(runId)}/retry`,
        {},
        options,
      ),
    cancelAgentRun: (projectId, runId, options) =>
      post<AgentWorkspace>(
        `${workspacePath(projectId, "agent")}/runs/${encodeURIComponent(runId)}/cancel`,
        {},
        options,
      ),
    advanceAgentRuns: (projectId, options) =>
      post<AgentWorkspace>(`${workspacePath(projectId, "agent")}/runs/advance`, {}, options),
    reviewAgentDiff: (projectId, runId, decision, options) =>
      post<AgentWorkspace>(
        `${workspacePath(projectId, "agent")}/runs/${encodeURIComponent(runId)}/review`,
        { decision },
        options,
      ),
  }

  return { projects, files, lab, chat, agent, auth, usage, dashboard, workspace }
}
