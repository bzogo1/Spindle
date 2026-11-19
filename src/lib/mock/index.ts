import type {
  ActivityActor,
  ActivityEvent,
  AgentRun,
  ChatMessage,
  LabSession,
  Project,
  ProjectFile,
  ProjectMember,
  ProjectVisibility,
  UsageSummary,
  User,
  Workspace,
} from "../api/types"

export const mockNow = "2026-11-19T12:00:00.000Z"

export const mockUsers: User[] = [
  {
    id: "usr_01",
    name: "Bogdan Zogovic",
    email: "bogdan@northlight.dev",
    createdAt: "2026-01-12T09:00:00.000Z",
  },
  {
    id: "usr_02",
    name: "Mara Chen",
    email: "mara@northlight.dev",
    createdAt: "2026-02-03T10:30:00.000Z",
  },
  {
    id: "usr_03",
    name: "Ilya Petrov",
    email: "ilya@northlight.dev",
    createdAt: "2026-03-18T14:15:00.000Z",
  },
  {
    id: "usr_04",
    name: "June Park",
    email: "june@northlight.dev",
    createdAt: "2026-04-22T08:45:00.000Z",
  },
]

export const mockSessionUser = mockUsers[0]

export const mockWorkspace: Workspace = {
  id: "wsp_01",
  name: "Northlight Research",
  slug: "northlight",
  role: "owner",
  createdAt: "2026-01-12T09:00:00.000Z",
}

export const mockStorageQuotaBytes = 5 * 1024 * 1024 * 1024
export const mockComputeStorageBytes = 384 * 1024 * 1024

export const mockProjects: Project[] = [
  {
    id: "prj_01",
    name: "Coastal Resilience",
    slug: "coastal-resilience",
    description:
      "Field study, notebooks, and survey data for the 2026 coastal resilience campaign.",
    status: "active",
    createdAt: "2026-05-04T10:00:00.000Z",
    updatedAt: "2026-11-19T10:42:00.000Z",
  },
  {
    id: "prj_02",
    name: "Tide Model Archive",
    slug: "tide-model-archive",
    description: "Archived model runs, calibration notes, and reusable tide datasets.",
    status: "active",
    createdAt: "2026-06-21T13:20:00.000Z",
    updatedAt: "2026-11-18T16:20:00.000Z",
  },
  {
    id: "prj_03",
    name: "Field Notes",
    slug: "field-notes",
    description: "Loose observations and voice memos waiting for a proper home.",
    status: "active",
    createdAt: "2026-10-02T09:10:00.000Z",
    updatedAt: "2026-10-30T11:05:00.000Z",
  },
]

export interface MockProjectProfile {
  visibility: ProjectVisibility
  owner: User
  members: ProjectMember[]
}

function member(user: User, role: ProjectMember["role"], joinedAt: string): ProjectMember {
  return { id: `${user.id}_${role}`, user, role, joinedAt }
}

export const mockProjectProfiles: Record<string, MockProjectProfile> = {
  prj_01: {
    visibility: "workspace",
    owner: mockUsers[0],
    members: [
      member(mockUsers[0], "owner", "2026-05-04T10:00:00.000Z"),
      member(mockUsers[1], "admin", "2026-05-11T15:30:00.000Z"),
      member(mockUsers[2], "member", "2026-06-02T09:45:00.000Z"),
    ],
  },
  prj_02: {
    visibility: "private",
    owner: mockUsers[1],
    members: [
      member(mockUsers[1], "owner", "2026-06-21T13:20:00.000Z"),
      member(mockUsers[0], "member", "2026-07-08T12:00:00.000Z"),
    ],
  },
  prj_03: {
    visibility: "private",
    owner: mockUsers[3],
    members: [],
  },
}

