/**
 * Shared resource types and the `ApiClient` contract for the app data layer.
 *
 * Screens and hooks depend only on these types and the `ApiClient` interface;
 * the mock and HTTP adapters in `./adapters` are interchangeable behind it.
 */

export type ProjectStatus = "active" | "archived"

export interface Project {
  id: string
  name: string
  slug: string
  description?: string
  status: ProjectStatus
  createdAt: string
  updatedAt: string
}

export interface CreateProjectInput {
  name: string
  description?: string
}

export interface UpdateProjectInput {
  name?: string
  description?: string
  status?: ProjectStatus
}

export interface ProjectFile {
  id: string
  projectId: string
  name: string
  path: string
  sizeBytes: number
  mimeType?: string
  createdAt: string
}

export type LabSessionStatus = "queued" | "running" | "completed" | "failed"

export interface LabSession {
  id: string
  projectId?: string
  title: string
  status: LabSessionStatus
  createdAt: string
  endedAt?: string
}

export interface CreateLabSessionInput {
  title: string
  projectId?: string
}

export type ChatRole = "user" | "assistant" | "system"

export interface ChatMessage {
  id: string
  conversationId: string
  projectId?: string
  role: ChatRole
  content: string
  createdAt: string
}

export interface SendChatMessageInput {
  conversationId?: string
  content: string
}

export type AgentRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled"

export interface AgentRun {
  id: string
  projectId?: string
  prompt: string
  status: AgentRunStatus
  result?: string
  createdAt: string
  finishedAt?: string
}

export interface CreateAgentRunInput {
  prompt: string
  projectId?: string
}

export interface User {
  id: string
  email: string
  name?: string
  avatarUrl?: string
  createdAt: string
}

export interface LoginInput {
  email: string
  password: string
}

export interface Workspace {
  id: string
  name: string
  slug: string
  role: "owner" | "admin" | "member"
  createdAt: string
}

export interface UsageSummary {
  periodStart: string
  periodEnd: string
  requests: number
  tokens: number
  costUsd: number
}

/** Per-call options shared by every resource method. */
export interface CallOptions {
  /** Abort the request; adapters should forward it to the transport. */
  signal?: AbortSignal
}

/** Per-resource contracts. Each adapter implements all of them. */
export interface ProjectsApi {
  listProjects(options?: CallOptions): Promise<Project[]>
  getProject(id: string, options?: CallOptions): Promise<Project>
  createProject(input: CreateProjectInput, options?: CallOptions): Promise<Project>
  updateProject(id: string, input: UpdateProjectInput, options?: CallOptions): Promise<Project>
  deleteProject(id: string, options?: CallOptions): Promise<void>
}

export interface FilesApi {
  listFiles(projectId?: string, options?: CallOptions): Promise<ProjectFile[]>
  getFile(id: string, options?: CallOptions): Promise<ProjectFile>
  deleteFile(id: string, options?: CallOptions): Promise<void>
}

export interface LabApi {
  listLabSessions(projectId?: string, options?: CallOptions): Promise<LabSession[]>
  getLabSession(id: string, options?: CallOptions): Promise<LabSession>
  createLabSession(input: CreateLabSessionInput, options?: CallOptions): Promise<LabSession>
}

export interface ChatApi {
  listMessages(conversationId: string, options?: CallOptions): Promise<ChatMessage[]>
  sendMessage(input: SendChatMessageInput, options?: CallOptions): Promise<ChatMessage>
}

export interface AgentApi {
  listAgentRuns(projectId?: string, options?: CallOptions): Promise<AgentRun[]>
  getAgentRun(id: string, options?: CallOptions): Promise<AgentRun>
  createAgentRun(input: CreateAgentRunInput, options?: CallOptions): Promise<AgentRun>
  cancelAgentRun(id: string, options?: CallOptions): Promise<AgentRun>
}

export interface AuthApi {
  getSession(options?: CallOptions): Promise<User | null>
  login(input: LoginInput, options?: CallOptions): Promise<User>
  logout(options?: CallOptions): Promise<void>
}

export interface UsageApi {
  getUsageSummary(options?: CallOptions): Promise<UsageSummary>
}

export type ProjectVisibility = "private" | "workspace" | "public"

export type ProjectMemberRole = "owner" | "admin" | "member"

export interface ProjectMember {
  id: string
  user: User
  role: ProjectMemberRole
  joinedAt: string
}

export interface ProjectDetails extends Project {
  visibility: ProjectVisibility
  owner: User
  members: ProjectMember[]
}

export type ActivityKind = "project" | "file" | "lab" | "chat" | "agent" | "system"

export interface ActivityActor {
  id: string
  name: string
  avatarUrl?: string
}

export interface ActivityEvent {
  id: string
  projectId?: string
  projectName?: string
  kind: ActivityKind
  actor: ActivityActor
  summary: string
  target?: string
  createdAt: string
}

export interface StorageUsage {
  usedBytes: number
  totalBytes: number
  fileBytes: number
  computeBytes: number
  availableBytes: number
}

export interface ProjectSummary extends Project {
  owner: User
  visibility: ProjectVisibility
  memberCount: number
  fileCount: number
  labSessionCount: number
  agentRunCount: number
  storageBytes: number
  latestActivityAt?: string
}

export interface WorkspaceDashboard {
  workspace: Workspace
  user: User
  projects: ProjectSummary[]
  activity: ActivityEvent[]
  storage: StorageUsage
  generatedAt: string
}

export interface AppSettingsData {
  user: User | null
  workspace: Workspace | null
  usage: UsageSummary
  generatedAt: string
}

export interface ProjectHomeData {
  project: ProjectDetails
  files: ProjectFile[]
  labSessions: LabSession[]
  agentRuns: AgentRun[]
  chatConversationId: string
  chatMessages: ChatMessage[]
  activity: ActivityEvent[]
  storageBytes: number
  generatedAt: string
}

export interface DashboardApi {
  getWorkspaceDashboard(options?: CallOptions): Promise<WorkspaceDashboard>
  getProjectHome(projectId: string, options?: CallOptions): Promise<ProjectHomeData>
}

/** The full client surface consumed by hooks and screens. */
export interface ApiClient {
  projects: ProjectsApi
  files: FilesApi
  lab: LabApi
  chat: ChatApi
  agent: AgentApi
  auth: AuthApi
  usage: UsageApi
  dashboard: DashboardApi
}
