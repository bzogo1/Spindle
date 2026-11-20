import type {
  ActivityActor,
  ActivityEvent,
  AgentRun,
  AgentRunLogEntry,
  ChatMessage,
  LabSession,
  Project,
  ProjectFile,
  ProjectMember,
  ProjectVisibility,
  UsageComparison,
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
  description: "Independent research workspace for the Northlight team.",
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
    status: "archived",
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

/**
 * Workspace-wide agent run log fixtures, shaped like the future
 * `/agent/runs` API response consumed by the dashboard run log screens.
 */
export const mockAgentRunLog: AgentRunLogEntry[] = [
  {
    id: "runlog_01",
    projectId: "prj_01",
    projectName: "Coastal Resilience",
    prompt: "Draft the methods section from the latest notebook",
    status: "running",
    actor: actor(mockUsers[0]),
    createdAt: "2026-11-19T11:45:00.000Z",
    startedAt: "2026-11-19T11:45:02.000Z",
    finishedAt: null,
    approval: null,
    summary: null,
    usage: {
      model: "claude-sonnet",
      provider: "anthropic",
      inputTokens: 4200,
      outputTokens: 1850,
      totalTokens: 6050,
      costUsd: 0.0404,
    },
    steps: [
      {
        id: "runlog_01_s1",
        kind: "thought",
        title: "Planned the draft",
        detail: "Read the notebook outline, then write methods.md in three sections.",
        status: "done",
        startedAt: "2026-11-19T11:45:02.000Z",
        durationMs: 1400,
        tokens: 900,
        costUsd: 0.0051,
      },
      {
        id: "runlog_01_s2",
        kind: "tool_call",
        title: "Read analysis.ipynb",
        detail: "Loaded the notebook and extracted headings plus cell outputs.",
        status: "done",
        startedAt: "2026-11-19T11:45:04.000Z",
        durationMs: 900,
        payload: { path: "notebooks/analysis.ipynb", cells: 14 },
        tokens: 2400,
        costUsd: 0.018,
      },
      {
        id: "runlog_01_s3",
        kind: "tool_call",
        title: "Write docs/methods.md",
        detail: "Composing the methods section from the extracted outline…",
        status: "running",
        startedAt: "2026-11-19T11:45:06.000Z",
        payload: { path: "docs/methods.md", sections: ["Study area", "Data", "Analysis"] },
      },
    ],
  },
  {
    id: "runlog_02",
    projectId: "prj_02",
    projectName: "Tide Model Archive",
    prompt: "Prune the 2019 tide gauge export and re-run calibration",
    status: "waiting_approval",
    actor: actor(mockUsers[1]),
    createdAt: "2026-11-19T11:20:00.000Z",
    startedAt: "2026-11-19T11:20:01.000Z",
    finishedAt: null,
    approval: {
      id: "appr_01",
      action: "delete_file",
      summary: "Delete tide-gauge-2019.csv (18 MB) from the archive before re-running calibration.",
      requestedAt: "2026-11-19T11:24:10.000Z",
      status: "pending",
    },
    summary: null,
    usage: {
      model: "gpt-4o-mini",
      provider: "openai",
      inputTokens: 2600,
      outputTokens: 720,
      totalTokens: 3320,
      costUsd: 0.0015,
    },
    steps: [
      {
        id: "runlog_02_s1",
        kind: "thought",
        title: "Planned the prune",
        detail:
          "The 2019 export is superseded by the 2026 survey; removing it unblocks calibration.",
        status: "done",
        startedAt: "2026-11-19T11:20:01.000Z",
        durationMs: 1100,
      },
      {
        id: "runlog_02_s2",
        kind: "tool_call",
        title: "Read calibration.yaml",
        detail: "Checked which inputs the calibration replay expects.",
        status: "done",
        startedAt: "2026-11-19T11:20:03.000Z",
        durationMs: 600,
        payload: { path: "config/calibration.yaml" },
      },
      {
        id: "runlog_02_s3",
        kind: "tool_call",
        title: "Delete tide-gauge-2019.csv",
        detail: "Waiting for approval before deleting the file.",
        status: "pending",
        startedAt: "2026-11-19T11:24:10.000Z",
        payload: { path: "data/tide-gauge-2019.csv", sizeBytes: 18874368 },
      },
    ],
  },
  {
    id: "runlog_03",
    projectId: "prj_01",
    projectName: "Coastal Resilience",
    prompt: "Clean the tidal CSV and summarize missing stations",
    status: "succeeded",
    actor: actor(mockUsers[0]),
    createdAt: "2026-11-19T09:30:00.000Z",
    startedAt: "2026-11-19T09:30:01.000Z",
    finishedAt: "2026-11-19T09:34:00.000Z",
    approval: null,
    summary: "Removed 37 duplicate rows and produced station-missing.csv.",
    usage: {
      model: "gpt-4o",
      provider: "openai",
      inputTokens: 8200,
      outputTokens: 3100,
      totalTokens: 11300,
      costUsd: 0.0515,
    },
    steps: [
      {
        id: "runlog_03_s1",
        kind: "thought",
        title: "Planned the cleanup",
        detail: "Deduplicate on station+timestamp, then diff against the station registry.",
        status: "done",
        startedAt: "2026-11-19T09:30:01.000Z",
        durationMs: 1200,
        tokens: 1100,
        costUsd: 0.0138,
      },
      {
        id: "runlog_03_s2",
        kind: "tool_call",
        title: "Run tidy script",
        detail: "Executed scripts/tidy-tidal.py over tidal-2026.csv.",
        status: "done",
        startedAt: "2026-11-19T09:30:03.000Z",
        durationMs: 182000,
        payload: { script: "scripts/tidy-tidal.py", rowsRemoved: 37 },
        tokens: 7800,
        costUsd: 0.0302,
      },
      {
        id: "runlog_03_s3",
        kind: "result",
        title: "Wrote station-missing.csv",
        detail: "12 stations have gaps longer than 6 hours.",
        status: "done",
        startedAt: "2026-11-19T09:33:30.000Z",
        durationMs: 24000,
        payload: { path: "exports/station-missing.csv", rows: 12 },
        tokens: 2400,
        costUsd: 0.0075,
      },
    ],
  },
  {
    id: "runlog_04",
    projectId: "prj_03",
    projectName: "Field Notes",
    prompt: "Index the scanned field notes by site and date",
    status: "failed",
    actor: actor(mockUsers[2]),
    createdAt: "2026-11-18T16:02:00.000Z",
    startedAt: "2026-11-18T16:02:01.000Z",
    finishedAt: "2026-11-18T16:05:00.000Z",
    approval: null,
    summary: "Stopped because three scans are password-protected PDFs.",
    usage: {
      model: "claude-haiku",
      provider: "anthropic",
      inputTokens: 5100,
      outputTokens: 1460,
      totalTokens: 6560,
      costUsd: 0.0097,
    },
    steps: [
      {
        id: "runlog_04_s1",
        kind: "thought",
        title: "Planned the index",
        detail: "OCR each scan, extract site/date from the header block, write index.csv.",
        status: "done",
        startedAt: "2026-11-18T16:02:01.000Z",
        durationMs: 900,
      },
      {
        id: "runlog_04_s2",
        kind: "tool_call",
        title: "Run OCR batch",
        detail: "ocrmypdf failed on scan-041.pdf — the file requires a password.",
        status: "failed",
        startedAt: "2026-11-18T16:03:00.000Z",
        durationMs: 41000,
        payload: { file: "scans/scan-041.pdf", error: "PDF is encrypted" },
      },
    ],
  },
  {
    id: "runlog_05",
    projectId: "prj_02",
    projectName: "Tide Model Archive",
    prompt: "Regenerate the model card for the 2025 replay",
    status: "cancelled",
    actor: actor(mockUsers[1]),
    createdAt: "2026-11-17T10:12:00.000Z",
    startedAt: "2026-11-17T10:12:01.000Z",
    finishedAt: "2026-11-17T10:13:30.000Z",
    approval: null,
    summary: "Cancelled by Mara Chen before the card was written.",
    usage: {
      model: "gpt-4o-mini",
      provider: "openai",
      inputTokens: 1900,
      outputTokens: 410,
      totalTokens: 2310,
      costUsd: 0.0007,
    },
    steps: [
      {
        id: "runlog_05_s1",
        kind: "thought",
        title: "Planned the card",
        detail: "Collect metrics from the 2025 replay and draft model-card.json.",
        status: "done",
        startedAt: "2026-11-17T10:12:01.000Z",
        durationMs: 800,
      },
      {
        id: "runlog_05_s2",
        kind: "tool_call",
        title: "Read replay metrics",
        detail: "Interrupted while reading metrics/replay-2025.json.",
        status: "cancelled",
        startedAt: "2026-11-17T10:12:40.000Z",
      },
    ],
  },
  {
    id: "runlog_06",
    projectId: "prj_03",
    projectName: "Field Notes",
    prompt: "Move duplicate site photos into _archive/",
    status: "rejected",
    actor: actor(mockUsers[3]),
    createdAt: "2026-11-16T09:40:00.000Z",
    startedAt: "2026-11-16T09:40:01.000Z",
    finishedAt: "2026-11-16T09:41:00.000Z",
    approval: {
      id: "appr_02",
      action: "move_files",
      summary: "Move 6 duplicate photos into _archive/duplicates/.",
      requestedAt: "2026-11-16T09:40:55.000Z",
      status: "rejected",
    },
    summary: "Approval was rejected; no files were moved.",
    usage: {
      model: "gpt-4o-mini",
      provider: "openai",
      inputTokens: 1500,
      outputTokens: 380,
      totalTokens: 1880,
      costUsd: 0.0006,
    },
    steps: [
      {
        id: "runlog_06_s1",
        kind: "tool_call",
        title: "Find duplicate photos",
        detail: "Grouped site photos by content hash; 6 files share a hash with a newer copy.",
        status: "done",
        startedAt: "2026-11-16T09:40:10.000Z",
        durationMs: 22000,
        payload: { duplicates: 6 },
      },
      {
        id: "runlog_06_s2",
        kind: "tool_call",
        title: "Move files to _archive/",
        detail: "Rejected by Bogdan Zogovic; files left in place.",
        status: "cancelled",
        startedAt: "2026-11-16T09:40:55.000Z",
        payload: { target: "_archive/duplicates/", count: 6 },
      },
    ],
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

/**
 * Deterministic daily usage series for the billing period. Requests and
 * tokens are distributed across the 30 days of November 2026 with a fixed
 * weight pattern so the per-day sums match `mockUsageSummary`; cost tracks
 * the same blended per-token rate.
 */
const USAGE_PERIOD_DAYS = 30
const USAGE_COMPARISON_DAYS = 31 // October 2026

/**
 * Largest-remainder split of an integer total across arbitrary weights, so
 * the per-part sums always equal `total` exactly.
 */
function distributeByWeights(total: number, weights: number[]): number[] {
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0)
  const exact = weights.map((weight) => (weight / weightSum) * total)
  const parts = exact.map(Math.floor)
  let remainder = total - parts.reduce((sum, value) => sum + value, 0)
  const byFraction = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction)
  for (const { index } of byFraction) {
    if (remainder <= 0) break
    parts[index] += 1
    remainder -= 1
  }
  return parts
}

function distributeAcrossDays(
  total: number,
  seedOffset: number,
  dayCount = USAGE_PERIOD_DAYS,
): number[] {
  const weights = Array.from(
    { length: dayCount },
    (_, index) =>
      1 + 0.45 * Math.sin(index * 1.7 + seedOffset) + 0.2 * Math.sin(index * 0.9 + seedOffset * 2),
  )
  return distributeByWeights(total, weights)
}

const mockUsageRequestsByDay = distributeAcrossDays(1284, 0.4)
const mockUsageTokensByDay = distributeAcrossDays(412_030, 1.9)
const mockUsageCostPerToken = 3.87 / 412_030

/**
 * Per-project share of the billing period, aligned with `mockProjects`
 * order: the archived archive project gets the smallest slice. Requests,
 * tokens, and cost (in micro-dollars) are split with the same largest-
 * remainder helper so each metric's per-project sums match
 * `mockUsageSummary` exactly.
 */
const mockUsageProjectWeights = [0.5, 0.2, 0.3]
const mockUsageRequestsByProject = distributeByWeights(1284, mockUsageProjectWeights)
const mockUsageTokensByProject = distributeByWeights(412_030, mockUsageProjectWeights)
const mockUsageCostMicrosByProject = distributeByWeights(3_870_000, mockUsageProjectWeights)

/**
 * Deterministic daily usage series for the previous billing period (October
 * 2026, 31 days), surfaced as `mockUsageSummary.comparison` for the
 * month-over-month view. Same weight pattern as the current period.
 */
const mockUsageComparisonRequestsByDay = distributeAcrossDays(1102, 2.6, USAGE_COMPARISON_DAYS)
const mockUsageComparisonTokensByDay = distributeAcrossDays(351_480, 3.4, USAGE_COMPARISON_DAYS)
const mockUsageComparisonCostPerToken = 3.31 / 351_480

export const mockUsageComparison: UsageComparison = {
  periodStart: "2026-10-01T00:00:00.000Z",
  periodEnd: "2026-10-31T23:59:59.000Z",
  requests: 1102,
  tokens: 351_480,
  costUsd: 3.31,
  daily: mockUsageComparisonRequestsByDay.map((requests, index) => {
    const day = String(index + 1).padStart(2, "0")
    const tokens = mockUsageComparisonTokensByDay[index]
    return {
      date: `2026-10-${day}T00:00:00.000Z`,
      requests,
      tokens,
      costUsd: Math.round(tokens * mockUsageComparisonCostPerToken * 1e6) / 1e6,
    }
  }),
}

export const mockUsageSummary: UsageSummary = {
  periodStart: "2026-11-01T00:00:00.000Z",
  periodEnd: "2026-11-30T23:59:59.000Z",
  requests: 1284,
  tokens: 412_030,
  costUsd: 3.87,
  daily: mockUsageRequestsByDay.map((requests, index) => {
    const day = String(index + 1).padStart(2, "0")
    const tokens = mockUsageTokensByDay[index]
    return {
      date: `2026-11-${day}T00:00:00.000Z`,
      requests,
      tokens,
      costUsd: Math.round(tokens * mockUsageCostPerToken * 1e6) / 1e6,
    }
  }),
  projects: mockProjects.map((project, index) => ({
    projectId: project.id,
    projectName: project.name,
    requests: mockUsageRequestsByProject[index],
    tokens: mockUsageTokensByProject[index],
    costUsd: mockUsageCostMicrosByProject[index] / 1e6,
  })),
  comparison: mockUsageComparison,
}