export const mockFiles: ProjectFile[] = [
  {
    id: "file_01",
    projectId: "prj_01",
    name: "README.md",
    path: "docs/README.md",
    sizeBytes: 8_192,
    mimeType: "text/markdown",
    createdAt: "2026-11-12T09:00:00.000Z",
  },
  {
    id: "file_02",
    projectId: "prj_01",
    name: "schema.prisma",
    path: "prisma/schema.prisma",
    sizeBytes: 12_288,
    mimeType: "text/plain",
    createdAt: "2026-11-11T14:20:00.000Z",
  },
  {
    id: "file_03",
    projectId: "prj_01",
    name: "tidal-2026.csv",
    path: "data/tidal-2026.csv",
    sizeBytes: 84_200_000,
    mimeType: "text/csv",
    createdAt: "2026-11-18T07:30:00.000Z",
  },
  {
    id: "file_04",
    projectId: "prj_01",
    name: "survey.parquet",
    path: "data/survey.parquet",
    sizeBytes: 612_400_000,
    mimeType: "application/vnd.apache.parquet",
    createdAt: "2026-11-18T08:05:00.000Z",
  },
  {
    id: "file_05",
    projectId: "prj_01",
    name: "analysis.ipynb",
    path: "notebooks/analysis.ipynb",
    sizeBytes: 240_000,
    mimeType: "application/x-ipynb+json",
    createdAt: "2026-11-19T09:15:00.000Z",
  },
  {
    id: "file_06",
    projectId: "prj_01",
    name: "site-photos.pdf",
    path: "output/site-photos.pdf",
    sizeBytes: 18_400_000,
    mimeType: "application/pdf",
    createdAt: "2026-11-17T16:45:00.000Z",
  },
  {
    id: "file_07",
    projectId: "prj_02",
    name: "methodology.md",
    path: "docs/methodology.md",
    sizeBytes: 15_000,
    mimeType: "text/markdown",
    createdAt: "2026-11-15T11:10:00.000Z",
  },
  {
    id: "file_08",
    projectId: "prj_02",
    name: "model-card.json",
    path: "models/model-card.json",
    sizeBytes: 96_000,
    mimeType: "application/json",
    createdAt: "2026-11-16T13:25:00.000Z",
  },
]

export const mockLabSessions: LabSession[] = [
  {
    id: "lab_01",
    projectId: "prj_01",
    title: "Tide analysis baseline",
    status: "completed",
    createdAt: "2026-11-19T08:10:00.000Z",
    endedAt: "2026-11-19T08:18:00.000Z",
  },
  {
    id: "lab_02",
    projectId: "prj_01",
    title: "Survey cleaning notebook",
    status: "running",
    createdAt: "2026-11-19T11:20:00.000Z",
  },
  {
    id: "lab_03",
    projectId: "prj_02",
    title: "Calibration replay",
    status: "failed",
    createdAt: "2026-11-17T15:00:00.000Z",
    endedAt: "2026-11-17T15:04:00.000Z",
  },
]

export const mockMessages: ChatMessage[] = [
  {
    id: "msg_01",
    conversationId: "conv_01",
    role: "user",
    content: "Summarize the current sprint.",
    createdAt: "2026-11-18T09:00:00.000Z",
  },
  {
    id: "msg_02",
    conversationId: "conv_01",
    role: "assistant",
    content: "The sprint focuses on the authenticated app shell.",
    createdAt: "2026-11-18T09:01:00.000Z",
  },
  {
    id: "msg_03",
    conversationId: "conv_prj_01",
    projectId: "prj_01",
    role: "user",
    content: "Can we compare the new survey.parquet against last month's tide table?",
    createdAt: "2026-11-19T10:05:00.000Z",
  },
  {
    id: "msg_04",
    conversationId: "conv_prj_01",
    projectId: "prj_01",
    role: "assistant",
    content: "Yes — the schema matches. I queued a diff in the lab run.",
    createdAt: "2026-11-19T10:06:00.000Z",
  },
  {
    id: "msg_05",
    conversationId: "conv_prj_02",
    projectId: "prj_02",
    role: "user",
    content: "Where did the calibration replay stop?",
    createdAt: "2026-11-17T15:02:00.000Z",
  },
  {
    id: "msg_06",
    conversationId: "conv_prj_02",
    projectId: "prj_02",
    role: "assistant",
    content: "It failed on the missing 2019 tide gauge export. I left the checkpoint in Files.",
    createdAt: "2026-11-17T15:03:00.000Z",
  },
]

