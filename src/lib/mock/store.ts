/**
 * Session-scoped mock store for the post-login project screens.
 *
 * State is deterministic seed data held in memory only: client-side navigation
 * preserves mutations, while a full reload resets every screen back to the
 * seed. No network, upload, container, or model calls are made here.
 */
import { mockProjects } from "./index"

export type FileKind = "file" | "folder"

export type FileNode = {
  id: string
  name: string
  kind: FileKind
  parentId: string | null
  mimeType: string
  sizeBytes: number
  owner: string
  updatedAt: string
  content?: string
}

export type UploadFileInput = {
  name: string
  sizeBytes: number
  mimeType: string
}

export type RejectedUpload = UploadFileInput & { error: string }

export type UploadStatus = "queued" | "uploading" | "paused" | "failed" | "done"

export type FileUpload = {
  id: string
  parentId: string | null
  name: string
  sizeBytes: number
  mimeType: string
  status: UploadStatus
  progress: number
  error?: string
}

export type ChatChannelKind = "channel" | "dm"

export type ChatChannel = {
  id: string
  name: string
  kind: ChatChannelKind
  memberCount: number
}

export type ChatMessageStatus = "sending" | "sent" | "failed"

export type ChatMessage = {
  id: string
  channelId: string
  authorId: string
  authorName: string
  anonymous: boolean
  body: string
  createdAt: string
  status: ChatMessageStatus
}

export type LabEnvironmentKind = "rstudio" | "jupyter" | "vscode" | "terminal"

export type LabSessionStatus = "stopped" | "starting" | "running"

export type LabEnvironment = {
  id: string
  name: string
  kind: LabEnvironmentKind
  status: LabSessionStatus
  title: string
  statusLabel: string
  lastActiveAt: string | null
}

export type AgentQuota = {
  dailyLimit: number
  bonus: number
  used: number
}

export type AgentStepStatus = "pending" | "running" | "done" | "failed" | "cancelled"

export type AgentStep = {
  id: string
  label: string
  detail: string
  status: AgentStepStatus
  durationMs?: number
}

export type AgentDiffReview = "pending" | "approved" | "rejected" | "cancelled"

export type AgentDiff = {
  id: string
  path: string
  summary: string
  before: string[]
  after: string[]
  additions: number
  deletions: number
  review: AgentDiffReview
}

export type AgentRunStatus =
  "running" | "waiting_approval" | "succeeded" | "failed" | "cancelled" | "rejected"

export type AgentRun = {
  id: string
  prompt: string
  status: AgentRunStatus
  steps: AgentStep[]
  diff: AgentDiff | null
  createdAt: string
  finishedAt: string | null
  summary: string
  retryOf: string | null
}

export type MockProject = {
  id: string
  name: string
  owner: string
  storageLimitBytes: number
}

export type MockState = {
  project: MockProject
  sequence: number
  files: FileNode[]
  uploads: FileUpload[]
  chat: {
    activeChannelId: string
    anonymous: boolean
    channels: ChatChannel[]
    messages: ChatMessage[]
  }
  lab: {
    activeEnvironmentId: string
    environments: LabEnvironment[]
  }
  agent: {
    prompt: string
    quota: AgentQuota
    activeRunId: string | null
    runs: AgentRun[]
  }
}

export const STORAGE_LIMIT_BYTES = 5 * 1024 * 1024 * 1024
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024
export const AGENT_QUOTA_LIMIT = 70

const CURRENT_USER = {
  id: "user-bogdan",
  name: "You",
  anonymousName: "Anonymous surveyor",
}

