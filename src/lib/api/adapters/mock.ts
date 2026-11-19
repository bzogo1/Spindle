/**
 * Mock adapter — the reference implementation of `ApiClient`.
 *
 * Serves deterministic in-memory fixtures so screens can be built before the
 * backend exists. Mutations update the in-memory store so subsequent reads
 * reflect them within the session. Errors are normalized to `ApiError` with
 * the same codes the HTTP adapter produces for equivalent failures.
 */

import { ApiError } from "../client"
import {
  mockActivityEvents,
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
import type {
  ActivityEvent,
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
  ProjectDetails,
  ProjectHomeData,
  ProjectsApi,
  ProjectSummary,
  SendChatMessageInput,
  StorageUsage,
  UpdateProjectInput,
  UsageApi,
  User,
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

export function createMockClient(): ApiClient {
  const projects = [...seedProjects]
  const files = [...seedFiles]
  const labSessions = [...seedLabSessions]
  const messages = [...seedMessages]
  const agentRuns = [...seedAgentRuns]
  let sessionUser: User | null = seedUser

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
      const project: Project = {
        id: nextId("prj", projects),
        name: input.name,
        slug: slugify(input.name),
        description: input.description,
        status: "active",
        createdAt: now,
        updatedAt: now,
      }
      projects.push(project)
      return project
    },
    async updateProject(id, input: UpdateProjectInput) {
      const index = projects.findIndex((p) => p.id === id)
      if (index === -1) throw notFound("Project", id)
      projects[index] = { ...projects[index], ...input, updatedAt: now }
      return projects[index]
    },
    async deleteProject(id) {
      const index = projects.findIndex((p) => p.id === id)
      if (index === -1) throw notFound("Project", id)
      projects.splice(index, 1)
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
    const profile = mockProjectProfiles[project.id]
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
    return byRecent(mockActivityEvents.filter((event) => event.projectId === projectId))
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
    async getWorkspaceDashboard(): Promise<WorkspaceDashboard> {
      return {
        workspace: mockWorkspace,
        user: sessionUser ?? mockUsers[0],
        projects: projects
          .map(summarizeProject)
          .sort((a, b) =>
            (b.latestActivityAt ?? b.updatedAt).localeCompare(a.latestActivityAt ?? a.updatedAt),
          ),
        activity: byRecent(mockActivityEvents).slice(0, 8),
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
  }
}
