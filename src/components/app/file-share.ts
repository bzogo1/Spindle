"use client"

import { useCallback, useEffect, useState } from "react"

import { fileNodePath } from "@/lib/api"
import type { FileNode } from "@/lib/api"

/**
 * File and folder sharing for the files screen. Shares are mock state: each
 * record grants one workspace member a permission (`view` or `edit`) on one
 * node, persisted to localStorage as a versioned blob keyed per project so it
 * survives reloads and syncs across tabs via the `storage` event — the same
 * pattern as `dashboard-layout.ts` and `lab-snapshot-thresholds.ts`.
 *
 * Share links reuse the files screen's existing deep-link params rather than
 * introducing a new codec (see `fileShareHref`):
 *
 * - files — `?preview=<nodeId>` opens the preview drawer, matching the
 *   `?preview=` param `FilesScreen` already mirrors into the URL.
 * - folders — the folder's canonical `/files/<path>` URL; `preview` is
 *   stripped because folders have no preview.
 *
 * Unrelated params (e.g. `?project=` from the project switcher) are preserved,
 * matching `dashboard-share.ts` / `lab-snapshot-share.ts`.
 */

export const FILE_SHARE_PREVIEW_PARAM = "preview"

export const FILE_SHARE_PERMISSIONS = ["view", "edit"] as const
export type FileSharePermission = (typeof FILE_SHARE_PERMISSIONS)[number]

export const FILE_SHARE_PERMISSION_LABELS: Record<FileSharePermission, string> = {
  view: "View",
  edit: "Edit",
}

export interface FileShare {
  id: string
  /** Id of the shared file or folder node. */
  nodeId: string
  /** Node name snapshot so the list still reads sensibly after a rename. */
  nodeName: string
  userId: string
  userName: string
  permission: FileSharePermission
  createdAt: string
}

/** localStorage key for the persisted shares blob (versioned, per project). */
export function fileSharesStorageKey(projectId: string): string {
  return `spindle.files.shares:${projectId}:v1`
}

/** Schema version stored inside the blob; must match the key suffix. */
export const FILE_SHARES_STORAGE_VERSION = 1

interface FileSharesBlob {
  version: number
  shares: FileShare[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isPermission(value: unknown): value is FileSharePermission {
  return typeof value === "string" && (FILE_SHARE_PERMISSIONS as readonly string[]).includes(value)
}

/**
 * Validate one untrusted share record (localStorage blob, cross-tab storage
 * event). Returns null for anything that cannot produce a renderable row.
 */
function sanitizeFileShare(value: unknown): FileShare | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== "string" || value.id.length === 0) return null
  if (typeof value.nodeId !== "string" || value.nodeId.length === 0) return null
  if (typeof value.userId !== "string" || value.userId.length === 0) return null
  if (typeof value.userName !== "string" || value.userName.length === 0) return null
  return {
    id: value.id,
    nodeId: value.nodeId,
    nodeName: typeof value.nodeName === "string" ? value.nodeName : "",
    userId: value.userId,
    userName: value.userName,
    permission: isPermission(value.permission) ? value.permission : "view",
    createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
  }
}

/**
 * Merge an untrusted blob over the empty default. A blob whose `version` does
 * not match the current schema is treated as absent — the versioned key means
 * stale payloads are ignored rather than migrated.
 */
export function sanitizeFileShares(value: unknown): FileShare[] {
  if (!isRecord(value)) return []
  if (typeof value.version === "number" && value.version !== FILE_SHARES_STORAGE_VERSION) {
    return []
  }
  const shares = Array.isArray(value.shares) ? value.shares : []
  return shares.map(sanitizeFileShare).filter((share): share is FileShare => share !== null)
}

export function readFileShares(projectId: string): FileShare[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(fileSharesStorageKey(projectId))
    if (!raw) return []
    return sanitizeFileShares(JSON.parse(raw))
  } catch {
    return []
  }
}

export interface AddFileShareInput {
  nodeId: string
  nodeName: string
  userId: string
  userName: string
  permission: FileSharePermission
}

