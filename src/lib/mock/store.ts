/**
 * Session-scoped mock store for the post-login project screens.
 *
 * State is deterministic seed data held in memory only: client-side navigation
 * preserves mutations, while a full reload resets every screen back to the
 * seed. No network, upload, container, or model calls are made here.
 */
import type {
  AgentConfig,
  AgentDiff,
  AgentQuota,
  AgentRunState,
  AgentWorkspaceRun,
  ChannelMessage,
  ChatAttachment,
  ChatChannel,
  ChatChannelKind,
  ChatMember,
  ChatTyping,
  FileGitStatus,
  FileKind,
  FileNode,
  FileUpload,
  FileVersion,
  LabEnvironment,
  LabEnvironmentKind,
  LabEnvironmentStatus,
  RejectedUpload,
  UploadFileInput,
  WorkspaceProject,
} from "../api/types"
import {
  DEFAULT_AGENT_CONFIG,
  agentRequestsRemaining,
  projectDisplayName,
} from "../api/workspace-utils"
import type { ProjectTemplate } from "../project-templates"
import { mockNow, mockProjects } from "./index"

// The store keeps its original names as aliases for the shared API types.
export type ChatMessage = ChannelMessage
export type AgentRun = AgentWorkspaceRun
export type AgentRunStatus = AgentRunState
export type LabSessionStatus = LabEnvironmentStatus
export type MockProject = WorkspaceProject

export type MockState = {
  project: MockProject
  sequence: number
  files: FileNode[]
  uploads: FileUpload[]
  chat: {
    activeChannelId: string
    anonymous: boolean
    /** Whether the mock chat bot answers @mentions and slash commands. */
    botEnabled: boolean
    channels: ChatChannel[]
    messages: ChatMessage[]
    members: ChatMember[]
    typing: ChatTyping[]
    /** ISO timestamp of the reader's last visit per channel, for unread counts. */
    lastReadAt: Record<string, string>
  }
  lab: {
    activeEnvironmentId: string
    environments: LabEnvironment[]
  }
  agent: {
    quota: AgentQuota
    config: AgentConfig
    activeRunId: string | null
    runs: AgentRun[]
  }
}

export const STORAGE_LIMIT_BYTES = 5 * 1024 * 1024 * 1024
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024
export const AGENT_QUOTA_LIMIT = 70

export const CURRENT_USER = {
  id: "user-bogdan",
  name: "You",
  anonymousName: "Anonymous surveyor",
}

// Mock chat bot: answers slash commands and @mentions in place of a human
// member. The `bot` flag on its member/message/typing entries marks it for
// distinct rendering in the chat UI.
export const CHAT_BOT = { id: "bot-spindle", name: "Spindle Bot" } as const

// Placeholder authors for the demo auto-reply; replace with real members when
// the chat backend exists.
const CHAT_REPLY_MEMBERS = [
  { id: "user-mara", name: "Mara" },
  { id: "user-theo", name: "Theo" },
  { id: "user-jules", name: "Jules" },
] as const

// Tiny deterministic SVG used as `previewUrl` for image files so the preview
// drawer renders a real <img> instead of its placeholder. Kept inline (rather
// than referencing public/) so uploaded mock images get the same treatment.
const MOCK_IMAGE_PREVIEW_URL =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200"><rect width="320" height="200" fill="#1b2430"/><circle cx="160" cy="100" r="48" fill="#4f8cff"/><path d="M40 150 L130 70 L180 130 L220 90 L280 150 Z" fill="#2f9e6e"/></svg>',
  )

// Public changelog demo used as `previewUrl` for video files; there is no
// mock PDF or audio asset yet, so those fall back to the drawer's unsupported
// card until real file storage exists.
const MOCK_VIDEO_PREVIEW_URL = "/assets/changelog/demo.mp4"

const CHAT_AUTO_REPLY_BODY = "Noted — I'll take a look and follow up here."

// The typing entry is cleared this many ms before the canned reply lands so
// intermediate snapshots show a realistic "stopped typing" gap.
const CHAT_TYPING_LEAD_MS = 300

// Placeholder presence roster for the chat screen; replace with workspace
// members once the real chat backend exists.
const CHAT_MEMBERS: ChatMember[] = [
  { id: CURRENT_USER.id, name: CURRENT_USER.name, online: true },
  { id: CHAT_BOT.id, name: CHAT_BOT.name, online: true, bot: true },
  { id: "user-mara", name: "Mara", online: true },
  { id: "user-theo", name: "Theo", online: true },
  { id: "user-jules", name: "Jules", online: false },
  { id: "user-ana", name: "Ana", online: true },
]

