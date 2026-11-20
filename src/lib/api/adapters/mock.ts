/**
 * Mock adapter — the reference implementation of `ApiClient`.
 *
 * Serves deterministic in-memory fixtures so screens can be built before the
 * backend exists. Mutations update the in-memory store so subsequent reads
 * reflect them within the session. Errors are normalized to `ApiError` with
 * the same codes the HTTP adapter produces for equivalent failures.
 */

import { ApiError } from "../client"
import { pushActivityEvent } from "../../activity/client"
import { CURRENT_USER, MockStore } from "../../mock/store"
import {
  mockActivityEvents,
  mockAgentRunLog,
  mockAgentRuns,
  mockComputeStorageBytes,
  mockFiles,
  mockLabSessions,
  mockMessages,
  mockNow,
  mockProjectProfiles,
  mockProjects,
  mockSessionUser,
  mockStorageQuotaBytes,
  mockUsageSummary,
  mockUsers,
  mockWorkspace,
  type MockProjectProfile,
} from "../../mock"
import { getProjectTemplate, type ProjectTemplate } from "../../project-templates"
import type {
  ActivityEvent,
  ActivityKind,
  AddProjectMemberInput,
  AddUploadsInput,
  AddUploadsResult,
  AgentApi,
  AgentRun,
  AgentRunLogEntry,
  AgentWorkspace,
  ApiClient,
  AuthApi,
  CallOptions,
  ChatApi,
  ChatMessage,
  ChatWorkspace,
  ChannelMessage,
  CreateAgentRunInput,
  CreateFolderInput,
  CreateLabSessionInput,
  CreateProjectInput,
  DashboardApi,
  FilesApi,
  FilesGitInfo,
  FilesWorkspace,
  LabApi,
  LabSession,
  LabWorkspace,
  LoginInput,
  MoveFileNodesInput,
  Project,
  ProjectDetails,
  ProjectHomeData,
  ProjectMember,
  ProjectMemberGrantRole,
  ProjectsApi,
  ProjectSummary,
  RenameFileNodeInput,
  RestoreFileNodeVersionInput,
  SendChannelMessageInput,
  SendChatMessageInput,
  StorageUsage,
  TrashFileNodesInput,
  UpdateProjectInput,
  UploadAction,
  UsageApi,
  User,
  WorkspaceApi,
  WorkspaceDashboard,
} from "../types"

const now = mockNow
const seedProjects = mockProjects
const seedFiles = mockFiles
const seedLabSessions = mockLabSessions
const seedMessages = mockMessages
const seedAgentRuns = mockAgentRuns
const seedUser = mockSessionUser
const seedUsage = mockUsageSummary

function notFound(resource: string, id: string): ApiError {
  return new ApiError({
    status: 404,
    code: "not_found",
    message: `${resource} "${id}" was not found.`,
    requestId: "mock-request",
  })
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
}

function nextId(prefix: string, items: { id: string }[]): string {
  return `${prefix}_${String(items.length + 1).padStart(2, "0")}`
}

function workspaceError(status: number, code: string, message: string): ApiError {
  return new ApiError({ status, code, message, requestId: "mock-request" })
}

function ensureMutation(
  result: { ok: true } | { ok: false; error: string },
  status = 409,
  code = "conflict",
) {
  if (!result.ok) throw workspaceError(status, code, result.error)
}

function ensureNotAborted(options?: CallOptions) {
  if (options?.signal?.aborted) {
    throw new ApiError({
      status: null,
      code: "aborted",
      message: "The request was cancelled.",
    })
  }
}

/** Deterministic mock VCS summary for the files screen branch indicator. */
const MOCK_FILES_GIT: FilesGitInfo = {
  branch: "feature/tidal-survey",
  upstream: "origin/main",
  ahead: 2,
  behind: 1,
}

function filesWorkspace(store: MockStore): FilesWorkspace {
  const state = store.getState()
  return {
    project: state.project,
    files: state.files,
    uploads: state.uploads,
    storage: store.getStorageUsage(),
    git: MOCK_FILES_GIT,
  }
}

// Deterministic presence rotation: each member's online flag is derived from
// a coarse time bucket so the presence strip drifts on its own during demos,
// without any real transport. The current user is always online.
const PRESENCE_BUCKET_MS = 15_000

