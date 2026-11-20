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
  /** Id of the project template the project was created from, when known. */
  templateId?: string
  createdAt: string
  updatedAt: string
}

export interface CreateProjectInput {
  name: string
  description?: string
  /**
   * Project template id (see `lib/project-templates`). Adapters that support
   * templates seed the starter workspace structure from it; others may
   * ignore it.
   */
  templateId?: string
  /**
   * Id of an existing project to clone (see the projects screen's Clone
   * action). Adapters that support cloning duplicate the source project's
   * files, settings, and workspace state under the new project; others may
   * ignore it and treat the call as a plain create.
   */
  cloneFromProjectId?: string
}

export interface UpdateProjectInput {
  name?: string
  description?: string
  status?: ProjectStatus
  /**
   * Id of the workspace user who should become the project owner. Adapters
   * that support ownership transfer swap the owner/member roles and update
   * the project profile; others may reject the field. The previous owner
   * stays on as a regular member.
   */
  ownerId?: string
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
  description?: string
  role: "owner" | "admin" | "member"
  createdAt: string
}

/** One day of usage inside the billing period, for analytics charts. */
export interface UsageDailyPoint {
  /** ISO timestamp at day granularity (e.g. `2026-11-05T00:00:00.000Z`). */
  date: string
  requests: number
  tokens: number
  costUsd: number
}

/**
 * The billing period before the current one, returned for month-over-month
 * comparison. Totals and the daily series mirror `UsageSummary`.
 */
export interface UsageComparison {
  periodStart: string
  periodEnd: string
  requests: number
  tokens: number
  costUsd: number
  /** Per-day breakdown across the comparison period; empty when unavailable. */
  daily: UsageDailyPoint[]
}

/** Usage totals for a single project inside the billing period. */
export interface UsageProjectBreakdown {
  projectId: string
  projectName: string
  requests: number
  tokens: number
  costUsd: number
}