function seedFiles(): FileNode[] {
  const node = (
    id: string,
    name: string,
    kind: FileKind,
    parentId: string | null,
    mimeType: string,
    sizeBytes: number,
    owner: string,
    updatedAt: string,
    content?: string,
    previewUrl?: string,
    versions?: FileVersion[],
  ): FileNode => ({
    id,
    name,
    kind,
    parentId,
    mimeType,
    sizeBytes,
    owner,
    updatedAt,
    content,
    previewUrl,
    versions,
  })

  const files = [
    node(
      "folder-data",
      "data",
      "folder",
      null,
      "inode/directory",
      0,
      "Mara",
      "2026-11-18T16:20:00.000Z",
    ),
    node(
      "folder-notebooks",
      "notebooks",
      "folder",
      null,
      "inode/directory",
      0,
      "Theo",
      "2026-11-18T15:10:00.000Z",
    ),
    node(
      "folder-outputs",
      "outputs",
      "folder",
      null,
      "inode/directory",
      0,
      "Jules",
      "2026-11-17T18:44:00.000Z",
    ),
    node(
      "folder-archive",
      "archive",
      "folder",
      null,
      "inode/directory",
      0,
      "Mara",
      "2026-11-16T09:02:00.000Z",
    ),
    node(
      "file-tidal",
      "tidal-2026.csv",
      "file",
      "folder-data",
      "text/csv",
      2_418_304,
      "Mara",
      "2026-11-19T08:42:00.000Z",
      // Preview excerpt of the full export; earlier snapshots live in `versions`.
      "site,salinity,turbidity\nA-01,28.4,4.2\nA-02,27.9,3.8\nB-04,31.2,5.1\nB-07,29.6,4.4\nC-02,30.1,4.9\nC-05,27.4,3.5",
      undefined,
      [
        {
          id: "ver-tidal-v1",
          label: "v1",
          createdAt: "2026-11-17T10:05:00.000Z",
          author: "Mara",
          sizeBytes: 1_204_800,
          // First export covered only the two A transect sites.
          content: "site,salinity,turbidity\nA-01,28.4,4.2\nA-02,27.9,3.8",
        },
        {
          id: "ver-tidal-v2",
          label: "v2",
          createdAt: "2026-11-18T14:30:00.000Z",
          author: "Mara",
          sizeBytes: 2_097_152,
          // B transect added; C transect not yet surveyed.
          content:
            "site,salinity,turbidity\nA-01,28.4,4.2\nA-02,27.9,3.8\nB-04,31.2,5.1\nB-07,29.6,4.4",
        },
      ],
    ),
    node(
      "file-survey",
      "survey.parquet",
      "file",
      "folder-data",
      "application/vnd.apache.parquet",
      18_874_368,
      "Theo",
      "2026-11-19T07:58:00.000Z",
    ),
    node(
      "file-sites",
      "sites.geojson",
      "file",
      "folder-data",
      "application/geo+json",
      640_128,
      "Jules",
      "2026-11-18T19:31:00.000Z",
      // Excerpt: the live file also carries B-transect and survey-metadata features.
      '{\n  "type": "FeatureCollection",\n  "features": [\n    {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-71.06, 42.36]}, "properties": {"site": "A-01"}},\n    {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-71.12, 42.31]}, "properties": {"site": "B-04"}}\n  ]\n}',
      undefined,
      [
        {
          id: "ver-sites-v1",
          label: "v1",
          createdAt: "2026-11-16T11:20:00.000Z",
          author: "Jules",
          sizeBytes: 512_000,
          // Draft export with only the first surveyed site.
          content:
            '{\n  "type": "FeatureCollection",\n  "features": [\n    {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-71.06, 42.36]}, "properties": {"site": "A-01"}}\n  ]\n}',
        },
      ],
    ),
    node(
      "file-analysis",
      "analysis.ipynb",
      "file",
      "folder-notebooks",
      "application/x-ipynb+json",
      84_220,
      "You",
      "2026-11-19T09:12:00.000Z",
      // Excerpt of the notebook JSON; cell outputs are stripped in the preview.
      '{\n  "cells": [\n    {"cell_type": "markdown", "source": ["# Tidal analysis", "Salinity vs. turbidity across transects."]},\n    {"cell_type": "code", "source": ["import pandas as pd", "df = pd.read_csv(\'data/tidal-2026.csv\')"], "outputs": []}\n  ],\n  "metadata": {"kernelspec": {"name": "python3"}}\n}',
      undefined,
      [
        {
          id: "ver-analysis-v1",
          label: "v1",
          createdAt: "2026-11-18T08:15:00.000Z",
          author: "You",
          sizeBytes: 76_000,
          // Outline-only draft before the analysis cells were added.
          content:
            '{\n  "cells": [{"cell_type": "markdown", "source": ["# Tidal analysis"]}],\n  "metadata": {"kernelspec": {"name": "python3"}}\n}',
        },
      ],
    ),
    node(
      "file-field-notes",
      "field-notes.md",
      "file",
      "folder-notebooks",
      "text/markdown",
      12_904,
      "Mara",
      "2026-11-19T09:21:00.000Z",
      "# Field notes\n\nTransect 04 is ready for the next pass.",
      undefined,
      [
        {
          id: "ver-field-notes-v1",
          label: "v1",
          createdAt: "2026-11-17T16:40:00.000Z",
          author: "Mara",
          sizeBytes: 9_800,
          // Rough first draft: plan only, no readings yet.
          content:
            "# Field notes\n\n## Transect 04\n\nScheduled for next week. Confirm gauge calibration before departure.",
        },
        {
          id: "ver-field-notes-v2",
          label: "v2",
          createdAt: "2026-11-18T09:05:00.000Z",
          author: "Mara",
          sizeBytes: 11_500,
          // Equipment checked; site list still pending Theo's count.
          content:
            "# Field notes\n\n## Transect 04\n\nEquipment checked — salinity probe swapped, gauge calibrated. Waiting on final site count.",
        },
      ],
    ),
    node(
      "file-figure",
      "recovery-map.png",
      "file",
      "folder-outputs",
      "image/png",
      1_204_736,
      "Jules",
      "2026-11-18T17:05:00.000Z",
      undefined,
      MOCK_IMAGE_PREVIEW_URL,
    ),
    node(
      "file-export",
      "export_final_v3.csv",
      "file",
      "folder-archive",
      "text/csv",
      941_056,
      "Theo",
      "2026-11-15T13:47:00.000Z",
      // Excerpt of the deduplicated export; earlier snapshots live in `versions`.
      "site,value\nA-01,1\nA-02,2\nB-04,3\nC-02,4",
      undefined,
      [
        {
          id: "ver-export-v1",
          label: "v1",
          createdAt: "2026-11-14T10:00:00.000Z",
          author: "Theo",
          sizeBytes: 640_000,
          // First pass before the B/C transect rows were merged in.
          content: "site,value\nA-01,1\nA-02,2",
        },
      ],
    ),
  ]
  files.forEach((file) => {
    const status = MOCK_FILE_GIT_STATUS[file.id]
    if (status) file.gitStatus = status
  })
  return files
}

/**
 * Deterministic mock VCS decorations seeded onto `FileNode.gitStatus`.
 * Covers every status kind so the files screen badges exercise the full
 * palette; folders aggregate their descendants' statuses at render time.
 */
const MOCK_FILE_GIT_STATUS: Record<string, FileGitStatus> = {
  "file-tidal": "modified",
  "file-survey": "conflicted",
  "file-sites": "modified",
  "file-analysis": "added",
  "file-field-notes": "modified",
  "file-figure": "untracked",
  "file-export": "renamed",
}

function seedChat(): MockState["chat"] {
  return {
    activeChannelId: "channel-field-notes",
    anonymous: false,
    botEnabled: true,
    members: CHAT_MEMBERS.map((member) => ({ ...member })),
    typing: [],
    // "field-notes" is fully read; the other seeded threads have unread mail.
    lastReadAt: {
      "channel-field-notes": "2026-11-19T09:21:00.000Z",
      "channel-data-cleaning": "2026-11-19T08:00:00.000Z",
      "channel-writing": "",
    },
    channels: [
      { id: "channel-field-notes", name: "field-notes", kind: "channel", memberCount: 8 },
      { id: "channel-data-cleaning", name: "data-cleaning", kind: "channel", memberCount: 5 },
      { id: "channel-writing", name: "writing", kind: "channel", memberCount: 4 },
      { id: "channel-random", name: "random", kind: "channel", memberCount: 8 },
      { id: "dm-mara", name: "Mara", kind: "dm", memberCount: 2 },
      { id: "dm-theo", name: "Theo", kind: "dm", memberCount: 2 },
    ],
    messages: [
      {
        id: "msg-1",
        channelId: "channel-field-notes",
        authorId: "user-mara",
        authorName: "Mara",
        anonymous: false,
        body: "New survey batch is in /data. The viewer detected it as Parquet right away.",
        createdAt: "2026-11-19T09:14:00.000Z",
        status: "sent",
        reactions: [
          { emoji: "🎉", userIds: ["user-mara", "user-theo"] },
          { emoji: "👍", userIds: ["user-jules"] },
        ],
      },
      {
        id: "msg-2",
        channelId: "channel-field-notes",
        authorId: "user-theo",
        authorName: "Theo",
        anonymous: false,
        body: "Nice. I kicked off the cron refresh and the lab still has the kernel from yesterday.",
        createdAt: "2026-11-19T09:18:00.000Z",
        status: "sent",
      },
      {
        id: "msg-3",
        channelId: "channel-field-notes",
        authorId: "user-jules",
        authorName: "Jules",
        anonymous: false,
        body: "Adding the site IDs to the shared note now.",
        createdAt: "2026-11-19T09:21:00.000Z",
        status: "sent",
        mentions: [{ id: "user-mara", name: "Mara" }],
      },
      {
        id: "msg-4",
        channelId: "channel-data-cleaning",
        authorId: "user-theo",
        authorName: "Theo",
        anonymous: false,
        body: "The duplicate export rows are isolated in archive/export_final_v3.csv.",
        createdAt: "2026-11-19T08:40:00.000Z",
        status: "sent",
      },
      {
        id: "msg-5",
        channelId: "channel-writing",
        authorId: "user-mara",
        authorName: "Mara",
        anonymous: false,
        body: "Methods section is drafted; waiting on the final site count.",
        createdAt: "2026-11-18T18:10:00.000Z",
        status: "sent",
      },
      {
        // Own message that never made it out; powers the chat screen's
        // "Failed · Retry" affordance and the retryChannelMessage path.
        id: "msg-6",
        channelId: "channel-data-cleaning",
        authorId: CURRENT_USER.id,
        authorName: CURRENT_USER.name,
        anonymous: false,
        body: "Did the dedupe pass finish? I can't see the summary row.",
        createdAt: "2026-11-19T09:05:00.000Z",
        status: "failed",
      },
    ],
  }
}

