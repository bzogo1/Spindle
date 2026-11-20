import type {
  AgentRunLogEntry,
  AgentWorkspace,
  AppSettingsData,
  ChatWorkspace,
  FilesWorkspace,
  LabWorkspace,
  ProjectHomeData,
  StorageUsage,
  UsageSummary,
  WorkspaceDashboard,
} from "./types"
import { DEFAULT_AGENT_CONFIG, projectDisplayName } from "./workspace-utils"

const emptyDate = "1970-01-01T00:00:00.000Z"
const emptyStorageLimitBytes = 5 * 1024 * 1024 * 1024

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
    daily: [],
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

export function createEmptyFilesWorkspace(projectId: string): FilesWorkspace {
  return {
    project: {
      id: projectId,
      name: projectDisplayName(projectId),
      owner: "",
      storageLimitBytes: emptyStorageLimitBytes,
    },
    files: [],
    uploads: [],
    storage: { usedBytes: 0, limitBytes: emptyStorageLimitBytes },
  }
}

export function createEmptyChatWorkspace(projectId: string): ChatWorkspace {
  return {
    project: {
      id: projectId,
      name: projectDisplayName(projectId),
      owner: "",
      storageLimitBytes: emptyStorageLimitBytes,
    },
    activeChannelId: "",
    anonymous: false,
    botEnabled: true,
    channels: [],
    messages: [],
    members: [],
    typing: [],
  }
}

export function createEmptyLabWorkspace(projectId: string): LabWorkspace {
  return {
    project: {
      id: projectId,
      name: projectDisplayName(projectId),
      owner: "",
      storageLimitBytes: emptyStorageLimitBytes,
    },
    activeEnvironmentId: "",
    environments: [],
  }
}

export function createEmptyAgentWorkspace(projectId: string): AgentWorkspace {
  return {
    project: {
      id: projectId,
      name: projectDisplayName(projectId),
      owner: "",
      storageLimitBytes: emptyStorageLimitBytes,
    },
    quota: { dailyLimit: 20, bonus: 50, used: 0 },
    config: { ...DEFAULT_AGENT_CONFIG },
    activeRunId: null,
    runs: [],
  }
}

export function createEmptyAgentRunLogEntry(id: string): AgentRunLogEntry {
  return {
    id,
    projectId: "",
    projectName: "Unknown project",
    prompt: "",
    status: "queued",
    actor: { id: "empty-user", name: "Workspace member" },
    createdAt: emptyDate,
    startedAt: null,
    finishedAt: null,
    steps: [],
    approval: null,
    summary: null,
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