/**
 * File shares for one project, persisted to localStorage. Starts empty on
 * both server and client so the first render hydrates cleanly; the stored
 * blob is applied in a mount effect (reading localStorage in the initializer
 * would mismatch server HTML). Cross-tab writes arrive through the `storage`
 * event. Re-adding a (node, user) pair updates the existing row instead of
 * duplicating it.
 */
export function useFileShares(projectId: string) {
  const [shares, setShares] = useState<FileShare[]>([])

  // Restore persisted shares after mount and whenever the project changes.
  useEffect(() => {
    setShares(readFileShares(projectId))
  }, [projectId])

  // Persist the shares whenever they change, and pick up writes from other
  // tabs (same pattern as the dashboard layout hook).
  useEffect(() => {
    try {
      const blob: FileSharesBlob = { version: FILE_SHARES_STORAGE_VERSION, shares }
      window.localStorage.setItem(fileSharesStorageKey(projectId), JSON.stringify(blob))
    } catch {
      // Storage can be unavailable (private mode); shares still apply for
      // this session via React state.
    }
  }, [projectId, shares])

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      const key = fileSharesStorageKey(projectId)
      // `key === null` means localStorage.clear() ran in another tab — treat
      // it as a reset to empty.
      if (event.key === null) {
        setShares([])
        return
      }
      if (event.key !== key) return
      if (event.newValue === null) {
        setShares([])
        return
      }
      try {
        setShares(sanitizeFileShares(JSON.parse(event.newValue)))
      } catch {
        // Corrupt payload from another tab — keep the current shares.
      }
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [projectId])

  const addShare = useCallback((input: AddFileShareInput) => {
    setShares((current) => {
      const existing = current.find(
        (share) => share.nodeId === input.nodeId && share.userId === input.userId,
      )
      if (existing) {
        return current.map((share) =>
          share.id === existing.id
            ? {
                ...share,
                nodeName: input.nodeName,
                permission: input.permission,
              }
            : share,
        )
      }
      const share: FileShare = {
        id: `share_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        nodeId: input.nodeId,
        nodeName: input.nodeName,
        userId: input.userId,
        userName: input.userName,
        permission: input.permission,
        createdAt: new Date().toISOString(),
      }
      return [...current, share]
    })
  }, [])

  const setSharePermission = useCallback((shareId: string, permission: FileSharePermission) => {
    setShares((current) =>
      current.map((share) => (share.id === shareId ? { ...share, permission } : share)),
    )
  }, [])

  const revokeShare = useCallback((shareId: string) => {
    setShares((current) => current.filter((share) => share.id !== shareId))
  }, [])

  return { shares, addShare, setSharePermission, revokeShare }
}

/** Shares granted on one node, in grant order. */
export function sharesForNode(shares: FileShare[], nodeId: string): FileShare[] {
  return shares.filter((share) => share.nodeId === nodeId)
}

export interface FileShareLink {
  node: FileNode
  files: FileNode[]
  projectId: string
  /** Current pathname; file links stay on it so unrelated segments survive. */
  pathname: string
  /** Current query (`location.search`-style, with or without a leading "?"). */
  search?: string
}

/**
 * Absolute share URL for a node. Files link to the `?preview=<id>` deep link
 * the files screen already syncs into the address bar; folders link to their
 * canonical path URL. Unrelated params are preserved and `preview` is removed
 * for folders, matching the other share param codecs.
 */
export function fileShareHref({ node, files, projectId, pathname, search }: FileShareLink): string {
  const params = new URLSearchParams(search?.replace(/^\?/, "") ?? "")
  const origin = typeof window === "undefined" ? "" : window.location.origin

  if (node.kind === "file") {
    params.set(FILE_SHARE_PREVIEW_PARAM, node.id)
    const fileQuery = params.toString()
    return `${origin}${pathname}${fileQuery ? `?${fileQuery}` : ""}`
  }

  params.delete(FILE_SHARE_PREVIEW_PARAM)
  const folderQuery = params.toString()
  const segments = fileNodePath(files, node)
    .map((segment) => encodeURIComponent(segment))
    .join("/")
  return `${origin}/projects/${projectId}/files/${segments}${folderQuery ? `?${folderQuery}` : ""}`
}