function seedLab(): MockState["lab"] {
  return {
    activeEnvironmentId: "lab-rstudio",
    environments: [
      {
        id: "lab-rstudio",
        name: "RStudio",
        kind: "rstudio",
        status: "running",
        title: "coastal-resilience / analysis.R",
        statusLabel: "Kernel idle",
        lastActiveAt: "2026-11-19T09:20:00.000Z",
      },
      {
        id: "lab-jupyter",
        name: "JupyterLab",
        kind: "jupyter",
        status: "stopped",
        title: "coastal-resilience / analysis.ipynb",
        statusLabel: "Python 3.12 · stopped",
        lastActiveAt: null,
      },
      {
        id: "lab-vscode",
        name: "VS Code",
        kind: "vscode",
        status: "stopped",
        title: "coastal-resilience / clean_data.py",
        statusLabel: "Workspace stopped",
        lastActiveAt: null,
      },
      {
        id: "lab-terminal",
        name: "Terminal",
        kind: "terminal",
        status: "stopped",
        title: "coastal-resilience — zsh",
        statusLabel: "Shell stopped",
        lastActiveAt: null,
      },
    ],
  }
}

function seedAgent(): MockState["agent"] {
  return {
    quota: { dailyLimit: 20, bonus: 50, used: 14 },
    config: { ...DEFAULT_AGENT_CONFIG },
    activeRunId: null,
    runs: [],
  }
}

/* -------------------------------------------------------------------------- */
/* Project template seeds                                                     */
/*                                                                            */
/* Projects created through the new-project wizard carry a template; its      */
/* starter folders/files, chat threads, and lab environments replace the      */
/* rich demo seed so each template produces a recognisable workspace.         */
/* -------------------------------------------------------------------------- */

const TEMPLATE_LAB_ENVIRONMENT_NAMES: Record<LabEnvironmentKind, string> = {
  rstudio: "RStudio",
  jupyter: "JupyterLab",
  vscode: "VS Code",
  terminal: "Terminal",
}

const ALL_LAB_ENVIRONMENT_KINDS: LabEnvironmentKind[] = ["rstudio", "jupyter", "vscode", "terminal"]

function templateMimeType(name: string) {
  const lower = name.toLowerCase()
  if (lower.endsWith(".geojson")) return "application/geo+json"
  if (lower.endsWith(".ipynb")) return "application/x-ipynb+json"
  if (lower.endsWith(".json")) return "application/json"
  if (lower.endsWith(".md")) return "text/markdown"
  if (lower.endsWith(".csv")) return "text/csv"
  if (lower.endsWith(".txt")) return "text/plain"
  return "application/octet-stream"
}

function seedTemplateFiles(template: ProjectTemplate): FileNode[] {
  const nodes: FileNode[] = []
  const folderIds = new Map<string, string>()
  let sequence = 0

  const ensureFolder = (path: string, parentId: string | null): string => {
    const cached = folderIds.get(path)
    if (cached) return cached
    sequence += 1
    const id = `tpl-folder-${sequence}`
    folderIds.set(path, id)
    nodes.push({
      id,
      name: path.split("/").pop() ?? path,
      kind: "folder",
      parentId,
      mimeType: "inode/directory",
      sizeBytes: 0,
      owner: CURRENT_USER.name,
      updatedAt: mockNow,
    })
    return id
  }

  template.folders.forEach((name) => ensureFolder(name, null))

  template.files.forEach((file) => {
    const segments = file.path.split("/").filter(Boolean)
    const name = segments.pop()
    if (!name) return
    let parentId: string | null = null
    let prefix = ""
    for (const segment of segments) {
      prefix = prefix ? `${prefix}/${segment}` : segment
      parentId = ensureFolder(prefix, parentId)
    }
    sequence += 1
    nodes.push({
      id: `tpl-file-${sequence}`,
      name,
      kind: "file",
      parentId,
      mimeType: file.mimeType ?? templateMimeType(name),
      sizeBytes: file.sizeBytes ?? (file.content ? file.content.length : 0),
      owner: CURRENT_USER.name,
      updatedAt: mockNow,
      content: file.content,
    })
  })

  return nodes
}

function seedTemplateChat(template: ProjectTemplate): MockState["chat"] {
  const names = template.channels.length > 0 ? template.channels : ["general"]
  const memberCount = CHAT_MEMBERS.filter((member) => member.online).length
  const channels: ChatChannel[] = names.map((name, index) => ({
    id: `channel-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || `thread-${index}`}`,
    name,
    kind: "channel",
    memberCount,
  }))
  return {
    activeChannelId: channels[0].id,
    anonymous: false,
    botEnabled: true,
    channels,
    messages: [],
    members: CHAT_MEMBERS.map((member) => ({ ...member })),
    typing: [],
    lastReadAt: {},
  }
}

function seedTemplateLab(template: ProjectTemplate): MockState["lab"] {
  const kinds =
    template.labEnvironments && template.labEnvironments.length > 0
      ? template.labEnvironments
      : ALL_LAB_ENVIRONMENT_KINDS
  const environments: LabEnvironment[] = kinds.map((kind) => ({
    id: `lab-${kind}`,
    name: TEMPLATE_LAB_ENVIRONMENT_NAMES[kind],
    kind,
    status: "stopped",
    title: `${template.label} workspace`,
    statusLabel: `${TEMPLATE_LAB_ENVIRONMENT_NAMES[kind]} stopped`,
    lastActiveAt: null,
  }))
  return {
    activeEnvironmentId: environments[0]?.id ?? "lab-rstudio",
    environments,
  }
}

export function createSeedState(projectId: string, template?: ProjectTemplate | null): MockState {
  const projectName =
    mockProjects.find((project) => project.id === projectId || project.slug === projectId)?.name ??
    projectDisplayName(projectId)
  return {
    project: {
      id: projectId,
      name: projectName,
      owner: CURRENT_USER.name,
      storageLimitBytes: STORAGE_LIMIT_BYTES,
    },
    sequence: 100,
    files: template ? seedTemplateFiles(template) : seedFiles(),
    uploads: [],
    chat: template ? seedTemplateChat(template) : seedChat(),
    lab: template ? seedTemplateLab(template) : seedLab(),
    agent: seedAgent(),
  }
}

export type MutationResult = { ok: true } | { ok: false; error: string }
export type CreateResult = { ok: true; id: string } | { ok: false; error: string }
export type UploadBatchResult = {
  accepted: string[]
  rejected: RejectedUpload[]
}

export class MockStore {
  private state: MockState
  private listeners = new Set<() => void>()
  /**
   * Anchor for the mock clock (Option B): `now()` returns `mockNow` plus the
   * real elapsed time since the store was constructed, so mutations made
   * after the 2026-11-19 seeds still sort and count as unread correctly.
   */
  private readonly startedAt = Date.now()

