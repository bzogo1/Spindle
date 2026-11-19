/**
 * Public entry point for the app data layer.
 *
 * Components and hooks import from `@/lib/api` — never from the adapters or
 * any mock module directly (enforced by ESLint).
 */

export { api, createApiClient } from "./instance"
export { ApiError } from "./client"
export type { RequestOptions } from "./client"
export * from "./hooks"
export type {
  ActivityActor,
  ActivityEvent,
  ActivityKind,
  AgentApi,
  AgentRun,
  AgentRunStatus,
  ApiClient,
  AppSettingsData,
  AuthApi,
  CallOptions,
  ChatApi,
  ChatMessage,
  ChatRole,
  CreateAgentRunInput,
  CreateLabSessionInput,
  CreateProjectInput,
  DashboardApi,
  FilesApi,
  LabApi,
  LabSession,
  LabSessionStatus,
  LoginInput,
  Project,
  ProjectDetails,
  ProjectFile,
  ProjectHomeData,
  ProjectMember,
  ProjectMemberRole,
  ProjectStatus,
  ProjectSummary,
  ProjectVisibility,
  ProjectsApi,
  SendChatMessageInput,
  StorageUsage,
  UpdateProjectInput,
  UsageApi,
  UsageSummary,
  User,
  Workspace,
  WorkspaceDashboard,
} from "./types"