export const mockAgentRuns: AgentRun[] = [
  {
    id: "run_01",
    projectId: "prj_01",
    prompt: "Clean the tidal CSV and summarize missing stations",
    status: "succeeded",
    result: "Removed 37 duplicate rows and produced station-missing.csv.",
    createdAt: "2026-11-19T09:30:00.000Z",
    finishedAt: "2026-11-19T09:34:00.000Z",
  },
  {
    id: "run_02",
    projectId: "prj_01",
    prompt: "Draft the methods section from the latest notebook",
    status: "running",
    createdAt: "2026-11-19T11:45:00.000Z",
  },
  {
    id: "run_03",
    projectId: "prj_02",
    prompt: "Find the calibration replay failure and propose a fix",
    status: "failed",
    result: "Stopped because the 2019 tide gauge export is absent.",
    createdAt: "2026-11-17T15:01:00.000Z",
    finishedAt: "2026-11-17T15:04:00.000Z",
  },
]

function actor(user: User): ActivityActor {
  return { id: user.id, name: user.name ?? user.email }
}

export const mockActivityEvents: ActivityEvent[] = [
  {
    id: "act_01",
    projectId: "prj_01",
    projectName: "Coastal Resilience",
    kind: "agent",
    actor: actor(mockUsers[0]),
    summary: "started an agent run",
    target: "Draft the methods section",
    createdAt: "2026-11-19T11:45:00.000Z",
  },
  {
    id: "act_02",
    projectId: "prj_01",
    projectName: "Coastal Resilience",
    kind: "lab",
    actor: actor(mockUsers[2]),
    summary: "started a lab session",
    target: "Survey cleaning notebook",
    createdAt: "2026-11-19T11:20:00.000Z",
  },
  {
    id: "act_03",
    projectId: "prj_01",
    projectName: "Coastal Resilience",
    kind: "agent",
    actor: actor(mockUsers[0]),
    summary: "completed an agent run",
    target: "Clean the tidal CSV",
    createdAt: "2026-11-19T09:34:00.000Z",
  },
  {
    id: "act_04",
    projectId: "prj_01",
    projectName: "Coastal Resilience",
    kind: "file",
    actor: actor(mockUsers[1]),
    summary: "uploaded a file",
    target: "survey.parquet",
    createdAt: "2026-11-18T08:05:00.000Z",
  },
  {
    id: "act_05",
    projectId: "prj_02",
    projectName: "Tide Model Archive",
    kind: "lab",
    actor: actor(mockUsers[1]),
    summary: "lab session failed",
    target: "Calibration replay",
    createdAt: "2026-11-17T15:04:00.000Z",
  },
  {
    id: "act_06",
    projectId: "prj_02",
    projectName: "Tide Model Archive",
    kind: "file",
    actor: actor(mockUsers[1]),
    summary: "uploaded a file",
    target: "model-card.json",
    createdAt: "2026-11-16T13:25:00.000Z",
  },
  {
    id: "act_07",
    projectId: "prj_03",
    projectName: "Field Notes",
    kind: "project",
    actor: actor(mockUsers[3]),
    summary: "created the project",
    createdAt: "2026-10-02T09:10:00.000Z",
  },
  {
    id: "act_08",
    kind: "system",
    actor: actor(mockUsers[0]),
    summary: "storage warning threshold changed",
    target: "Northlight Research",
    createdAt: "2026-10-28T10:00:00.000Z",
  },
]

export const mockUsageSummary: UsageSummary = {
  periodStart: "2026-11-01T00:00:00.000Z",
  periodEnd: "2026-11-30T23:59:59.000Z",
  requests: 1284,
  tokens: 412_030,
  costUsd: 3.87,
}