  /**
   * `initialState` lets the adapter hydrate a store from an existing one —
   * used when a project is cloned so the copy keeps the source's file tree,
   * chat threads, and lab environments instead of reseeding from scratch.
   */
  constructor(projectId: string, template?: ProjectTemplate | null, initialState?: MockState) {
    this.state = initialState ? structuredClone(initialState) : createSeedState(projectId, template)
  }

  getState() {
    return this.state
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private commit(mutator: (state: MockState) => void) {
    const next = structuredClone(this.state)
    mutator(next)
    this.state = next
    this.listeners.forEach((listener) => listener())
  }

  private nextId(state: MockState, prefix: string) {
    state.sequence += 1
    return `${prefix}-${state.sequence}`
  }

  private now() {
    const mockEpoch = Date.parse(mockNow)
    return new Date(mockEpoch + (Date.now() - this.startedAt)).toISOString()
  }

  private findNode(id: string) {
    return this.state.files.find((node) => node.id === id) ?? null
  }

  private isFolder(node: FileNode | null | undefined): node is FileNode {
    return node?.kind === "folder"
  }

  private siblingConflict(
    state: MockState,
    parentId: string | null,
    name: string,
    excludeId?: string,
  ) {
    const normalized = name.trim().toLowerCase()
    return state.files.some(
      (node) =>
        node.id !== excludeId &&
        node.parentId === parentId &&
        node.name.trim().toLowerCase() === normalized,
    )
  }

  private isDescendant(state: MockState, ancestorId: string, nodeId: string) {
    let current = state.files.find((node) => node.id === nodeId)
    while (current?.parentId) {
      if (current.parentId === ancestorId) return true
      current = state.files.find((node) => node.id === current?.parentId)
    }
    return false
  }

  private descendantIds(state: MockState, id: string) {
    const ids = new Set<string>([id])
    let changed = true
    while (changed) {
      changed = false
      state.files.forEach((node) => {
        if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) {
          ids.add(node.id)
          changed = true
        }
      })
    }
    return ids
  }