export interface UsageSummary {
  periodStart: string
  periodEnd: string
  requests: number
  tokens: number
  costUsd: number
  /** Per-day breakdown across the billing period; empty when unavailable. */
  daily: UsageDailyPoint[]
  /** Per-project breakdown across the billing period; absent when unavailable. */
  projects?: UsageProjectBreakdown[]
  /** Previous-period usage for month-over-month comparison; absent when unavailable. */
  comparison?: UsageComparison
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
  /**
   * Project member management. Membership rows live on `ProjectDetails.members`
   * (see `getProjectHome`); these calls mutate them. Ownership is not
   * assignable here — use `updateProject` with `ownerId` to transfer it.
   */
  addProjectMember(
    id: string,
    input: AddProjectMemberInput,
    options?: CallOptions,
  ): Promise<ProjectMember>
  updateProjectMemberRole(
    id: string,
    memberId: string,
    role: ProjectMemberGrantRole,
    options?: CallOptions,
  ): Promise<ProjectMember>
  removeProjectMember(id: string, memberId: string, options?: CallOptions): Promise<void>
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

/**
 * Roles assignable through member management. `owner` is excluded on purpose:
 * ownership only moves through the ownership-transfer flow on
 * `UpdateProjectInput.ownerId`.
 */
export type ProjectMemberGrantRole = "admin" | "member"

export interface ProjectMember {
  id: string
  user: User
  role: ProjectMemberRole
  joinedAt: string
}

export interface AddProjectMemberInput {
  /** Id of the workspace user to add to the project. */
  userId: string
  /** Defaults to `"member"` when omitted. */
  role?: ProjectMemberGrantRole
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
  members?: User[]
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
  /** Workspace roster used to pick project members to add. */
  listWorkspaceMembers(options?: CallOptions): Promise<User[]>
  getProjectHome(projectId: string, options?: CallOptions): Promise<ProjectHomeData>
  listAgentRunLog(options?: CallOptions): Promise<AgentRunLogEntry[]>
  getAgentRunLogEntry(id: string, options?: CallOptions): Promise<AgentRunLogEntry>
  cancelAgentRunLogEntry(id: string, options?: CallOptions): Promise<AgentRunLogEntry>
}

/* -------------------------------------------------------------------------- */
/* Project workspace resources                                                */
/*                                                                            */
/* The project screens (files, lab, chat, agent) operate on a richer,         */
/* project-scoped workspace than the coarse resources above. They use these   */
/* types and the `WorkspaceApi` contract so the mock and HTTP adapters remain */
/* interchangeable behind `NEXT_PUBLIC_API_MODE`.                             */
/* -------------------------------------------------------------------------- */

export interface WorkspaceProject {
  id: string
  name: string
  owner: string
  storageLimitBytes: number
}

export type WorkspaceActionResult = { ok: true } | { ok: false; error: string }

export type FileKind = "file" | "folder"

/**
 * VCS decoration state for a workspace node. Mock backends seed this on
 * `FileNode.gitStatus`; real backends may leave it unset. The union mirrors
 * `GitStatusKind` in `@/lib/file-tree/git-status`.
 */
export type FileGitStatus =
  "modified" | "added" | "deleted" | "untracked" | "renamed" | "conflicted"

/**
 * VCS summary surfaced on `FilesWorkspace.git` for the files screen's branch
 * indicator. Mock backends always provide it; HTTP backends may omit it.
 */
export interface FilesGitInfo {
  /** Current branch name, e.g. "feature/tidal-survey". */
  branch: string
  /** Upstream ref the branch tracks, when known. */
  upstream?: string
  /** Commits ahead of upstream. */
  ahead: number
  /** Commits behind upstream. */
  behind: number
}

/**
 * A single entry in a file's version history. Adapters populate this on
 * `FileNode.versions`; the workspace API does not expose version endpoints
 * yet, so real backends may leave it unset.
 */
export interface FileVersion {
  id: string
  /** Short label such as "v3" or a date string. */
  label: string
  createdAt: string
  author: string
  sizeBytes?: number
  /** Snapshot content used for the inline preview when available. */
  content?: string
  /** Signed or public URL used for preview/download of this version. */
  url?: string
}

export interface FileNode {
  id: string
  name: string
  kind: FileKind
  parentId: string | null
  mimeType: string
  sizeBytes: number
  owner: string
  updatedAt: string
  content?: string
  /** Optional URL for binary previews (image/pdf/video/audio); adapters may
   * leave this unset when only inline `content` is available. */
  previewUrl?: string
  /** Optional version history, newest-first or oldest-first per adapter. */
  versions?: FileVersion[]
  /** Optional VCS status decoration (mock backends seed this). */
  gitStatus?: FileGitStatus
}

export interface UploadFileInput {
  name: string
  sizeBytes: number
  mimeType: string
}

export interface RejectedUpload extends UploadFileInput {
  error: string
}

export type UploadStatus = "queued" | "uploading" | "paused" | "failed" | "done"

export type UploadAction = "pause" | "resume" | "retry" | "cancel"

export interface FileUpload {
  id: string
  parentId: string | null
  name: string
  sizeBytes: number
  mimeType: string
  status: UploadStatus
  progress: number
  error?: string
}

export interface WorkspaceStorageUsage {
  usedBytes: number
  limitBytes: number
}

export interface FilesWorkspace {
  project: WorkspaceProject
  files: FileNode[]
  uploads: FileUpload[]
  storage: WorkspaceStorageUsage
  /** Optional VCS summary for the branch indicator / changes panel. */
  git?: FilesGitInfo
}

export interface CreateFolderInput {
  parentId: string | null
  name: string
}

export interface RenameFileNodeInput {
  id: string
  name: string
}

export interface MoveFileNodesInput {
  ids: string[]
  targetFolderId: string | null
}

export interface TrashFileNodesInput {
  ids: string[]
}

export interface RestoreFileNodeVersionInput {
  id: string
  versionId: string
}

export interface AddUploadsInput {
  parentId: string | null
  files: UploadFileInput[]
}

export interface AddUploadsResult {
  accepted: string[]
  rejected: RejectedUpload[]
  workspace: FilesWorkspace
}

export type ChatChannelKind = "channel" | "dm"

export interface ChatChannel {
  id: string
  name: string
  kind: ChatChannelKind
  memberCount: number
  /** Messages newer than the reader's last-read marker in this thread. */
  unreadCount?: number
  /** Preview of the most recent message, used by the thread list. */
  lastMessagePreview?: string
  lastMessageAt?: string
}

/** A workspace member that can be @mentioned or shown in the presence strip. */
export interface ChatMember {
  id: string
  name: string
  online: boolean
  /** Idle-but-connected state; only meaningful while `online` is true. */
  away?: boolean
  /** ISO timestamp of the member's last activity; shown for offline members. */
  lastSeenAt?: string
  /** True for automated responders (e.g. the mock chat bot), not people. */
  bot?: boolean
}

/** A member currently composing a reply in a thread. */
export interface ChatTyping {
  channelId: string
  memberId: string
  memberName: string
  bot?: boolean
}

/** A structured @mention resolved at send time. */
export interface ChatMention {
  id: string
  name: string
}

/** An emoji reaction on a message; `userIds` are the reactors. */
export interface ChatReaction {
  emoji: string
  userIds: string[]
}

export type ChannelMessageStatus = "sending" | "sent" | "failed"

export interface ChatAttachment {
  id: string
  name: string
  sizeBytes: number
}

export interface ChannelMessage {
  id: string
  channelId: string
  authorId: string
  authorName: string
  anonymous: boolean
  body: string
  attachments?: ChatAttachment[]
  mentions?: ChatMention[]
  reactions?: ChatReaction[]
  /** When set, this message is a reply to the message with that id. */
  replyToId?: string
  /** True when an automated bot authored the message rather than a person. */
  bot?: boolean
  createdAt: string
  status: ChannelMessageStatus
}

export interface ChatWorkspace {
  project: WorkspaceProject
  activeChannelId: string
  anonymous: boolean
  /** Whether the chat bot answers @mentions and slash commands. */
  botEnabled: boolean
  channels: ChatChannel[]
  messages: ChannelMessage[]
  members: ChatMember[]
  typing: ChatTyping[]
}

export interface CreateChatChannelInput {
  name: string
  kind?: ChatChannelKind
}

export interface SendChannelMessageInput {
  channelId: string
  body: string
  anonymous?: boolean
  attachments?: { name: string; sizeBytes: number }[]
  mentions?: ChatMention[]
  /** Optional id of the message in the same channel this send replies to. */
  replyToId?: string
}

export type LabEnvironmentKind = "rstudio" | "jupyter" | "vscode" | "terminal"

export type LabEnvironmentStatus = "stopped" | "starting" | "running"

export interface LabEnvironment {
  id: string
  name: string
  kind: LabEnvironmentKind
  status: LabEnvironmentStatus
  title: string
  statusLabel: string
  lastActiveAt: string | null
}

export interface LabWorkspace {
  project: WorkspaceProject
  activeEnvironmentId: string
  environments: LabEnvironment[]
}

export type AgentModelId = "spindle-1" | "spindle-1-mini" | "spindle-1-pro"

/** How much of the workspace a run may read before proposing a diff. */
export type AgentScope = "project" | "files"

/** Run configuration chosen on the agent screen and recorded on each run. */
export interface AgentConfig {
  model: AgentModelId
  scope: AgentScope
}

export interface AgentQuota {
  dailyLimit: number
  bonus: number
  used: number
}

export type AgentStepStatus = "pending" | "running" | "done" | "failed" | "cancelled"

export interface AgentStep {
  id: string
  label: string
  detail: string
  status: AgentStepStatus
  durationMs?: number
}

export type AgentDiffReview = "pending" | "approved" | "rejected" | "cancelled"

export interface AgentDiff {
  id: string
  path: string
  summary: string
  before: string[]
  after: string[]
  additions: number
  deletions: number
  review: AgentDiffReview
}

export type AgentRunState =
  "running" | "waiting_approval" | "succeeded" | "failed" | "cancelled" | "rejected"

export interface AgentWorkspaceRun {
  id: string
  prompt: string
  status: AgentRunState
  steps: AgentStep[]
  diff: AgentDiff | null
  createdAt: string
  finishedAt: string | null
  summary: string
  retryOf: string | null
  /** Snapshot of the config the run was started with. */
  config: AgentConfig
}

export interface AgentWorkspace {
  project: WorkspaceProject
  quota: AgentQuota
  /** Model/scope selection applied to the next run. */
  config: AgentConfig
  activeRunId: string | null
  runs: AgentWorkspaceRun[]
}

/* -------------------------------------------------------------------------- */
/* Agent run log                                                              */
/*                                                                            */
/* Workspace-wide run log for the dashboard. Entries are shaped like the      */
/* future `/agent/runs` API response: a flat run with a chronological list    */
/* of steps (thought / tool call / result) plus an optional approval gate.    */
/* -------------------------------------------------------------------------- */

export type AgentRunLogStatus =
  "queued" | "running" | "waiting_approval" | "succeeded" | "failed" | "cancelled" | "rejected"

export type AgentRunLogStepKind = "thought" | "tool_call" | "result"

export interface AgentRunLogStep {
  id: string
  kind: AgentRunLogStepKind
  title: string
  detail: string
  status: AgentStepStatus
  startedAt: string
  durationMs?: number
  /** Structured tool input/output revealed when the timeline row expands. */
  payload?: Record<string, unknown>
  /** Tokens consumed producing this step, when recorded. */
  tokens?: number
  /** Cost of this step in USD, when recorded or estimated. */
  costUsd?: number
}

export type AgentRunApprovalStatus = "pending" | "approved" | "rejected"

export interface AgentRunApproval {
  id: string
  action: string
  summary: string
  requestedAt: string
  status: AgentRunApprovalStatus
}

/** Usage/cost metrics captured for a run (any subset may be present). */
export interface AgentRunLogUsage {
  model?: string
  provider?: string
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  costUsd?: number
}

export interface AgentRunLogEntry {
  id: string
  projectId: string
  projectName: string
  prompt: string
  status: AgentRunLogStatus
  actor: ActivityActor
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  steps: AgentRunLogStep[]
  approval: AgentRunApproval | null
  summary: string | null
  /** Token/cost usage for the run; absent until the run reports metrics. */
  usage?: AgentRunLogUsage
}

/** Project-scoped screen operations shared by the files, lab, chat, and agent screens. */
export interface WorkspaceApi {
  getFiles(projectId: string, options?: CallOptions): Promise<FilesWorkspace>
  createFolder(
    projectId: string,
    input: CreateFolderInput,
    options?: CallOptions,
  ): Promise<FilesWorkspace>
  renameFileNode(
    projectId: string,
    input: RenameFileNodeInput,
    options?: CallOptions,
  ): Promise<FilesWorkspace>
  moveFileNodes(
    projectId: string,
    input: MoveFileNodesInput,
    options?: CallOptions,
  ): Promise<FilesWorkspace>
  trashFileNodes(
    projectId: string,
    input: TrashFileNodesInput,
    options?: CallOptions,
  ): Promise<FilesWorkspace>
  /**
   * Restore a historical `FileVersion` as the node's current content. The
   * outgoing content is appended to `versions` first so the restore itself
   * stays recoverable. Versions without an inline `content` snapshot cannot
   * be restored.
   */
  restoreFileNodeVersion(
    projectId: string,
    input: RestoreFileNodeVersionInput,
    options?: CallOptions,
  ): Promise<FilesWorkspace>
  addUploads(
    projectId: string,
    input: AddUploadsInput,
    options?: CallOptions,
  ): Promise<AddUploadsResult>
  tickUploads(projectId: string, options?: CallOptions): Promise<FilesWorkspace>
  updateUpload(
    projectId: string,
    uploadId: string,
    action: UploadAction,
    options?: CallOptions,
  ): Promise<FilesWorkspace>

