/**
 * Pure helpers for the project workspace resources.
 *
 * The workspace adapters and screens derive folder trees, storage totals, and
 * display labels from the same snapshot, so these helpers live beside the
 * `WorkspaceApi` types rather than inside the mock implementation.
 */

import type {
  AgentConfig,
  AgentModelId,
  AgentQuota,
  AgentScope,
  FileNode,
  WorkspaceStorageUsage,
} from "./types"

/** Human-readable project name; slug-like ids are title-cased, known ids mapped. */
export function projectDisplayName(projectId: string) {
  if (projectId === "coastal-resilience") return "Coastal resilience"
  return projectId
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

/** Format a byte count as a compact human-readable string (e.g. "1.5 MB"). */
export function formatBytes(bytes: number) {
  if (bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** index
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`
}

/** Uppercase file extension without the dot, or "FILE" when the name has none. */
export function fileExtension(name: string) {
  const index = name.lastIndexOf(".")
  return index > 0 ? name.slice(index + 1).toUpperCase() : "FILE"
}

/** Short display label for a file node's type (e.g. "CSV", "Notebook", "Folder"). */
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

/** Agent requests left today: daily limit plus bonus, minus what was already used. */
export function agentRequestsRemaining(quota: AgentQuota) {
  return Math.max(0, quota.dailyLimit + quota.bonus - quota.used)
}

/** Models offered on the agent screen, in picker order. */
export const AGENT_MODELS: { id: AgentModelId; label: string; hint: string }[] = [
  { id: "spindle-1", label: "Spindle 1", hint: "Balanced — default for most runs" },
  { id: "spindle-1-mini", label: "Spindle 1 Mini", hint: "Fastest, best for small edits" },
  { id: "spindle-1-pro", label: "Spindle 1 Pro", hint: "Deepest reasoning, slower" },
]

/** Agent run scopes offered on the agent screen, in picker order. */
export const AGENT_SCOPES: { id: AgentScope; label: string; hint: string }[] = [
  { id: "project", label: "Whole project", hint: "Reads files, lab notes, and chat context" },
  { id: "files", label: "Files only", hint: "Restricts the run to the file tree" },
]

/** Agent configuration preselected when the agent screen first loads. */
export const DEFAULT_AGENT_CONFIG: AgentConfig = { model: "spindle-1", scope: "project" }

/** Display label for an agent model id, falling back to the raw id. */
export function agentModelLabel(model: AgentModelId) {
  return AGENT_MODELS.find((entry) => entry.id === model)?.label ?? model
}

/** Display label for an agent scope id, falling back to the raw id. */
export function agentScopeLabel(scope: AgentScope) {
  return AGENT_SCOPES.find((entry) => entry.id === scope)?.label ?? scope
}

/** Short provenance tag shown on a run, e.g. "Spindle 1 · Whole project". */
export function agentConfigLabel(config: AgentConfig) {
  return `${agentModelLabel(config.model)} · ${agentScopeLabel(config.scope)}`
}

/** Direct children of `parentId`, sorted by name. */
export function childNodes(files: FileNode[], parentId: string | null) {
  return files
    .filter((node) => node.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Resolve a folder from its path segments. An empty path resolves to a
 * synthetic root node so the files screen can treat the project root uniformly.
 */
export function findFolderByPath(files: FileNode[], segments: string[]): FileNode | null {
  let parentId: string | null = null
  let folder: FileNode | null = null

  for (const segment of segments) {
    folder =
      files.find(
        (node) => node.parentId === parentId && node.kind === "folder" && node.name === segment,
      ) ?? null
    if (!folder) return null
    parentId = folder.id
  }

  return (
    folder ?? {
      id: "root",
      name: "Files",
      kind: "folder",
      parentId: null,
      mimeType: "",
      sizeBytes: 0,
      owner: "",
      updatedAt: "",
    }
  )
}

/** Full path segments for a node, from the project root down to the node. */
export function fileNodePath(files: FileNode[], node: FileNode) {
  const parts = [node.name]
  let current = node
  while (current.parentId) {
    const parent = files.find((candidate) => candidate.id === current.parentId)
    if (!parent) break
    parts.unshift(parent.name)
    current = parent
  }
  return parts
}

/** Total bytes used by file nodes plus the workspace storage limit. */
export function workspaceStorageUsage(
  files: FileNode[],
  limitBytes: number,
): WorkspaceStorageUsage {
  const usedBytes = files
    .filter((node) => node.kind === "file")
    .reduce((total, node) => total + node.sizeBytes, 0)
  return { usedBytes, limitBytes }
}