  getChildren(parentId: string | null) {
    return this.state.files
      .filter((node) => node.parentId === parentId)
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  getFolderByPath(segments: string[]) {
    let parentId: string | null = null
    let folder: FileNode | null = null
    for (const segment of segments) {
      folder =
        this.state.files.find(
          (node) => node.parentId === parentId && node.kind === "folder" && node.name === segment,
        ) ?? null
      if (!folder) return null
      parentId = folder.id
    }
    return (
      folder ??
      ({
        id: "root",
        name: "Files",
        kind: "folder",
        parentId: null,
        mimeType: "",
        sizeBytes: 0,
        owner: "",
        updatedAt: "",
      } as FileNode)
    )
  }

  getNodePath(node: FileNode) {
    const parts = [node.name]
    let current = node
    while (current.parentId) {
      const parent = this.state.files.find((candidate) => candidate.id === current.parentId)
      if (!parent) break
      parts.unshift(parent.name)
      current = parent
    }
    return parts
  }

  getStorageUsage() {
    const usedBytes = this.state.files
      .filter((node) => node.kind === "file")
      .reduce((total, node) => total + node.sizeBytes, 0)
    return { usedBytes, limitBytes: this.state.project.storageLimitBytes }
  }

  createFolder(parentId: string | null, name: string): CreateResult {
    const cleanName = name.trim()
    if (!cleanName) return { ok: false, error: "Folder name is required." }
    if (cleanName.includes("/") || cleanName.includes("\\")) {
      return { ok: false, error: "Folder names cannot contain slashes." }
    }
    if (cleanName.length > 80)
      return { ok: false, error: "Folder name must be 80 characters or fewer." }

    let id = ""
    this.commit((state) => {
      const parent = parentId ? (state.files.find((node) => node.id === parentId) ?? null) : null
      if (parentId && !this.isFolder(parent)) {
        id = ""
        return
      }
      if (this.siblingConflict(state, parentId, cleanName)) {
        id = ""
        return
      }
      id = this.nextId(state, "folder")
      state.files.push({
        id,
        name: cleanName,
        kind: "folder",
        parentId,
        mimeType: "inode/directory",
        sizeBytes: 0,
        owner: CURRENT_USER.name,
        updatedAt: this.now(),
        // Mock VCS: anything created after seeding starts out untracked.
        gitStatus: "untracked",
      })
    })

    if (!id) {
      const parent = parentId ? this.findNode(parentId) : null
      if (parentId && !this.isFolder(parent)) return { ok: false, error: "Choose a valid folder." }
      return { ok: false, error: "A file or folder with that name already exists here." }
    }
    return { ok: true, id }
  }

  renameNode(id: string, name: string): MutationResult {
    const cleanName = name.trim()
    const node = this.findNode(id)
    if (!node) return { ok: false, error: "Item no longer exists." }
    if (!cleanName) return { ok: false, error: "Name is required." }
    if (cleanName.includes("/") || cleanName.includes("\\")) {
      return { ok: false, error: "Names cannot contain slashes." }
    }
    if (cleanName.length > 120) return { ok: false, error: "Name must be 120 characters or fewer." }

    let error = ""
    this.commit((state) => {
      const current = state.files.find((candidate) => candidate.id === id)
      if (!current) {
        error = "Item no longer exists."
        return
      }
      if (this.siblingConflict(state, current.parentId, cleanName, id)) {
        error = "A file or folder with that name already exists here."
        return
      }
      current.name = cleanName
      current.updatedAt = this.now()
      // Mock VCS: a rename on a clean node reads as a git rename; an already
      // dirty node keeps its stronger status.
      current.gitStatus ??= "renamed"
    })
    return error ? { ok: false, error } : { ok: true }
  }

  moveNode(id: string, targetFolderId: string | null): MutationResult {
    const node = this.findNode(id)
    const target = targetFolderId ? this.findNode(targetFolderId) : null
    if (!node) return { ok: false, error: "Item no longer exists." }
    if (targetFolderId && !this.isFolder(target))
      return { ok: false, error: "Choose a valid destination folder." }
    if (targetFolderId && node.id === target?.id)
      return { ok: false, error: "An item cannot be moved into itself." }
    if (
      node.kind === "folder" &&
      targetFolderId &&
      this.isDescendant(this.state, node.id, targetFolderId)
    ) {
      return { ok: false, error: "A folder cannot be moved into its own descendant." }
    }

    let error = ""
    this.commit((state) => {
      const current = state.files.find((candidate) => candidate.id === id)
      const destination = targetFolderId
        ? (state.files.find((candidate) => candidate.id === targetFolderId) ?? null)
        : null
      if (!current || (targetFolderId && !this.isFolder(destination))) {
        error = "Item no longer exists."
        return
      }
      if (this.siblingConflict(state, targetFolderId, current.name, current.id)) {
        error = "A file or folder with that name already exists in the destination."
        return
      }
      current.parentId = targetFolderId
      current.updatedAt = this.now()
    })
    return error ? { ok: false, error } : { ok: true }
  }

  /**
   * Atomic batch move: every id is validated against the pre-move tree first,
   * so a single bad entry rejects the whole selection instead of leaving a
   * half-applied batch behind.
   */
  moveNodes(ids: string[], targetFolderId: string | null): MutationResult {
    const uniqueIds = [...new Set(ids)]
    if (uniqueIds.length === 0) return { ok: false, error: "No items selected." }
    if (targetFolderId && !this.isFolder(this.findNode(targetFolderId))) {
      return { ok: false, error: "Choose a valid destination folder." }
    }

    const moving = new Set<string>()
    for (const id of uniqueIds) {
      const node = this.findNode(id)
      if (!node) return { ok: false, error: "Item no longer exists." }
      if (id === targetFolderId) {
        return { ok: false, error: "An item cannot be moved into itself." }
      }
      if (
        node.kind === "folder" &&
        targetFolderId &&
        this.isDescendant(this.state, node.id, targetFolderId)
      ) {
        return { ok: false, error: "A folder cannot be moved into its own descendant." }
      }
      moving.add(id)
    }

    // Names already taken at the destination, ignoring the nodes being moved.
    const reservedNames = new Set(
      this.state.files
        .filter((node) => node.parentId === targetFolderId && !moving.has(node.id))
        .map((node) => node.name.trim().toLowerCase()),
    )
    for (const id of uniqueIds) {
      const node = this.state.files.find((candidate) => candidate.id === id)
      if (!node) return { ok: false, error: "Item no longer exists." }
      const normalized = node.name.trim().toLowerCase()
      if (reservedNames.has(normalized)) {
        return {
          ok: false,
          error: "A file or folder with that name already exists in the destination.",
        }
      }
      // Also catches two selected nodes colliding with each other.
      reservedNames.add(normalized)
    }

    this.commit((state) => {
      const stamp = this.now()
      state.files.forEach((node) => {
        if (moving.has(node.id)) {
          node.parentId = targetFolderId
          node.updatedAt = stamp
        }
      })
    })
    return { ok: true }
  }

  /**
   * Restore a historical version as the file's current content. The outgoing
   * content is appended to `versions` first (labelled with the next `vN`) so
   * the restore itself stays recoverable. Versions without an inline
   * snapshot cannot be restored.
   */
  restoreVersion(id: string, versionId: string): MutationResult {
    const node = this.findNode(id)
    if (!node) return { ok: false, error: "Item no longer exists." }
    if (node.kind !== "file") return { ok: false, error: "Only files have version history." }
    const version = node.versions?.find((candidate) => candidate.id === versionId)
    if (!version) return { ok: false, error: "Version no longer exists." }
    if (version.content === undefined) {
      return { ok: false, error: "This version has no stored snapshot to restore." }
    }

    let error = ""
    this.commit((state) => {
      const current = state.files.find((candidate) => candidate.id === id)
      const target = current?.versions?.find((candidate) => candidate.id === versionId)
      if (!current || current.kind !== "file" || !target || target.content === undefined) {
        error = "Version no longer exists."
        return
      }
      const history = [...(current.versions ?? [])]
      const highest = history.reduce((max, entry) => {
        const match = /^v(\d+)$/.exec(entry.label)
        return match ? Math.max(max, Number.parseInt(match[1], 10)) : max
      }, 0)
      history.push({
        id: this.nextId(state, "ver"),
        label: `v${highest + 1}`,
        createdAt: this.now(),
        author: CURRENT_USER.name,
        sizeBytes: current.sizeBytes,
        content: current.content,
      })
      current.versions = history
      current.content = target.content
      current.sizeBytes = target.sizeBytes ?? current.sizeBytes
      current.updatedAt = this.now()
      // Mock VCS: a content restore reads as a modification on a clean node.
      current.gitStatus ??= "modified"
    })
    return error ? { ok: false, error } : { ok: true }
  }

  trashNodes(ids: string[]): { ok: true; count: number } | { ok: false; error: string } {
    const uniqueIds = [...new Set(ids)].filter((id) => this.findNode(id))
    if (uniqueIds.length === 0) return { ok: false, error: "No selected items remain." }
    let count = 0
    this.commit((state) => {
      const remove = new Set<string>()
      uniqueIds.forEach((id) => {
        if (state.files.some((node) => node.id === id)) {
          this.descendantIds(state, id).forEach((descendantId) => remove.add(descendantId))
        }
      })
      count = remove.size
      state.files = state.files.filter((node) => !remove.has(node.id))
      // Drop uploads that belong to any removed node — including uploads
      // parked inside a descendant folder that was trashed along the way.
      state.uploads = state.uploads.filter(
        (upload) => upload.parentId === null || !remove.has(upload.parentId),
      )
    })
    return { ok: true, count }
  }

  addUploads(parentId: string | null, inputs: UploadFileInput[]): UploadBatchResult {
    const parent = parentId ? this.findNode(parentId) : null
    if (parentId && !this.isFolder(parent)) {
      return {
        accepted: [],
        rejected: inputs.map((input) => ({
          ...input,
          error: "Choose a valid destination folder.",
        })),
      }
    }

    const accepted: string[] = []
    const rejected: RejectedUpload[] = []
    this.commit((state) => {
      const reservedNames = new Set(
        state.files
          .filter((node) => node.parentId === parentId)
          .map((node) => node.name.toLowerCase()),
      )
      state.uploads
        .filter(
          (upload) =>
            upload.parentId === parentId && upload.status !== "done" && upload.status !== "failed",
        )
        .forEach((upload) => reservedNames.add(upload.name.toLowerCase()))

      inputs.forEach((input) => {
        const name = input.name.trim()
        if (!name) {
          rejected.push({ ...input, name: input.name, error: "File name is required." })
          return
        }
        if (input.sizeBytes <= 0) {
          rejected.push({ ...input, name, error: "File is empty and cannot be uploaded." })
          return
        }
        if (input.sizeBytes > MAX_UPLOAD_BYTES) {
          rejected.push({ ...input, name, error: "File exceeds the 2 GB mock upload limit." })
          return
        }
        let uniqueName = name
        let suffix = 1
        while (reservedNames.has(uniqueName.toLowerCase())) {
          const extensionIndex = name.lastIndexOf(".")
          const base = extensionIndex > 0 ? name.slice(0, extensionIndex) : name
          const extension = extensionIndex > 0 ? name.slice(extensionIndex) : ""
          uniqueName = `${base} (${suffix})${extension}`
          suffix += 1
        }
        reservedNames.add(uniqueName.toLowerCase())
        const id = this.nextId(state, "upload")
        state.uploads.push({
          id,
          parentId,
          name: uniqueName,
          sizeBytes: input.sizeBytes,
          mimeType: input.mimeType || "application/octet-stream",
          status: "queued",
          progress: 0,
        })
        accepted.push(id)
      })
    })
    return { accepted, rejected }
  }

  tickUploads(elapsedMs = 250) {
    if (
      !this.state.uploads.some(
        (upload) => upload.status === "queued" || upload.status === "uploading",
      )
    ) {
      return
    }
    this.commit((state) => {
      let activeUploads = state.uploads.filter((upload) => upload.status === "uploading").length
      state.uploads.forEach((upload) => {
        if (upload.status === "queued" && activeUploads < 2) {
          upload.status = "uploading"
          activeUploads += 1
        }
      })

      state.uploads.forEach((upload) => {
        if (upload.status !== "uploading") return
        // Deterministic demo failure: any upload whose filename contains
        // "fail" errors out on its first tick instead of completing.
        if (upload.name.toLowerCase().includes("fail")) {
          upload.status = "failed"
          upload.error = 'Upload failed (demo trigger: filename contains "fail").'
          return
        }
        const durationMs = Math.min(
          9000,
          Math.max(1200, 1200 + (upload.sizeBytes / (1024 * 1024)) * 900),
        )
        upload.progress = Math.min(100, upload.progress + (elapsedMs / durationMs) * 100)
        if (upload.progress >= 100) {
          upload.status = "done"
          upload.progress = 100
          const parentExists =
            upload.parentId === null ||
            state.files.some((node) => node.id === upload.parentId && node.kind === "folder")
          if (parentExists) {
            const id = this.nextId(state, "file")
            state.files.push({
              id,
              name: upload.name,
              kind: "file",
              parentId: upload.parentId,
              mimeType: upload.mimeType,
              sizeBytes: upload.sizeBytes,
              owner: CURRENT_USER.name,
              updatedAt: this.now(),
              content: mockUploadContent(upload.name, upload.mimeType),
              previewUrl: mockUploadPreviewUrl(upload.name, upload.mimeType),
              gitStatus: "untracked",
            })
          }
        }
      })
    })
  }

  pauseUpload(id: string): MutationResult {
    return this.updateUpload(id, (upload) => {
      if (upload.status === "uploading") upload.status = "paused"
    })
  }

  resumeUpload(id: string): MutationResult {
    return this.updateUpload(id, (upload) => {
      if (upload.status === "paused" || upload.status === "failed") {
        upload.status = "queued"
        upload.error = undefined
      }
    })
  }

  retryUpload(id: string): MutationResult {
    return this.updateUpload(id, (upload) => {
      if (upload.status === "failed") {
        upload.status = "queued"
        upload.progress = 0
        upload.error = undefined
      }
    })
  }

  cancelUpload(id: string): MutationResult {
    let found = false
    this.commit((state) => {
      const before = state.uploads.length
      state.uploads = state.uploads.filter((upload) => upload.id !== id)
      found = state.uploads.length !== before
    })
    return found ? { ok: true } : { ok: false, error: "Upload no longer exists." }
  }

  private updateUpload(id: string, mutator: (upload: FileUpload) => void): MutationResult {
    let found = false
    this.commit((state) => {
      const upload = state.uploads.find((candidate) => candidate.id === id)
      if (upload) {
        mutator(upload)
        found = true
      }
    })
    return found ? { ok: true } : { ok: false, error: "Upload no longer exists." }
  }

  setActiveChatChannel(channelId: string): MutationResult {
    if (!this.state.chat.channels.some((channel) => channel.id === channelId)) {
      return { ok: false, error: "Channel no longer exists." }
    }
    this.commit((state) => {
      state.chat.activeChannelId = channelId
      state.chat.lastReadAt[channelId] = this.now()
    })
    return { ok: true }
  }

  createChatChannel(name: string, kind: ChatChannelKind = "channel"): CreateResult {
    const cleanName = name.trim().replace(/^#+/, "")
    if (!cleanName) return { ok: false, error: "Thread name cannot be empty." }
    if (this.state.chat.channels.some((channel) => channel.name === cleanName)) {
      return { ok: false, error: "A thread with that name already exists." }
    }

    let id: string | null = null
    this.commit((state) => {
      id = this.nextId(state, kind === "dm" ? "dm" : "channel")
      state.chat.channels.push({
        id,
        name: cleanName,
        kind,
        memberCount:
          kind === "dm" ? 2 : state.chat.members.filter((member) => member.online).length,
      })
      state.chat.activeChannelId = id
      state.chat.lastReadAt[id] = this.now()
    })
    return { ok: true, id: id! }
  }

  toggleChatReaction(messageId: string, emoji: string): MutationResult {
    let found = false
    this.commit((state) => {
      const message = state.chat.messages.find((candidate) => candidate.id === messageId)
      if (!message) return
      found = true
      const reactions = [...(message.reactions ?? [])]
      const index = reactions.findIndex((reaction) => reaction.emoji === emoji)
      if (index === -1) {
        reactions.push({ emoji, userIds: [CURRENT_USER.id] })
      } else if (reactions[index].userIds.includes(CURRENT_USER.id)) {
        const userIds = reactions[index].userIds.filter((id) => id !== CURRENT_USER.id)
        if (userIds.length === 0) reactions.splice(index, 1)
        else reactions[index] = { ...reactions[index], userIds }
      } else {
        reactions[index] = {
          ...reactions[index],
          userIds: [...reactions[index].userIds, CURRENT_USER.id],
        }
      }
      message.reactions = reactions
    })
    return found ? { ok: true } : { ok: false, error: "Message no longer exists." }
  }

  setChatAnonymous(anonymous: boolean) {
    this.commit((state) => {
      state.chat.anonymous = anonymous
    })
  }

  setChatBotEnabled(enabled: boolean) {
    this.commit((state) => {
      state.chat.botEnabled = enabled
    })
  }

  sendChatMessage(
    channelId: string,
    body: string,
    anonymous = this.state.chat.anonymous,
    attachments: { name: string; sizeBytes: number }[] = [],
    mentions: { id: string; name: string }[] = [],
    replyToId?: string,
  ) {
    const cleanBody = body.trim()
    if (!cleanBody && attachments.length === 0) return null
    if (!this.state.chat.channels.some((channel) => channel.id === channelId)) return null
    if (
      replyToId &&
      !this.state.chat.messages.some(
        (message) => message.id === replyToId && message.channelId === channelId,
      )
    ) {
      return null
    }

    let id: string | null = null
    this.commit((state) => {
      id = this.nextId(state, "msg")
      state.chat.messages.push({
        id,
        channelId,
        authorId: CURRENT_USER.id,
        authorName: anonymous ? CURRENT_USER.anonymousName : CURRENT_USER.name,
        anonymous,
        body: cleanBody,
        attachments: attachments.map((file): ChatAttachment => ({
          id: this.nextId(state, "att"),
          name: file.name,
          sizeBytes: file.sizeBytes,
        })),
        mentions: mentions.filter((mention) => mention.id !== CURRENT_USER.id),
        reactions: [],
        ...(replyToId ? { replyToId } : {}),
        createdAt: this.now(),
        status: "sending",
      })
    })
    return id
  }

  /**
   * Routes a sent message to the right mock responder: when the chat bot is
   * enabled and the body addresses it (a `/command` or an @mention of the
   * bot), the bot replies; anything else falls back to the placeholder member
   * auto-reply so the thread still feels alive in demos.
   */
  queueChatResponse(channelId: string, delayMs = 1100, replyToId?: string, body = "") {
    if (this.state.chat.botEnabled && isChatBotTrigger(body)) {
      this.queueChatBotReply(channelId, delayMs, replyToId, body)
      return
    }
    this.queueChatAutoReply(channelId, delayMs, replyToId)
  }

  /**
   * Placeholder for the future chat backend: after a short delay a random
   * member posts a canned reply so the thread feels alive in demos.
   */
  queueChatAutoReply(channelId: string, delayMs = 1100, replyToId?: string) {
    const member = CHAT_REPLY_MEMBERS[Math.floor(Math.random() * CHAT_REPLY_MEMBERS.length)]
    this.scheduleChatReply(
      channelId,
      delayMs,
      replyToId,
      { id: member.id, name: member.name },
      () => CHAT_AUTO_REPLY_BODY,
    )
  }

  /**
   * Rule-based demo bot: answers slash commands and @mentions addressed to it
   * with canned text computed from the channel snapshot at reply time.
   */
  queueChatBotReply(channelId: string, delayMs = 1100, replyToId?: string, body = "") {
    this.scheduleChatReply(
      channelId,
      delayMs,
      replyToId,
      { id: CHAT_BOT.id, name: CHAT_BOT.name, bot: true },
      (state) => chatBotReply(body, chatBotContext(state, channelId)),
    )
  }

  /**
   * Shared reply pipeline for the canned member auto-reply and the chat bot:
   * shows a "typing…" presence entry for most of the delay, clears it a beat
   * before the reply posts, then commits the message in the given channel.
   */
  private scheduleChatReply(
    channelId: string,
    delayMs: number,
    replyToId: string | undefined,
    author: { id: string; name: string; bot?: boolean },
    compose: (state: MockState) => string,
  ) {
    this.commit((state) => {
      if (!state.chat.channels.some((channel) => channel.id === channelId)) return
      state.chat.typing = state.chat.typing.filter(
        (entry) => !(entry.channelId === channelId && entry.memberId === author.id),
      )
      state.chat.typing.push({
        channelId,
        memberId: author.id,
        memberName: author.name,
        ...(author.bot ? { bot: true } : {}),
      })
    })
    const clearTyping = () =>
      this.commit((state) => {
        state.chat.typing = state.chat.typing.filter(
          (entry) => !(entry.channelId === channelId && entry.memberId === author.id),
        )
      })
    // Keep "typing…" visible for most of the delay, then clear it a beat
    // before the reply posts so polls in between see a real typing window.
    setTimeout(clearTyping, Math.max(0, delayMs - CHAT_TYPING_LEAD_MS))
    setTimeout(() => {
      this.commit((state) => {
        state.chat.typing = state.chat.typing.filter(
          (entry) => !(entry.channelId === channelId && entry.memberId === author.id),
        )
        if (!state.chat.channels.some((channel) => channel.id === channelId)) return
        state.chat.messages.push({
          id: this.nextId(state, "msg"),
          channelId,
          authorId: author.id,
          authorName: author.name,
          anonymous: false,
          body: compose(state),
          ...(author.bot ? { bot: true } : {}),
          ...(replyToId ? { replyToId } : {}),
          createdAt: this.now(),
          status: "sent",
        })
      })
    }, delayMs)
  }

  settleChatMessage(id: string) {
    this.commit((state) => {
      const message = state.chat.messages.find((candidate) => candidate.id === id)
      if (message?.status === "sending") message.status = "sent"
    })
  }

  /** Batch variant of {@link settleChatMessage}: flips every "sending"
   * message to "sent" in a single commit/notify cycle. */
  settleChatMessages() {
    this.commit((state) => {
      state.chat.messages.forEach((message) => {
        if (message.status === "sending") message.status = "sent"
      })
    })
  }

  retryChatMessage(id: string): MutationResult {
    let found = false
    this.commit((state) => {
      const message = state.chat.messages.find((candidate) => candidate.id === id)
      if (message?.status === "failed") {
        message.status = "sending"
        found = true
      }
    })
    return found ? { ok: true } : { ok: false, error: "Message is not waiting to retry." }
  }

  setActiveLabEnvironment(environmentId: string): MutationResult {
    if (!this.state.lab.environments.some((environment) => environment.id === environmentId)) {
      return { ok: false, error: "Lab environment no longer exists." }
    }
    this.commit((state) => {
      state.lab.activeEnvironmentId = environmentId
    })
    return { ok: true }
  }

  startLabSession(environmentId: string): MutationResult {
    let found = false
    this.commit((state) => {
      const environment = state.lab.environments.find((candidate) => candidate.id === environmentId)
      if (environment?.status === "stopped") {
        environment.status = "starting"
        environment.statusLabel = "Starting session…"
        found = true
      }
    })
    return found ? { ok: true } : { ok: false, error: "Session is already active." }
  }

  completeLabSessionStart(environmentId: string): MutationResult {
    let found = false
    this.commit((state) => {
      const environment = state.lab.environments.find((candidate) => candidate.id === environmentId)
      if (environment?.status === "starting") {
        environment.status = "running"
        environment.statusLabel = statusLabelFor(environment.kind)
        environment.lastActiveAt = this.now()
        found = true
      }
    })
    return found ? { ok: true } : { ok: false, error: "Session is not starting." }
  }

  stopLabSession(environmentId: string): MutationResult {
    let found = false
    this.commit((state) => {
      const environment = state.lab.environments.find((candidate) => candidate.id === environmentId)
      if (environment && environment.status !== "stopped") {
        environment.status = "stopped"
        environment.statusLabel = `${environment.name} stopped`
        environment.lastActiveAt = null
        found = true
      }
    })
    return found ? { ok: true } : { ok: false, error: "Session is already stopped." }
  }

  pingLabSession(environmentId: string): MutationResult {
    let found = false
    this.commit((state) => {
      const environment = state.lab.environments.find((candidate) => candidate.id === environmentId)
      if (environment?.status === "running") {
        environment.lastActiveAt = this.now()
        found = true
      }
    })
    return found ? { ok: true } : { ok: false, error: "Session is not running." }
  }

  setAgentConfig(config: AgentConfig) {
    this.commit((state) => {
      state.agent.config = { ...config }
    })
  }

  runAgent(prompt: string, configOverride?: AgentConfig): AgentRun | null {
    const cleanPrompt = prompt.trim()
    if (!cleanPrompt || agentRequestsRemaining(this.state.agent.quota) <= 0) return null
    const config = configOverride ?? this.state.agent.config

    let runId = ""
    this.commit((state) => {
      if (agentRequestsRemaining(state.agent.quota) <= 0) return
      state.agent.quota.used += 1
      runId = this.appendAgentRun(state, cleanPrompt, null, config)
      state.agent.activeRunId = runId
    })
    return this.state.agent.runs.find((run) => run.id === runId) ?? null
  }

  private appendAgentRun(
    state: MockState,
    prompt: string,
    retryOf: string | null,
    config: AgentConfig,
  ) {
    const id = this.nextId(state, "agent-run")
    const steps = buildAgentSteps(prompt).map((step, index) => ({
      ...step,
      id: `${id}-step-${index + 1}`,
      status: index === 0 ? ("running" as const) : ("pending" as const),
    }))
    state.agent.runs.push({
      id,
      prompt,
      status: "running",
      steps,
      diff: buildAgentDiff(prompt),
      createdAt: this.now(),
      finishedAt: null,
      summary: "",
      retryOf,
      config: { ...config },
    })
    return id
  }

  advanceAgentRuns() {
    this.commit((state) => {
      state.agent.runs.forEach((run) => {
        if (run.status !== "running") return
        const activeIndex = run.steps.findIndex((step) => step.status === "running")
        const nextIndex = run.steps.findIndex((step) => step.status === "pending")
        if (activeIndex >= 0) {
          run.steps[activeIndex].status = "done"
          run.steps[activeIndex].durationMs = 500 + activeIndex * 180
        }
        if (nextIndex >= 0) {
          run.steps[nextIndex].status = "running"
          return
        }
        run.status = run.diff?.review === "pending" ? "waiting_approval" : "succeeded"
        if (run.status === "succeeded") {
          run.finishedAt = this.now()
          run.summary = "Run completed. The proposed diff is ready for review."
        }
      })
    })
  }

  cancelAgentRun(runId: string): MutationResult {
    let found = false
    this.commit((state) => {
      const run = state.agent.runs.find((candidate) => candidate.id === runId)
      if (run && (run.status === "running" || run.status === "waiting_approval")) {
        run.status = "cancelled"
        run.finishedAt = this.now()
        run.summary = "Run cancelled. No project files were changed."
        run.steps.forEach((step) => {
          if (step.status === "running" || step.status === "pending") step.status = "cancelled"
        })
        if (run.diff?.review === "pending") run.diff.review = "cancelled"
        if (state.agent.activeRunId === run.id) state.agent.activeRunId = null
        found = true
      }
    })
    return found ? { ok: true } : { ok: false, error: "Run is not active." }
  }

  retryAgentRun(runId: string): AgentRun | null {
    const source = this.state.agent.runs.find((run) => run.id === runId)
    if (!source || !["failed", "cancelled", "rejected"].includes(source.status)) return null
    if (agentRequestsRemaining(this.state.agent.quota) <= 0) return null

    let newRunId = ""
    this.commit((state) => {
      if (agentRequestsRemaining(state.agent.quota) <= 0) return
      state.agent.quota.used += 1
      newRunId = this.appendAgentRun(state, source.prompt, source.id, source.config)
      state.agent.activeRunId = newRunId
    })
    return this.state.agent.runs.find((run) => run.id === newRunId) ?? null
  }

  reviewAgentDiff(runId: string, decision: "approved" | "rejected"): MutationResult {
    let found = false
    this.commit((state) => {
      const run = state.agent.runs.find((candidate) => candidate.id === runId)
      if (run?.status === "waiting_approval" && run.diff?.review === "pending") {
        run.diff.review = decision
        if (decision === "approved") {
          run.status = "succeeded"
          run.finishedAt = this.now()
          run.summary = "Diff approved. Mock review complete; no files were written."
        } else {
          run.status = "rejected"
          run.finishedAt = this.now()
          run.summary = "Diff rejected. No project files were changed."
        }
        found = true
      }
    })
    return found ? { ok: true } : { ok: false, error: "Diff is not waiting for review." }
  }
}

/* -------------------------------------------------------------------------- */
/* Mock chat bot                                                              */
/*                                                                            */
/* Rule-based responder for the demo chat bot: slash commands always trigger  */
/* it, and so does an @mention of the bot by name or alias. Everything else    */
/* falls through to the placeholder member auto-reply.                        */
/* -------------------------------------------------------------------------- */

// Matches "@Spindle Bot" plus the short aliases "@spindle", "@spindlebot",
// and "@bot", but not longer handles such as "@spindle-1" or "@botany".
const CHAT_BOT_MENTION_PATTERN = /(^|[\s(])@(?:spindle\s*bot|spindlebot|spindle|bot)(?![\w-])/i
const CHAT_BOT_COMMAND_PATTERN = /^\/([\w-]+)/

/** True when a sent message body is addressed to the chat bot. */
function isChatBotTrigger(body: string) {
  const text = body.trim()
  if (!text) return false
  return CHAT_BOT_COMMAND_PATTERN.test(text) || CHAT_BOT_MENTION_PATTERN.test(text)
}

type ChatBotContext = {
  channelName: string
  messageCount: number
  memberCount: number
}

function chatBotContext(state: MockState, channelId: string): ChatBotContext {
  return {
    channelName: state.chat.channels.find((channel) => channel.id === channelId)?.name ?? channelId,
    messageCount: state.chat.messages.filter((message) => message.channelId === channelId).length,
    memberCount: state.chat.members.length,
  }
}

/** Canned rule-based reply; only called for bodies that pass the trigger. */
function chatBotReply(body: string, context: ChatBotContext): string {
  const command = CHAT_BOT_COMMAND_PATTERN.exec(body.trim())?.[1]?.toLowerCase()

  if (command) {
    switch (command) {
      case "help":
      case "commands":
        return `I'm ${CHAT_BOT.name}, the mock chat bot. Try /status for a quick snapshot of this thread, or @mention me any time. Type "/" in the composer for user commands like /me and /shrug too. (This is a canned demo responder — no real backend yet.)`
      case "status":
        return `All systems nominal in #${context.channelName}: ${context.messageCount} messages, ${context.memberCount} members online-or-away, and I'm online. Mock data only.`
      default:
        return `Unknown command "/${command}". Send /help to see what I can do.`
    }
  }

  return `Hi — I'm ${CHAT_BOT.name}. I answer slash commands like /status and /help, and I watch for @mentions. My replies are canned for the demo.`
}

function statusLabelFor(kind: LabEnvironmentKind) {
  switch (kind) {
    case "rstudio":
      return "Kernel idle"
    case "jupyter":
      return "Python 3.12 · idle"
    case "vscode":
      return "Workspace open"
    case "terminal":
      return "Shell ready"
  }
}

function buildAgentSteps(prompt: string) {
  const shortPrompt = prompt.length > 64 ? `${prompt.slice(0, 61)}…` : prompt
  return [
    {
      label: "Plan the requested project changes",
      detail: shortPrompt,
    },
    {
      label: "Inspect files and references",
      detail: "Scan the mock file tree for matching inputs and outputs.",
    },
    {
      label: "Prepare a reviewable diff",
      detail: "Group proposed additions and removals without writing files.",
    },
    {
      label: "Hand off for review",
      detail: "Stop before applying anything so the diff can be approved or rejected.",
    },
  ]
}

function buildAgentDiff(prompt: string): AgentDiff {
  const target = prompt.toLowerCase().includes("notebook")
    ? "notebooks/analysis.ipynb"
    : "data/2026/field-export.csv"
  return {
    id: `diff-${target.replace(/[^a-z0-9]+/gi, "-")}`,
    path: target,
    summary: "Mock agent proposal generated from the prompt. Nothing is written until approval.",
    before: ["site,salinity,turbidity", "A-01,28.4,4.2", "A-02,27.9,3.8", "B-04,31.2,5.1"],
    after: [
      "site,salinity,turbidity,review_status",
      "A-01,28.4,4.2,verified",
      "A-02,27.9,3.8,verified",
      "B-04,31.2,5.1,pending",
      "C-09,30.1,4.7,verified",
    ],
    additions: 2,
    deletions: 1,
    review: "pending",
  }
}

function mockUploadPreviewUrl(name: string, mimeType: string) {
  const lowerName = name.toLowerCase()
  const isImage =
    mimeType.startsWith("image/") || /\.(png|jpe?g|svg|gif|webp|avif|bmp)$/.test(lowerName)
  if (isImage) return MOCK_IMAGE_PREVIEW_URL
  const isVideo = mimeType.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/.test(lowerName)
  if (isVideo) return MOCK_VIDEO_PREVIEW_URL
  return undefined
}

function mockUploadContent(name: string, mimeType: string) {
  const lowerName = name.toLowerCase()
  if (mimeType.includes("csv") || lowerName.endsWith(".csv")) {
    return "site,salinity,turbidity\nA-01,28.4,4.2\nA-02,27.9,3.8"
  }
  if (mimeType.includes("markdown") || lowerName.endsWith(".md") || mimeType.includes("text")) {
    return `# ${name}\n\nMock upload completed in the session store.`
  }
  if (mimeType.includes("json") || lowerName.endsWith(".json")) {
    return `{\n  "name": ${JSON.stringify(name)},\n  "mock": true\n}`
  }
  return undefined
}
