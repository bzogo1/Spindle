import type {
  AppSettingsData,
  ProjectHomeData,
  StorageUsage,
  UsageSummary,
  WorkspaceDashboard,
} from "./types"

const emptyDate = "1970-01-01T00:00:00.000Z"

export function createEmptyStorageUsage(): StorageUsage {
  return {
    usedBytes: 0,
    totalBytes: 0,
    fileBytes: 0,
    computeBytes: 0,
    availableBytes: 0,
  }
}

export function createEmptyWorkspaceDashboard(): WorkspaceDashboard {
  return {
    workspace: {
      id: "empty-workspace",
      name: "Workspace",
      slug: "workspace",
      role: "member",
      createdAt: emptyDate,
    },
    user: {
      id: "empty-user",
      email: "member@example.com",
      name: "Workspace member",
      createdAt: emptyDate,
    },
    projects: [],
    activity: [],
    storage: createEmptyStorageUsage(),
    generatedAt: emptyDate,
  }
}

export function createEmptyUsageSummary(): UsageSummary {
  return {
    periodStart: emptyDate,
    periodEnd: emptyDate,
    requests: 0,
    tokens: 0,
    costUsd: 0,
  }
}

export function createEmptyAppSettings(): AppSettingsData {
  const dashboard = createEmptyWorkspaceDashboard()
  return {
    user: dashboard.user,
    workspace: dashboard.workspace,
    usage: createEmptyUsageSummary(),
    generatedAt: dashboard.generatedAt,
  }
}

export function createEmptyProjectHome(projectId: string): ProjectHomeData {
  return {
    project: {
      id: projectId,
      name: "Untitled project",
      slug: "untitled-project",
      status: "active",
      createdAt: emptyDate,
      updatedAt: emptyDate,
      visibility: "private",
      owner: {
        id: "empty-user",
        email: "member@example.com",
        name: "Workspace member",
        createdAt: emptyDate,
      },
      members: [],
    },
    files: [],
    labSessions: [],
    agentRuns: [],
    chatConversationId: `conv_${projectId}`,
    chatMessages: [],
    activity: [],
    storageBytes: 0,
    generatedAt: emptyDate,
  }
}