export function projectDisplayName(projectId: string) {
  if (projectId === "coastal-resilience") return "Coastal resilience"
  return projectId
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

export function formatBytes(bytes: number) {
  if (bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** index
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`
}

export function fileExtension(name: string) {
  const index = name.lastIndexOf(".")
  return index > 0 ? name.slice(index + 1).toUpperCase() : "FILE"
}

export function fileTypeLabel(node: Pick<FileNode, "kind" | "mimeType" | "name">) {
  if (node.kind === "folder") return "Folder"
  const extension = fileExtension(node.name)
  if (["CSV", "TSV"].includes(extension)) return "CSV"
  if (extension === "IPYNB") return "Notebook"
  if (extension === "PDF") return "PDF"
  if (["PNG", "JPG", "JPEG", "WEBP", "GIF"].includes(extension)) return "Image"
  if (["MD", "TXT"].includes(extension)) return "Text"
  if (node.mimeType) return node.mimeType.split("/")[1]?.toUpperCase() || "File"
  return extension
}

export function agentRequestsRemaining(quota: AgentQuota) {
  return Math.max(0, quota.dailyLimit + quota.bonus - quota.used)
}

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
  ): FileNode => ({ id, name, kind, parentId, mimeType, sizeBytes, owner, updatedAt, content })

  return [
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
      "site,salinity,turbidity\nA-01,28.4,4.2\nA-02,27.9,3.8\nB-04,31.2,5.1",
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
      '{\n  "type": "FeatureCollection",\n  "features": []\n}',
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
      '{\n  "cells": [],\n  "metadata": {"kernelspec": {"name": "python3"}}\n}',
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
      "site,value\nA-01,1\nA-02,2",
    ),
  ]
}

function seedChat(): MockState["chat"] {
  return {
    activeChannelId: "channel-field-notes",
    anonymous: false,
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
    prompt: "",
    quota: { dailyLimit: 20, bonus: 50, used: 14 },
    activeRunId: null,
    runs: [],
  }
}

export function createSeedState(projectId: string): MockState {
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
    files: seedFiles(),
    uploads: [],
    chat: seedChat(),
    lab: seedLab(),
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

  constructor(projectId: string) {
    this.state = createSeedState(projectId)
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
    return new Date().toISOString()
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

  trashNode(id: string): MutationResult {
    if (!this.findNode(id)) return { ok: false, error: "Item no longer exists." }
    this.commit((state) => {
      const ids = this.descendantIds(state, id)
      state.files = state.files.filter((node) => !ids.has(node.id))
      state.uploads = state.uploads.filter(
        (upload) => upload.parentId !== id && !ids.has(upload.id),
      )
    })
    return { ok: true }
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
      if (upload.status === "failed" || upload.status === "done") {
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
    })
    return { ok: true }
  }

  setChatAnonymous(anonymous: boolean) {
    this.commit((state) => {
      state.chat.anonymous = anonymous
    })
  }

  sendChatMessage(channelId: string, body: string, anonymous = this.state.chat.anonymous) {
    const cleanBody = body.trim()
    if (!cleanBody) return null
    if (!this.state.chat.channels.some((channel) => channel.id === channelId)) return null

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
        createdAt: this.now(),
        status: "sending",
      })
    })
    return id
  }

  settleChatMessage(id: string) {
    this.commit((state) => {
      const message = state.chat.messages.find((candidate) => candidate.id === id)
      if (message?.status === "sending") message.status = "sent"
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

  setAgentPrompt(prompt: string) {
    this.commit((state) => {
      state.agent.prompt = prompt
    })
  }

  runAgent(promptOverride?: string): AgentRun | null {
    const prompt = (promptOverride ?? this.state.agent.prompt).trim()
    if (!prompt || agentRequestsRemaining(this.state.agent.quota) <= 0) return null

    let runId = ""
    this.commit((state) => {
      if (agentRequestsRemaining(state.agent.quota) <= 0) return
      state.agent.quota.used += 1
      runId = this.appendAgentRun(state, prompt, null)
      state.agent.activeRunId = runId
    })
    return this.state.agent.runs.find((run) => run.id === runId) ?? null
  }

  private appendAgentRun(state: MockState, prompt: string, retryOf: string | null) {
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
      newRunId = this.appendAgentRun(state, source.prompt, source.id)
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