function chatMemberHash(memberId: string): number {
  let hash = 0
  for (const char of memberId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash
}

function chatMemberOnline(memberId: string): boolean {
  if (memberId === CURRENT_USER.id) return true
  const bucket = Math.floor(Date.now() / PRESENCE_BUCKET_MS)
  return (chatMemberHash(memberId) + bucket) % 4 !== 0
}

// Away drift runs on a coarser bucket than online so a member stays "away"
// for a visible stretch instead of flickering every 15s. The current user is
// never away — they are actively looking at the screen.
const AWAY_BUCKET_MS = PRESENCE_BUCKET_MS * 8

function chatMemberAway(memberId: string, online: boolean): boolean {
  if (!online || memberId === CURRENT_USER.id) return false
  const bucket = Math.floor(Date.now() / AWAY_BUCKET_MS)
  return (chatMemberHash(memberId) * 3 + bucket) % 4 === 0
}

// Offline members get a deterministic "last seen" that drifts forward with a
// coarse hour bucket, so the timestamp stays plausible across a demo session.
function chatMemberLastSeen(memberId: string, online: boolean): string | undefined {
  if (online) return undefined
  const bucket = Math.floor(Date.now() / 3_600_000)
  const minutesAgo = 10 + ((chatMemberHash(memberId) + bucket) % 240)
  return new Date(Date.now() - minutesAgo * 60_000).toISOString()
}

function chatWorkspace(store: MockStore): ChatWorkspace {
  const state = store.getState()
  const lastReadAt = state.chat.lastReadAt
  const channels = state.chat.channels.map((channel) => {
    const threadMessages = state.chat.messages.filter((message) => message.channelId === channel.id)
    const lastMessage = threadMessages.reduce<ChannelMessage | null>(
      (latest, message) => (!latest || message.createdAt > latest.createdAt ? message : latest),
      null,
    )
    const readMarker = lastReadAt[channel.id] ?? ""
    const unreadCount = threadMessages.filter(
      (message) =>
        message.authorId !== CURRENT_USER.id &&
        message.status === "sent" &&
        message.createdAt > readMarker,
    ).length
    return {
      ...channel,
      unreadCount,
      lastMessagePreview: lastMessage?.body || undefined,
      lastMessageAt: lastMessage?.createdAt,
    }
  })
  return {
    project: state.project,
    activeChannelId: state.chat.activeChannelId,
    anonymous: state.chat.anonymous,
    channels,
    messages: state.chat.messages,
    members: state.chat.members.map((member) => {
      // Bots never go offline or away; people drift on the presence buckets.
      const online = member.bot ? true : chatMemberOnline(member.id)
      return {
        ...member,
        online,
        away: member.bot ? false : chatMemberAway(member.id, online),
        lastSeenAt: member.bot ? member.lastSeenAt : chatMemberLastSeen(member.id, online),
      }
    }),
    typing: state.chat.typing,
    botEnabled: state.chat.botEnabled,
  }
}

function labWorkspace(store: MockStore): LabWorkspace {
  const state = store.getState()
  return {
    project: state.project,
    activeEnvironmentId: state.lab.activeEnvironmentId,
    environments: state.lab.environments,
  }
}

function agentWorkspace(store: MockStore): AgentWorkspace {
  const state = store.getState()
  return {
    project: state.project,
    quota: state.agent.quota,
    config: { ...state.agent.config },
    activeRunId: state.agent.activeRunId,
    runs: state.agent.runs,
  }
}

export function createMockClient(): ApiClient {
  // One session store per project keeps screen mutations alive across client
  // navigation, exactly like the old provider-scoped store, but now owned by
  // the adapter so `NEXT_PUBLIC_API_MODE` can replace it wholesale.
  const workspaceStores = new Map<string, MockStore>()
  // Template applied at creation time, kept alongside the project list so the
  // lazily-created workspace store can seed the matching starter structure.
  const projectTemplates = new Map<string, ProjectTemplate>()
  const storeFor = (projectId: string) => {
    let store = workspaceStores.get(projectId)
    if (!store) {
      store = new MockStore(projectId, projectTemplates.get(projectId) ?? null)
      workspaceStores.set(projectId, store)
    }
    return store
  }

  const projects = [...seedProjects]
  const files = [...seedFiles]
  const labSessions = [...seedLabSessions]
  const messages = [...seedMessages]
  const agentRuns = [...seedAgentRuns]
  let sessionUser: User | null = seedUser
  // Per-client copy of the profile fixtures: the clone path writes new
  // entries, and mutating the shared module-level record would leak cloned
  // profiles into other clients (and across tests).
  const projectProfiles: Record<string, MockProjectProfile> = { ...mockProjectProfiles }
  // Per-client copy of the fixture feed so recorded activity persists for
  // this session's reads without mutating the shared seed array (which other
  // clients/tests also read).
  const activityEvents = [...mockActivityEvents]
  let activitySequence = 0
  // Same treatment for the run log: cancel transitions mutate entries, so each
  // client gets its own deep copy of the shared fixtures.
  const agentRunLog = structuredClone(mockAgentRunLog)
  // Mock clock anchored at `mockNow`, mirroring MockStore.now() so cancelled
  // runs get a finishedAt consistent with the fixture timeline.
  const mockNowMs = Date.parse(mockNow)
  const clientStartedAt = Date.now()
  const mockTimestamp = () => new Date(mockNowMs + (Date.now() - clientStartedAt)).toISOString()

  /**
   * Record a live activity event: prepend it to this client's feed (so the
   * next dashboard/project-home read includes it) and publish it over the
   * realtime channel so mounted feeds update without a refetch — the mock
   * adapter stands in for the backend producers that will call
   * `publishActivityEvent` directly.
   */
  const recordActivity = (input: {
    projectId?: string
    kind: ActivityKind
    summary: string
    target?: string
  }) => {
    activitySequence += 1
    const projectName = input.projectId
      ? (projects.find((project) => project.id === input.projectId)?.name ??
        workspaceStores.get(input.projectId)?.getState().project.name)
      : undefined
    const event: ActivityEvent = {
      id: `act_live_${Date.now().toString(36)}_${activitySequence}`,
      projectId: input.projectId,
      projectName,
      kind: input.kind,
      actor: { id: CURRENT_USER.id, name: CURRENT_USER.name },
      summary: input.summary,
      target: input.target,
      createdAt: new Date().toISOString(),
    }
    activityEvents.unshift(event)
    pushActivityEvent(event)
  }

  const projectsApi: ProjectsApi = {
    async listProjects() {
      return [...projects]
    },
    async getProject(id) {
      const project = projects.find((p) => p.id === id)
      if (!project) throw notFound("Project", id)
      return project
    },
    async createProject(input: CreateProjectInput) {
      const source = input.cloneFromProjectId
        ? projects.find((project) => project.id === input.cloneFromProjectId)
        : undefined
      const requestedTemplateId = input.templateId ?? source?.templateId
      const template = getProjectTemplate(requestedTemplateId)
      const project: Project = {
        id: nextId("prj", projects),
        name: input.name,
        slug: slugify(input.name),
        description: input.description,
        status: "active",
        // Clones inherit the source's templateId verbatim — seed projects
        // have none, so a clone must not be stamped "blank". Fresh projects
        // record the resolved template id, which also normalizes unknown ids.
        templateId: source ? (requestedTemplateId ? template.id : undefined) : template.id,
        createdAt: now,
        updatedAt: now,
      }
      projects.push(project)
      projectTemplates.set(project.id, template)

      // Cloning duplicates the source project's file records under fresh ids
      // and carries its visibility profile over (the clone is owned by the
      // current user). Template starter files the source does not already
      // have are still added below.
      const clonedPaths = new Set<string>()
      if (source) {
        files
          .filter((file) => file.projectId === source.id)
          .forEach((file) => {
            files.push({
              ...file,
              id: nextId("file", files),
              projectId: project.id,
              createdAt: now,
            })
            clonedPaths.add(file.path)
          })

        const sourceProfile = projectProfiles[source.id]
        if (sourceProfile) {
          const owner = sessionUser ?? mockUsers[0]
          projectProfiles[project.id] = {
            visibility: sourceProfile.visibility,
            owner,
            members: [{ id: `${owner.id}_owner`, user: owner, role: "owner", joinedAt: now }],
          }
        }

        // Materialize the source store first — storeFor seeds it correctly
        // even when the source was never opened — then hand the clone a deep
        // copy of its live file tree, chat threads, and lab environments.
        const sourceStore = storeFor(source.id)
        const state = structuredClone(sourceStore.getState())
        state.project = { ...state.project, id: project.id, name: project.name }
        workspaceStores.set(project.id, new MockStore(project.id, null, state))
      }

      // Surface the template's starter files on the project home as well;
      // the workspace store seeds the same paths as a FileNode tree.
      template.files.forEach((file) => {
        if (clonedPaths.has(file.path)) return
        files.push({
          id: nextId("file", files),
          projectId: project.id,
          name: file.path.split("/").pop() ?? file.path,
          path: file.path,
          sizeBytes: file.sizeBytes ?? (file.content ? file.content.length : 0),
          mimeType: file.mimeType,
          createdAt: now,
        })
      })
      recordActivity({
        projectId: project.id,
        kind: "project",
        summary: source ? `cloned ${source.name}` : "created the project",
        target: project.name,
      })
      return project
    },
    async updateProject(id, input: UpdateProjectInput) {
      const index = projects.findIndex((p) => p.id === id)
      if (index === -1) throw notFound("Project", id)
      const previous = projects[index]
      const { ownerId, ...fields } = input
      // Ownership transfer validates the target member and can throw — run it
      // before mutating the project row so a rejected request persists nothing.
      if (ownerId !== undefined) {
        transferOwnership(previous, ownerId)
      }
      projects[index] = { ...previous, ...fields, updatedAt: now }
      if (fields.status && fields.status !== previous.status) {
        recordActivity({
          projectId: id,
          kind: "project",
          summary: fields.status === "archived" ? "archived the project" : "restored the project",
          target: projects[index].name,
        })
      }
      return projects[index]
    },
    async deleteProject(id) {
      const index = projects.findIndex((p) => p.id === id)
      if (index === -1) throw notFound("Project", id)
      projects.splice(index, 1)
    },
    async addProjectMember(id, input: AddProjectMemberInput): Promise<ProjectMember> {
      const project = findProjectOrThrow(id)
      // Candidates come from the workspace roster — the same fixture list the
      // dashboard members screen stands in for until a team API lands.
      const user = mockUsers.find((candidate) => candidate.id === input.userId)
      if (!user) {
        throw workspaceError(
          422,
          "unprocessable_entity",
          `User "${input.userId}" is not a workspace member.`,
        )
      }
      const profile = editableProfile(project)
      if (profile.members.some((member) => member.user.id === user.id)) {
        throw workspaceError(
          409,
          "conflict",
          `User "${user.id}" is already a member of project "${project.id}".`,
        )
      }
      const role = input.role ?? "member"
      const member: ProjectMember = {
        id: `${user.id}_${role}`,
        user,
        role,
        joinedAt: now,
      }
      profile.members.push(member)
      recordActivity({
        projectId: id,
        kind: "project",
        summary: "added a project member",
        target: user.name ?? user.email,
      })
      return member
    },
    async updateProjectMemberRole(
      id,
      memberId,
      role: ProjectMemberGrantRole,
    ): Promise<ProjectMember> {
      const project = findProjectOrThrow(id)
      const profile = editableProfile(project)
      const member = profile.members.find((item) => item.id === memberId)
      if (!member) throw notFound("Project member", memberId)
      // Ownership only moves through the transfer flow — a member row holding
      // the owner role cannot be demoted in place.
      if (member.role === "owner") {
        throw workspaceError(
          422,
          "unprocessable_entity",
          "The project owner's role is managed through ownership transfer.",
        )
      }
      if (member.role !== role) {
        member.role = role
        member.id = `${member.user.id}_${role}`
        recordActivity({
          projectId: id,
          kind: "project",
          summary: `changed a member's role to ${role}`,
          target: member.user.name ?? member.user.email,
        })
      }
      return member
    },
    async removeProjectMember(id, memberId) {
      const project = findProjectOrThrow(id)
      const profile = editableProfile(project)
      const member = profile.members.find((item) => item.id === memberId)
      if (!member) throw notFound("Project member", memberId)
      // The owner row mirrors profile.owner — removing it would orphan the
      // project, so ownership must be transferred first.
      if (member.role === "owner" || member.user.id === profile.owner.id) {
        throw workspaceError(
          422,
          "unprocessable_entity",
          "The project owner cannot be removed. Transfer ownership first.",
        )
      }
      profile.members = profile.members.filter((item) => item.id !== memberId)
      recordActivity({
        projectId: id,
        kind: "project",
        summary: "removed a project member",
        target: member.user.name ?? member.user.email,
      })
    },
  }

  const filesApi: FilesApi = {
    async listFiles(projectId) {
      return files.filter((f) => projectId === undefined || f.projectId === projectId)
    },
    async getFile(id) {
      const file = files.find((f) => f.id === id)
      if (!file) throw notFound("File", id)
      return file
    },
    async deleteFile(id) {
      const index = files.findIndex((f) => f.id === id)
      if (index === -1) throw notFound("File", id)
      files.splice(index, 1)
    },
  }

  const labApi: LabApi = {
    async listLabSessions(projectId) {
      return labSessions.filter((s) => projectId === undefined || s.projectId === projectId)
    },
    async getLabSession(id) {
      const session = labSessions.find((s) => s.id === id)
      if (!session) throw notFound("Lab session", id)
      return session
    },
    async createLabSession(input: CreateLabSessionInput) {
      const session: LabSession = {
        id: nextId("lab", labSessions),
        projectId: input.projectId,
        title: input.title,
        status: "queued",
        createdAt: now,
      }
      labSessions.push(session)
      return session
    },
  }

  const chatApi: ChatApi = {
    async listMessages(conversationId) {
      return messages.filter((m) => m.conversationId === conversationId)
    },
    async sendMessage(input: SendChatMessageInput) {
      const conversationId = input.conversationId ?? "conv_01"
      const message: ChatMessage = {
        id: nextId("msg", messages),
        conversationId,
        role: "user",
        content: input.content,
        createdAt: now,
      }
      messages.push(message)
      messages.push({
        id: nextId("msg", messages),
        conversationId,
        role: "assistant",
        content: `Echo: ${input.content}`,
        createdAt: now,
      })
      return message
    },
  }

  const agentApi: AgentApi = {
    async listAgentRuns(projectId) {
      return agentRuns.filter((r) => projectId === undefined || r.projectId === projectId)
    },
    async getAgentRun(id) {
      const run = agentRuns.find((r) => r.id === id)
      if (!run) throw notFound("Agent run", id)
      return run
    },
    async createAgentRun(input: CreateAgentRunInput) {
      const run: AgentRun = {
        id: nextId("run", agentRuns),
        projectId: input.projectId,
        prompt: input.prompt,
        status: "queued",
        createdAt: now,
      }
      agentRuns.push(run)
      return run
    },
    async cancelAgentRun(id) {
      const index = agentRuns.findIndex((r) => r.id === id)
      if (index === -1) throw notFound("Agent run", id)
      agentRuns[index] = { ...agentRuns[index], status: "cancelled", finishedAt: now }
      return agentRuns[index]
    },
  }

  const authApi: AuthApi = {
    async getSession() {
      return sessionUser
    },
    async login(input: LoginInput) {
      if (!input.email.includes("@")) {
        throw new ApiError({
          status: 401,
          code: "unauthorized",
          message: "Invalid email or password.",
          requestId: "mock-request",
        })
      }
      sessionUser = { ...seedUser, email: input.email }
      return sessionUser
    },
    async logout() {
      sessionUser = null
    },
  }

  const usageApi: UsageApi = {
    async getUsageSummary() {
      return { ...seedUsage }
    },
  }

  function profileFor(project: Project): MockProjectProfile {
    const profile = projectProfiles[project.id]
    if (profile) return profile

    const owner = sessionUser ?? mockUsers[0]
    return {
      visibility: "private",
      owner,
      members: [
        {
          id: `${owner.id}_owner`,
          user: owner,
          role: "owner",
          joinedAt: project.createdAt,
        },
      ],
    }
  }

  function projectDetails(project: Project): ProjectDetails {
    const profile = profileFor(project)
    return {
      ...project,
      visibility: profile.visibility,
      owner: profile.owner,
      members: profile.members,
    }
  }

  /**
   * Return a writeable copy of the project's profile and store it back.
   * projectProfiles is a shallow copy of the shared fixtures, so member
   * mutations must clone the profile (and its member rows) first — otherwise
   * they would leak into mockProjectProfiles and every other client.
   */
  function editableProfile(project: Project): MockProjectProfile {
    const stored = profileFor(project)
    const profile: MockProjectProfile = {
      ...stored,
      members: stored.members.map((member) => ({ ...member })),
    }
    projectProfiles[project.id] = profile
    return profile
  }

  function findProjectOrThrow(id: string): Project {
    const project = projects.find((item) => item.id === id)
    if (!project) throw notFound("Project", id)
    return project
  }

  /**
   * Swap project ownership inside the mock profile store: the target member
   * is promoted to `owner` and the previous owner drops to `member`, matching
   * the settings screen's "you stay on as a member" copy.
   */
  function transferOwnership(project: Project, ownerId: string) {
    const profile = editableProfile(project)
    // Transferring to the current owner is a no-op — check before the member
    // lookup so an owner without a member row doesn't fail with a 422.
    if (ownerId === profile.owner.id) return
    const target = profile.members.find((member) => member.user.id === ownerId)
    if (!target) {
      throw workspaceError(
        422,
        "unprocessable_entity",
        `User "${ownerId}" is not a member of project "${project.id}".`,
      )
    }

    const previousOwnerId = profile.owner.id
    const hasPreviousOwnerRow = profile.members.some((member) => member.user.id === previousOwnerId)
    profile.members = profile.members.map((member) => ({
      ...member,
      role:
        member.user.id === ownerId
          ? ("owner" as const)
          : member.user.id === previousOwnerId
            ? ("member" as const)
            : member.role,
    }))
    if (!hasPreviousOwnerRow) {
      profile.members.push({
        id: `${previousOwnerId}_member`,
        user: profile.owner,
        role: "member",
        joinedAt: now,
      })
    }
    profile.owner = target.user
    recordActivity({
      projectId: project.id,
      kind: "project",
      summary: "transferred ownership",
      target: target.user.name ?? target.user.email,
    })
  }

  function byRecent<T extends { createdAt: string }>(items: T[]): T[] {
    return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  function projectFiles(projectId: string) {
    return files.filter((file) => file.projectId === projectId)
  }

  function projectSessions(projectId: string) {
    return labSessions.filter((session) => session.projectId === projectId)
  }

  function projectRuns(projectId: string) {
    return agentRuns.filter((run) => run.projectId === projectId)
  }

  function projectActivity(projectId: string): ActivityEvent[] {
    return byRecent(activityEvents.filter((event) => event.projectId === projectId))
  }

  function summarizeProject(project: Project): ProjectSummary {
    const projectFileList = projectFiles(project.id)
    const activity = projectActivity(project.id)
    const latestResourceAt = [
      ...projectFileList,
      ...projectSessions(project.id),
      ...projectRuns(project.id),
    ]
      .map((item) => item.createdAt)
      .sort()
      .at(-1)
    const profile = profileFor(project)

    return {
      ...project,
      owner: profile.owner,
      visibility: profile.visibility,
      memberCount: profile.members.length,
      members: profile.members.map((member) => member.user),
      fileCount: projectFileList.length,
      labSessionCount: projectSessions(project.id).length,
      agentRunCount: projectRuns(project.id).length,
      storageBytes: projectFileList.reduce((total, file) => total + file.sizeBytes, 0),
      latestActivityAt: activity[0]?.createdAt ?? latestResourceAt ?? project.updatedAt,
    }
  }

  function storageUsage(): StorageUsage {
    const fileBytes = files.reduce((total, file) => total + file.sizeBytes, 0)
    const usedBytes = fileBytes + mockComputeStorageBytes
    return {
      usedBytes,
      totalBytes: mockStorageQuotaBytes,
      fileBytes,
      computeBytes: mockComputeStorageBytes,
      availableBytes: Math.max(mockStorageQuotaBytes - usedBytes, 0),
    }
  }

  const dashboardApi: DashboardApi = {
    async listWorkspaceMembers() {
      // The workspace roster mirrors the team members fixtures until the real
      // members endpoint lands; return copies so callers cannot mutate them.
      return mockUsers.map((user) => ({ ...user }))
    },
    async getWorkspaceDashboard(): Promise<WorkspaceDashboard> {
      return {
        workspace: mockWorkspace,
        user: sessionUser ?? mockUsers[0],
        projects: projects
          .map(summarizeProject)
          .sort((a, b) =>
            (b.latestActivityAt ?? b.updatedAt).localeCompare(a.latestActivityAt ?? a.updatedAt),
          ),
        activity: byRecent(activityEvents).slice(0, 8),
        storage: storageUsage(),
        generatedAt: now,
      }
    },
    async getProjectHome(projectId): Promise<ProjectHomeData> {
      const project = projects.find((item) => item.id === projectId)
      if (!project) throw notFound("Project", projectId)

      const conversationId = `conv_${project.id}`
      return {
        project: projectDetails(project),
        files: byRecent(projectFiles(project.id)),
        labSessions: byRecent(projectSessions(project.id)),
        agentRuns: byRecent(projectRuns(project.id)),
        chatConversationId: conversationId,
        chatMessages: byRecent(
          messages.filter(
            (message) =>
              message.conversationId === conversationId || message.projectId === project.id,
          ),
        ),
        activity: projectActivity(project.id),
        storageBytes: projectFiles(project.id).reduce((total, file) => total + file.sizeBytes, 0),
        generatedAt: now,
      }
    },
    async listAgentRunLog(): Promise<AgentRunLogEntry[]> {
      return [...agentRunLog].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },
    async getAgentRunLogEntry(id): Promise<AgentRunLogEntry> {
      const entry = agentRunLog.find((run) => run.id === id)
      if (!entry) throw notFound("Agent run", id)
      return entry
    },
    async cancelAgentRunLogEntry(id, options): Promise<AgentRunLogEntry> {
      ensureNotAborted(options)
      const entry = agentRunLog.find((run) => run.id === id)
      if (!entry) throw notFound("Agent run", id)
      if (!["queued", "running", "waiting_approval"].includes(entry.status)) {
        throw workspaceError(409, "conflict", "Run is not active.")
      }
      entry.status = "cancelled"
      entry.finishedAt = mockTimestamp()
      entry.summary = "Run cancelled."
      entry.steps.forEach((step) => {
        if (step.status === "running" || step.status === "pending") step.status = "cancelled"
      })
      if (entry.approval?.status === "pending") entry.approval.status = "rejected"
      return entry
    },
  }

  const workspaceApi: WorkspaceApi = {
    async getFiles(projectId, options) {
      ensureNotAborted(options)
      return filesWorkspace(storeFor(projectId))
    },
    async createFolder(projectId, input: CreateFolderInput, options) {
      ensureNotAborted(options)
      const store = storeFor(projectId)
      ensureMutation(store.createFolder(input.parentId, input.name), 422, "validation_error")
      recordActivity({
        projectId,
        kind: "file",
        summary: "created a folder",
        target: input.name.trim(),
      })
      return filesWorkspace(store)
    },
    async renameFileNode(projectId, input: RenameFileNodeInput, options) {
      ensureNotAborted(options)
      const store = storeFor(projectId)
      ensureMutation(store.renameNode(input.id, input.name), 422, "validation_error")
      return filesWorkspace(store)
    },
    async moveFileNodes(projectId, input: MoveFileNodesInput, options) {
      ensureNotAborted(options)
      const store = storeFor(projectId)
      ensureMutation(store.moveNodes(input.ids, input.targetFolderId), 409, "conflict")
      return filesWorkspace(store)
    },
    async trashFileNodes(projectId, input: TrashFileNodesInput, options) {
      ensureNotAborted(options)
      const store = storeFor(projectId)
      ensureMutation(store.trashNodes(input.ids), 422, "validation_error")
      return filesWorkspace(store)
    },
    async restoreFileNodeVersion(projectId, input: RestoreFileNodeVersionInput, options) {
      ensureNotAborted(options)
      const store = storeFor(projectId)
      ensureMutation(store.restoreVersion(input.id, input.versionId), 422, "validation_error")
      return filesWorkspace(store)
    },
    async addUploads(projectId, input: AddUploadsInput, options): Promise<AddUploadsResult> {
      ensureNotAborted(options)
      const store = storeFor(projectId)
      const result = store.addUploads(input.parentId, input.files)
      return { ...result, workspace: filesWorkspace(store) }
    },
    async tickUploads(projectId, options) {
      ensureNotAborted(options)
      const store = storeFor(projectId)
      const doneBefore = new Set(
        store
          .getState()
          .uploads.filter((upload) => upload.status === "done")
          .map((upload) => upload.id),
      )
      store.tickUploads()
      const finished = store
        .getState()
        .uploads.filter((upload) => upload.status === "done" && !doneBefore.has(upload.id))
      if (finished.length > 0) {
        const names = finished.map((upload) => upload.name)
        recordActivity({
          projectId,
          kind: "file",
          summary: `uploaded ${finished.length} file${finished.length === 1 ? "" : "s"}`,
          target: names.slice(0, 3).join(", ") + (names.length > 3 ? ", …" : ""),
        })
      }
      return filesWorkspace(store)
    },
    async updateUpload(projectId, uploadId, action: UploadAction, options) {
      ensureNotAborted(options)
      const store = storeFor(projectId)
      if (action === "pause") ensureMutation(store.pauseUpload(uploadId), 404, "not_found")
      if (action === "resume") ensureMutation(store.resumeUpload(uploadId), 404, "not_found")
      if (action === "retry") ensureMutation(store.retryUpload(uploadId), 404, "not_found")
      if (action === "cancel") ensureMutation(store.cancelUpload(uploadId), 404, "not_found")
      return filesWorkspace(store)
    },

    async getChat(projectId, options) {
      ensureNotAborted(options)
      return chatWorkspace(storeFor(projectId))
    },
    async selectChatChannel(projectId, channelId, options) {
      ensureNotAborted(options)
      const store = storeFor(projectId)
      ensureMutation(store.setActiveChatChannel(channelId), 404, "not_found")
      return chatWorkspace(store)
    },
    async setChatAnonymous(projectId, anonymous, options) {
      ensureNotAborted(options)
      const store = storeFor(projectId)
      store.setChatAnonymous(anonymous)
      return chatWorkspace(store)
    },
    async setChatBotEnabled(projectId, enabled, options) {
      ensureNotAborted(options)
      const store = storeFor(projectId)
      store.setChatBotEnabled(enabled)
      return chatWorkspace(store)
    },
    async createChatChannel(projectId, input, options) {
      ensureNotAborted(options)
      const store = storeFor(projectId)
      const result = store.createChatChannel(input.name, input.kind)
      if (!result.ok) throw workspaceError(422, "validation_error", result.error)
      return chatWorkspace(store)
    },
    async toggleChatReaction(projectId, messageId, emoji, options) {
      ensureNotAborted(options)
      const store = storeFor(projectId)
      ensureMutation(store.toggleChatReaction(messageId, emoji), 404, "not_found")
      return chatWorkspace(store)
    },
    async sendChannelMessage(projectId, input: SendChannelMessageInput, options) {
      ensureNotAborted(options)
      const store = storeFor(projectId)
      const id = store.sendChatMessage(
        input.channelId,
        input.body,
        input.anonymous,
        input.attachments ?? [],
        input.mentions ?? [],
        input.replyToId,
      )
      if (!id) throw workspaceError(422, "validation_error", "The message could not be sent.")
      // Placeholder demo reply until the real chat backend exists; it threads
      // under the message that triggered it. Messages addressed to the chat
      // bot (slash command or @mention) get a rule-based bot reply instead of
      // a random member's canned one.
      store.queueChatResponse(input.channelId, 1100, id, input.body)
      const channelName = store
        .getState()
        .chat.channels.find((channel) => channel.id === input.channelId)?.name
      recordActivity({
        projectId,
        kind: "chat",
        summary: "sent a message",
        target: channelName ? `#${channelName}` : undefined,
      })
      return chatWorkspace(store)
    },
    async settleChannelMessages(projectId, options) {
      ensureNotAborted(options)
      const store = storeFor(projectId)
      store.settleChatMessages()
      return chatWorkspace(store)
    },
    async retryChannelMessage(projectId, messageId, options) {
      ensureNotAborted(options)
      const store = storeFor(projectId)
      ensureMutation(store.retryChatMessage(messageId), 409, "conflict")
      return chatWorkspace(store)
    },

    async getLab(projectId, options) {
      ensureNotAborted(options)
      return labWorkspace(storeFor(projectId))
    },
    async selectLabEnvironment(projectId, environmentId, options) {
      ensureNotAborted(options)
      const store = storeFor(projectId)
      ensureMutation(store.setActiveLabEnvironment(environmentId), 404, "not_found")
      return labWorkspace(store)
    },
    async startLabEnvironment(projectId, environmentId, options) {
      ensureNotAborted(options)
      const store = storeFor(projectId)
      ensureMutation(store.startLabSession(environmentId), 409, "conflict")
      const environmentName = store
        .getState()
        .lab.environments.find((environment) => environment.id === environmentId)?.name
      recordActivity({
        projectId,
        kind: "lab",
        summary: "started a lab session",
        target: environmentName,
      })
      return labWorkspace(store)
    },
    async completeLabEnvironmentStart(projectId, environmentId, options) {
      ensureNotAborted(options)
      const store = storeFor(projectId)
      ensureMutation(store.completeLabSessionStart(environmentId), 409, "conflict")
      return labWorkspace(store)
    },
    async stopLabEnvironment(projectId, environmentId, options) {
      ensureNotAborted(options)
      const store = storeFor(projectId)
      ensureMutation(store.stopLabSession(environmentId), 409, "conflict")
      return labWorkspace(store)
    },
    async pingLabEnvironment(projectId, environmentId, options) {
      ensureNotAborted(options)
      const store = storeFor(projectId)
      ensureMutation(store.pingLabSession(environmentId), 409, "conflict")
      return labWorkspace(store)
    },

    async getAgent(projectId, options) {
      ensureNotAborted(options)
      return agentWorkspace(storeFor(projectId))
    },
    async updateAgentConfig(projectId, config, options) {
      ensureNotAborted(options)
      const store = storeFor(projectId)
      store.setAgentConfig(config)
      return agentWorkspace(store)
    },
    async startAgentRun(projectId, prompt, config, options) {
      ensureNotAborted(options)
      const store = storeFor(projectId)
      // Validate before runAgent: an empty prompt and an exhausted quota both
      // make the store return null, and the prompt error must not masquerade
      // as a 429 rate limit.
      const effectivePrompt = prompt.trim()
      if (!effectivePrompt) {
        throw workspaceError(400, "validation_error", "Agent prompt cannot be empty.")
      }
      if (config) store.setAgentConfig(config)
      if (!store.runAgent(prompt, config)) {
        throw workspaceError(
          429,
          "rate_limited",
          "Daily agent quota is exhausted. The mock quota resets on reload.",
        )
      }
      recordActivity({
        projectId,
        kind: "agent",
        summary: "started an agent run",
        target: effectivePrompt.length > 80 ? `${effectivePrompt.slice(0, 77)}…` : effectivePrompt,
      })
      return agentWorkspace(store)
    },
    async retryAgentRun(projectId, runId, options) {
      ensureNotAborted(options)
      const store = storeFor(projectId)
      if (!store.retryAgentRun(runId)) {
        throw workspaceError(
          409,
          "conflict",
          "Retry is unavailable — quota may be exhausted or the run is still active.",
        )
      }
      return agentWorkspace(store)
    },
    async cancelAgentRun(projectId, runId, options) {
      ensureNotAborted(options)
      const store = storeFor(projectId)
      ensureMutation(store.cancelAgentRun(runId), 409, "conflict")
      return agentWorkspace(store)
    },
    async advanceAgentRuns(projectId, options) {
      ensureNotAborted(options)
      const store = storeFor(projectId)
      store.advanceAgentRuns()
      return agentWorkspace(store)
    },
    async reviewAgentDiff(projectId, runId, decision, options) {
      ensureNotAborted(options)
      const store = storeFor(projectId)
      ensureMutation(store.reviewAgentDiff(runId, decision), 409, "conflict")
      return agentWorkspace(store)
    },
  }

  return {
    projects: projectsApi,
    files: filesApi,
    lab: labApi,
    chat: chatApi,
    agent: agentApi,
    auth: authApi,
    usage: usageApi,
    dashboard: dashboardApi,
    workspace: workspaceApi,
  }
}