  getChat(projectId: string, options?: CallOptions): Promise<ChatWorkspace>
  selectChatChannel(
    projectId: string,
    channelId: string,
    options?: CallOptions,
  ): Promise<ChatWorkspace>
  setChatAnonymous(
    projectId: string,
    anonymous: boolean,
    options?: CallOptions,
  ): Promise<ChatWorkspace>
  setChatBotEnabled(
    projectId: string,
    enabled: boolean,
    options?: CallOptions,
  ): Promise<ChatWorkspace>
  createChatChannel(
    projectId: string,
    input: CreateChatChannelInput,
    options?: CallOptions,
  ): Promise<ChatWorkspace>
  toggleChatReaction(
    projectId: string,
    messageId: string,
    emoji: string,
    options?: CallOptions,
  ): Promise<ChatWorkspace>
  sendChannelMessage(
    projectId: string,
    input: SendChannelMessageInput,
    options?: CallOptions,
  ): Promise<ChatWorkspace>
  settleChannelMessages(projectId: string, options?: CallOptions): Promise<ChatWorkspace>
  retryChannelMessage(
    projectId: string,
    messageId: string,
    options?: CallOptions,
  ): Promise<ChatWorkspace>

  getLab(projectId: string, options?: CallOptions): Promise<LabWorkspace>
  selectLabEnvironment(
    projectId: string,
    environmentId: string,
    options?: CallOptions,
  ): Promise<LabWorkspace>
  startLabEnvironment(
    projectId: string,
    environmentId: string,
    options?: CallOptions,
  ): Promise<LabWorkspace>
  completeLabEnvironmentStart(
    projectId: string,
    environmentId: string,
    options?: CallOptions,
  ): Promise<LabWorkspace>
  stopLabEnvironment(
    projectId: string,
    environmentId: string,
    options?: CallOptions,
  ): Promise<LabWorkspace>
  pingLabEnvironment(
    projectId: string,
    environmentId: string,
    options?: CallOptions,
  ): Promise<LabWorkspace>

  getAgent(projectId: string, options?: CallOptions): Promise<AgentWorkspace>
  updateAgentConfig(
    projectId: string,
    config: AgentConfig,
    options?: CallOptions,
  ): Promise<AgentWorkspace>
  startAgentRun(
    projectId: string,
    prompt: string,
    config?: AgentConfig,
    options?: CallOptions,
  ): Promise<AgentWorkspace>
  retryAgentRun(projectId: string, runId: string, options?: CallOptions): Promise<AgentWorkspace>
  cancelAgentRun(projectId: string, runId: string, options?: CallOptions): Promise<AgentWorkspace>
  advanceAgentRuns(projectId: string, options?: CallOptions): Promise<AgentWorkspace>
  reviewAgentDiff(
    projectId: string,
    runId: string,
    decision: "approved" | "rejected",
    options?: CallOptions,
  ): Promise<AgentWorkspace>
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
  workspace: WorkspaceApi
}
