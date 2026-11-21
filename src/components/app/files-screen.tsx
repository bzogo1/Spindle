"use client"

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ChangeEvent, DragEvent, MouseEvent as ReactMouseEvent } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { ArrowUpDown, Check, Ellipsis, FolderOpen, FolderX } from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { EmptyState } from "@/components/app/states/empty-state"
import { ScreenState } from "@/components/app/states/screen-state"
import { FilePreviewDrawer } from "@/components/app/file-preview-drawer"
import { FileShareDialog } from "@/components/app/file-share-dialog"
import { useFileShares } from "@/components/app/file-share"
import { GIT_STATUS_META } from "@/lib/file-tree/git-status"
import { useToast } from "@/components/ui/toast"
import { getAvatarInitials } from "@/components/ui/avatar"
import { Dialog as DialogPrimitive } from "radix-ui"
import {
  childNodes,
  fileExtension,
  fileNodePath,
  fileTypeLabel,
  findFolderByPath,
  formatBytes,
  useFilesWorkspace,
  useWorkspaceMembers,
} from "@/lib/api"
import type { FileGitStatus, FileNode, FileUpload, UploadFileInput } from "@/lib/api"

type SortKey = "name" | "type" | "owner" | "updated" | "size"
type ViewMode = "list" | "grid"

/** A visible row in the folder tree, in depth-first display order. */
type FolderTreeEntry = {
  /** DOM/focus key: the folder id, or "root" for the project root row. */
  key: string
  folder: FileNode | null
  /** Key of the parent entry ("root" for top-level folders). */
  parentKey: string | null
  expanded: boolean
  hasChildren: boolean
  /** Nesting depth below the project root (0 = top-level row). */
  depth: number
}

/** Derived state for the folder-tree filter: which nodes stay visible. */
type TreeFilterState = {
  /** Lowercased, trimmed query used for matching and highlighting. */
  term: string
  /** Ids of files/folders whose name contains the term. */
  matches: Set<string>
  /** Folder ids that are ancestors of a match (kept visible and expanded). */
  ancestors: Set<string>
  /** Every node id rendered while the filter is active. */
  shown: Set<string>
}

const SORT_LABELS: Record<SortKey, string> = {
  name: "Name",
  type: "Type",
  owner: "Owner",
  updated: "Date modified",
  size: "Size",
}
const SORT_KEYS = Object.keys(SORT_LABELS) as SortKey[]

/** Custom dataTransfer type used when dragging existing file nodes. */
export const FILES_NODE_DRAG_TYPE = "application/x-spindle-file-nodes"

/**
 * Virtualized folder tree constants. Rows are flattened (each `treeitem` is a
 * direct child of the `tree`, with `aria-level` carrying the depth) so the
 * visible slice can be windowed inside the `.app-file-tree` scroll container.
 */
/** Pre-measurement row pitch fallback; jsdom reports 0 for offsetHeight. */
const TREE_ROW_PITCH_FALLBACK = 32
/** Extra rows rendered above/below the visible window. */
const TREE_OVERSCAN = 8
/** Fallback viewport height until the aside can be measured (jsdom). */
const TREE_VIEWPORT_FALLBACK = 480
/** How long a finished upload keeps its "Uploaded" row before auto-dismissing. */
const UPLOAD_DONE_VISIBLE_MS = 4000
/**
 * Horizontal indent per depth level. Mirrors the old nested markup:
 * `.fm-tree-children` consumed 17px per level (10px margin + 1px border +
 * 6px padding) on top of the row's own 12px padding per level.
 */
const TREE_INDENT_PX = 29
/** Vertical guide-line offset/step, matching `.fm-tree-children` borders. */
const TREE_GUIDE_OFFSET_PX = 10
const TREE_GUIDE_STEP_PX = 17

function draggedNodeIds(event: DragEvent<HTMLElement>): string[] {
  const raw = event.dataTransfer.getData(FILES_NODE_DRAG_TYPE)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : []
  } catch {
    return []
  }
}

type DialogState =
  | { type: "create-folder"; parentId: string | null }
  | { type: "rename"; node: FileNode }
  | { type: "move"; nodes: FileNode[] }
  | { type: "trash"; nodes: FileNode[] }
  | { type: "share"; node: FileNode }
  | null

/** Dialog variants handled by FileActionDialog (share has its own dialog). */
type ActionDialogState = Exclude<DialogState, null | { type: "share" }>

/** One entry shared by the row dropdown menu and the right-click context menu. */
type NodeMenuEntry = {
  label: string
  danger?: boolean
  disabled?: boolean
  run: () => void
}

function Icon({ name, className = "icon icon--xs" }: { name: string; className?: string }) {
  return (
    <svg className={className} aria-hidden="true">
      <use href={`#${name}`} />
    </svg>
  )
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

/** Compact remaining-time label for an upload ETA, e.g. "~12s left". */
function formatEta(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  const totalSeconds = Math.round(seconds)
  if (totalSeconds < 60) return `~${Math.max(1, totalSeconds)}s left`
  const minutes = Math.floor(totalSeconds / 60)
  const secs = totalSeconds % 60
  if (minutes < 60) return `~${minutes}m ${secs.toString().padStart(2, "0")}s left`
  const hours = Math.floor(minutes / 60)
  return `~${hours}h ${(minutes % 60).toString().padStart(2, "0")}m left`
}

/**
 * Smoothed upload throughput in bytes/sec, derived from progress snapshots.
 * The workspace polls every ~250ms while uploads are active, so each render
 * carries a fresh sample; the exponential average keeps the displayed rate
 * stable between ticks. Resets whenever the upload leaves "uploading".
 */
function useUploadRate(upload: FileUpload) {
  const lastSample = useRef<{ progress: number; at: number } | null>(null)
  const rate = useRef(0)
  useEffect(() => {
    const now = performance.now()
    const previous = lastSample.current
    lastSample.current = { progress: upload.progress, at: now }
    if (upload.status !== "uploading") {
      rate.current = 0
      return
    }
    if (!previous || now <= previous.at) return
    const elapsedSec = (now - previous.at) / 1000
    const deltaBytes = ((upload.progress - previous.progress) / 100) * upload.sizeBytes
    if (elapsedSec <= 0 || deltaBytes <= 0) return
    const instant = deltaBytes / elapsedSec
    rate.current = rate.current > 0 ? rate.current * 0.7 + instant * 0.3 : instant
  }, [upload.progress, upload.status, upload.sizeBytes])
  return rate.current
}

function fileIconName(node: FileNode) {
  if (node.kind === "folder") return "i-folder"
  const extension = fileExtension(node.name)
  if (["CSV", "TSV"].includes(extension)) return "i-chart"
  if (extension === "IPYNB") return "i-flask"
  if (["PNG", "JPG", "JPEG", "WEBP", "GIF", "SVG"].includes(extension)) return "i-cube"
  if (["MD", "TXT"].includes(extension)) return "i-pen"
  if (node.mimeType.startsWith("text/")) return "i-pen"
  if (
    [
      "JSON",
      "JS",
      "MJS",
      "CJS",
      "TS",
      "TSX",
      "JSX",
      "PY",
      "GO",
      "RS",
      "RB",
      "CSS",
      "HTML",
      "SQL",
      "SH",
      "YAML",
      "YML",
      "TOML",
    ].includes(extension)
  ) {
    return "i-code"
  }
  return "i-layers"
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Key under which manual sibling order is stored for a parent id. */
function orderKeyFor(parentId: string | null) {
  return parentId ?? "__root__"
}

/**
 * File-search predicate shared by the folder filter and the project-wide
 * tree filter: a lowercase term matches the node's name, its extension or
 * MIME type, or — for files with inline content — the content itself.
 */
function matchesNodeQuery(node: FileNode, term: string) {
  if (node.name.toLowerCase().includes(term)) return true
  if (node.kind !== "file") return false
  if (fileExtension(node.name).toLowerCase().includes(term)) return true
  if (node.mimeType.toLowerCase().includes(term)) return true
  return node.content?.toLowerCase().includes(term) ?? false
}

/** Wrap case-insensitive occurrences of `term` in <mark> for tree search hits. */
function HighlightedTreeName({ name, term }: { name: string; term?: string }) {
  const needle = term?.trim()
  if (!needle) return <>{name}</>
  const pattern = new RegExp(`(${escapeRegExp(needle)})`, "gi")
  return (
    <>
      {name.split(pattern).map((part, index) =>
        index % 2 === 1 ? (
          <mark key={index} className="fm-tree-mark">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  )
}

/**
 * Aggregate priority for folder git badges: the most attention-worthy
 * descendant status wins (conflicts first, deletions last).
 */
const GIT_STATUS_PRIORITY: FileGitStatus[] = [
  "conflicted",
  "modified",
  "added",
  "untracked",
  "renamed",
  "deleted",
]

/** Small VCS status chip ("M", "??", …) matching the file-tree decorations. */
function GitStatusBadge({ status, title }: { status: FileGitStatus; title?: string }) {
  const meta = GIT_STATUS_META[status]
  return (
    <span
      className={`fm-git-badge fm-git-badge--${status}`}
      style={{ color: meta.color }}
      title={title ?? meta.label}
      aria-label={`Git status: ${meta.label}`}
    >
      {meta.short}
    </span>
  )
}

function ownerInitials(owner: string) {
  return getAvatarInitials(owner)
}

function OwnerAvatar({ owner }: { owner: string }) {
  return (
    <span className="fm-owner-avatar" aria-hidden="true">
      {ownerInitials(owner)}
    </span>
  )
}

function downloadBlob(filename: string, content: string, mimeType = "application/octet-stream") {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function downloadNodes(nodes: FileNode[]) {
  const files = nodes.filter((node) => node.kind === "file")
  if (files.length === 1) {
    const file = files[0]
    downloadBlob(file.name, file.content ?? `Mock contents for ${file.name}\n`, file.mimeType)
    return
  }
  const manifest = {
    generatedAt: new Date().toISOString(),
    note: "Mock download manifest. Binary file contents are not stored in the session mock.",
    files: files.map((file) => ({
      name: file.name,
      type: fileTypeLabel(file),
      sizeBytes: file.sizeBytes,
      owner: file.owner,
      updatedAt: file.updatedAt,
    })),
  }
  downloadBlob("spindle-files.json", JSON.stringify(manifest, null, 2), "application/json")
}

function collectFolderOptions(
  nodes: FileNode[],
  parentId: string | null,
  prefix: string,
  excluded: Set<string>,
  options: { id: string | null; label: string }[],
) {
  nodes
    .filter((node) => node.kind === "folder" && node.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((folder) => {
      if (!excluded.has(folder.id)) {
        options.push({ id: folder.id, label: `${prefix}${folder.name}` })
        collectFolderOptions(nodes, folder.id, `${prefix}${folder.name} / `, excluded, options)
      }
    })
}

function FileActionDialog({
  dialog,
  files,
  onClose,
  onCreateFolder,
  onRename,
  onMove,
  onTrash,
}: {
  dialog: ActionDialogState
  files: FileNode[]
  onClose: () => void
  onCreateFolder: (
    parentId: string | null,
    name: string,
  ) => Promise<{ ok: boolean; error?: string }>
  onRename: (id: string, name: string) => Promise<{ ok: boolean; error?: string }>
  onMove: (ids: string[], targetFolderId: string | null) => Promise<{ ok: boolean; error?: string }>
  onTrash: (ids: string[]) => Promise<{ ok: boolean; error?: string }>
}) {
  const [name, setName] = useState(dialog.type === "rename" ? dialog.node.name : "")
  const [targetFolderId, setTargetFolderId] = useState("")
  const { toast } = useToast()
  const nameInputRef = useRef<HTMLInputElement>(null)
  const folderSelectRef = useRef<HTMLSelectElement>(null)

  const folderOptions = useMemo(() => {
    if (dialog.type !== "move") return []
    const excluded = new Set<string>()
    dialog.nodes.forEach((node) => {
      excluded.add(node.id)
      const collect = (parentId: string) => {
        files
          .filter((candidate) => candidate.kind === "folder" && candidate.parentId === parentId)
          .forEach((child) => {
            excluded.add(child.id)
            collect(child.id)
          })
      }
      if (node.kind === "folder") collect(node.id)
    })
    const options: { id: string | null; label: string }[] = [{ id: null, label: "Project root" }]
    collectFolderOptions(files, null, "", excluded, options)
    return options
  }, [dialog, files])

  const title =
    dialog.type === "create-folder"
      ? "New folder"
      : dialog.type === "rename"
        ? "Rename item"
        : dialog.type === "move"
          ? `Move ${dialog.nodes.length} item${dialog.nodes.length === 1 ? "" : "s"}`
          : `Move ${dialog.nodes.length} item${dialog.nodes.length === 1 ? "" : "s"} to trash`

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const result = await (dialog.type === "create-folder"
      ? onCreateFolder(dialog.parentId, name)
      : dialog.type === "rename"
        ? onRename(dialog.node.id, name)
        : dialog.type === "move"
          ? onMove(
              dialog.nodes.map((node) => node.id),
              targetFolderId === "" ? null : targetFolderId,
            )
          : onTrash(dialog.nodes.map((node) => node.id)))
    if (!result.ok) {
      toast({ variant: "error", title: result.error ?? "The action failed." })
      return
    }
    onClose()
  }

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="app-dialog-overlay" />
        <DialogPrimitive.Content
          className="app-dialog-content"
          data-slot="dialog-content"
          aria-modal="true"
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            // Focus the primary field for each dialog variant; Radix's default
            // would land on the first button instead.
            const target =
              dialog.type === "move"
                ? folderSelectRef.current
                : dialog.type === "trash"
                  ? null
                  : nameInputRef.current
            if (target) {
              event.preventDefault()
              target.focus()
            }
          }}
        >
          <form className="app-dialog" onSubmit={submit}>
            <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
            {dialog.type === "trash" ? (
              <p>
                This removes {dialog.nodes.length} selected item
                {dialog.nodes.length === 1 ? "" : "s"} from the mock project store. Folders include
                their contents.
              </p>
            ) : null}
            {dialog.type === "create-folder" || dialog.type === "rename" ? (
              <div className="app-field">
                <label htmlFor="file-dialog-name">Name</label>
                <input
                  ref={nameInputRef}
                  id="file-dialog-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </div>
            ) : null}
            {dialog.type === "move" ? (
              <div className="app-field">
                <label htmlFor="file-dialog-folder">Destination</label>
                <select
                  ref={folderSelectRef}
                  id="file-dialog-folder"
                  value={targetFolderId ?? ""}
                  onChange={(event) => setTargetFolderId(event.target.value)}
                >
                  <option value="">Project root</option>
                  {folderOptions
                    .filter((option) => option.id !== null)
                    .map((option) => (
                      <option key={option.id} value={option.id ?? ""}>
                        {option.label}
                      </option>
                    ))}
                </select>
              </div>
            ) : null}
            <div className="app-dialog-actions">
              <button type="button" className="fm-btn" onClick={onClose}>
                Cancel
              </button>
              <button
                type="submit"
                className={`fm-btn ${dialog.type === "trash" ? "fm-btn--danger" : "fm-btn--solid"}`}
              >
                {dialog.type === "trash" ? "Move to trash" : "Save"}
              </button>
            </div>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

export function FilesScreen({
  projectId,
  path,
  initialPreviewId,
}: {
  projectId: string
  path: string[]
  /** File id from the `?preview=` deep link; opens the preview drawer once
   * the workspace data resolves. */
  initialPreviewId?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const filesQuery = useFilesWorkspace(projectId)
  const { data, actions } = filesQuery
  // Workspace roster for the share dialog's member picker, and the
  // localStorage-backed share grants for this project.
  const workspaceMembers = useWorkspaceMembers()
  const fileShares = useFileShares(projectId)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // Roving tabindex target for the folder tree ("root" or a folder id).
  const [activeTreeKey, setActiveTreeKey] = useState("root")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({
    key: "name",
    direction: "asc",
  })
  const [query, setQuery] = useState("")
  // Folder-tree filter: independent of the current-folder `query` above, it
  // searches every file and folder in the project.
  const [treeQuery, setTreeQuery] = useState("")
  const [view, setView] = useState<ViewMode>("list")
  const [showGitChanges, setShowGitChanges] = useState(false)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [previewFileId, setPreviewFileId] = useState<string | null>(initialPreviewId ?? null)
  // Uploads that just finished keep a brief "Uploaded" row so the success
  // state is visible before the row auto-dismisses (the file itself lands in
  // the listing). Only uploads this screen watched leave the active states
  // qualify — pre-existing `done` history never flashes rows on mount.
  const [doneUploads, setDoneUploads] = useState<FileUpload[]>([])
  const watchedUploadIds = useRef<Set<string>>(new Set())
  const celebratedUploadIds = useRef<Set<string>>(new Set())
  const { toast } = useToast()
  const [isDragging, setIsDragging] = useState(false)
  // True while the in-flight drag carries OS files ("Files" transfer type),
  // distinguishing desktop file drops from in-app node moves so the upload
  // drop overlay only appears for real file drags.
  const [isFileDrag, setIsFileDrag] = useState(false)
  const [dropTarget, setDropTarget] = useState<string | null | false>(false)
  // Manual sibling-order overrides produced by drag-and-drop reordering,
  // keyed by parent id ("__root__" for top-level nodes). The workspace API
  // has no reorder endpoint, so the order is local mock state for the session.
  const [siblingOrder, setSiblingOrder] = useState<Record<string, string[]>>({})
  // Before/after drop hint shown while a node hovers a sibling row.
  const [reorderHint, setReorderHint] = useState<{
    targetId: string
    position: "before" | "after"
  } | null>(null)
  // Preview surface: deep links and row activation use the drawer; the row
  // "Preview" action opens the same content in a centered modal.
  const [previewVariant, setPreviewVariant] = useState<"drawer" | "modal">("drawer")
  const dragDepth = useRef(0)
  // Ids of the nodes in the in-flight HTML5 drag, so tree drag-over can
  // reject targets that cannot accept them (self, descendants) before drop.
  const activeDragIdsRef = useRef<string[]>([])
  const uploadInput = useRef<HTMLInputElement>(null)
  const treeRef = useRef<HTMLDivElement>(null)
  // The aside card is the tree's scroll container (bounded by max-height).
  const treePaneRef = useRef<HTMLElement>(null)
  const treeViewportRef = useRef<HTMLDivElement>(null)
  // Key of a treeitem that still needs DOM focus. Set by keyboard navigation
  // so the focus effect can scroll the row into the rendered window first;
  // stays null on mount so the tree never steals focus on load.
  const pendingTreeFocus = useRef<string | null>(null)
  const [treeScrollTop, setTreeScrollTop] = useState(0)
  const [treeViewportHeight, setTreeViewportHeight] = useState(TREE_VIEWPORT_FALLBACK)
  const [treeViewportTop, setTreeViewportTop] = useState(0)
  const [treeRowPitch, setTreeRowPitch] = useState(TREE_ROW_PITCH_FALLBACK)
  // Typeahead buffer for the folder tree: printable characters accumulate
  // for a short window, then reset (ARIA treeview type-ahead).
  const treeTypeahead = useRef<{ buffer: string; timeout?: ReturnType<typeof setTimeout> }>({
    buffer: "",
  })

  const isRoot = path.length === 0
  const currentFolder = useMemo(
    () => findFolderByPath(data.files, path),
    [data.files, path.join("/")],
  )
  const currentParentId = isRoot ? null : (currentFolder?.id ?? null)
  const folderMissing = !isRoot && !currentFolder

  useEffect(() => {
    setSelectedIds(new Set())
    setLastSelectedId(null)
  }, [path.join("/")])

  // Keep the drawer in sync when the `?preview=` search param changes during
  // client-side navigation (the prop may update without a remount).
  useEffect(() => {
    setPreviewFileId(initialPreviewId ?? null)
    // Deep links always open the drawer variant.
    setPreviewVariant("drawer")
  }, [initialPreviewId])

  // Mirror the open preview into the `?preview=` search param so refreshes and
  // shared links keep the drawer open. `router.replace` avoids filling the
  // history stack; the current param is compared first so a `?preview=` deep
  // link does not trigger a redundant navigation.
  useEffect(() => {
    if ((searchParams.get("preview") ?? null) === previewFileId) return
    const next = new URLSearchParams(searchParams.toString())
    if (previewFileId) next.set("preview", previewFileId)
    else next.delete("preview")
    const query = next.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }, [previewFileId, pathname, router, searchParams])

  useEffect(() => {
    if (!currentFolder || currentFolder.id === "root") return
    const ancestorIds: string[] = []
    let parentId: string | null = null
    fileNodePath(data.files, currentFolder)
      .slice(0, -1)
      .forEach((part) => {
        const match = data.files.find(
          (node) => node.kind === "folder" && node.parentId === parentId && node.name === part,
        )
        if (match) {
          ancestorIds.push(match.id)
          parentId = match.id
        }
      })
    setExpanded((current) => {
      const next = new Set(current)
      ancestorIds.forEach((id) => next.add(id))
      return next
    })
  }, [currentFolder?.id, data.files])

  // Watch the folder's uploads so a `done` transition can be celebrated with
  // a short-lived success row; ids are remembered across folders so an upload
  // finishing while the user is elsewhere still shows "Uploaded" on return.
  useEffect(() => {
    const folderUploadsAll = data.uploads.filter((upload) => upload.parentId === currentParentId)
    folderUploadsAll
      .filter((upload) => upload.status !== "done")
      .forEach((upload) => watchedUploadIds.current.add(upload.id))
    const freshlyDone = folderUploadsAll.filter(
      (upload) =>
        upload.status === "done" &&
        watchedUploadIds.current.has(upload.id) &&
        !celebratedUploadIds.current.has(upload.id),
    )
    if (freshlyDone.length === 0) return
    freshlyDone.forEach((upload) => celebratedUploadIds.current.add(upload.id))
    setDoneUploads((current) => [...current, ...freshlyDone])
  }, [data.uploads, currentParentId])

  // Auto-dismiss the oldest "Uploaded" row once its visibility window ends.
  useEffect(() => {
    if (doneUploads.length === 0) return
    const timer = window.setTimeout(
      () => setDoneUploads((current) => current.slice(1)),
      UPLOAD_DONE_VISIBLE_MS,
    )
    return () => window.clearTimeout(timer)
  }, [doneUploads])

  /**
   * Sort same-parent siblings by the manual drag order when one exists for
   * that parent; nodes missing from the stored order (added later) fall back
   * to name order after the ranked ones. Input is expected name-sorted.
   */
  const orderSiblings = useCallback(
    (nodes: FileNode[], parentId: string | null) => {
      const order = siblingOrder[orderKeyFor(parentId)]
      if (!order || nodes.length < 2) return nodes
      const rank = new Map(order.map((id, index) => [id, index] as const))
      return [...nodes].sort((a, b) => {
        const ra = rank.get(a.id)
        const rb = rank.get(b.id)
        if (ra === undefined && rb === undefined) return a.name.localeCompare(b.name)
        if (ra === undefined) return 1
        if (rb === undefined) return -1
        return ra - rb || a.name.localeCompare(b.name)
      })
    },
    [siblingOrder],
  )

  const children = useMemo(() => {
    if (folderMissing || (!currentParentId && !isRoot)) return []
    const normalized = query.trim().toLowerCase()
    // Manual drag order applies to the default name sort; explicit sorts by
    // other keys take precedence over it.
    const manualRank =
      sort.key === "name" && sort.direction === "asc"
        ? new Map(
            (siblingOrder[orderKeyFor(currentParentId)] ?? []).map(
              (id, index) => [id, index] as const,
            ),
          )
        : null
    return childNodes(data.files, currentParentId)
      .filter((node) => !normalized || matchesNodeQuery(node, normalized))
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1
        const direction = sort.direction === "asc" ? 1 : -1
        if (sort.key === "name") {
          if (manualRank && (manualRank.has(a.id) || manualRank.has(b.id))) {
            const ra = manualRank.get(a.id)
            const rb = manualRank.get(b.id)
            if (ra === undefined) return 1
            if (rb === undefined) return -1
            if (ra !== rb) return ra - rb
          }
          return a.name.localeCompare(b.name) * direction
        }
        if (sort.key === "type") return fileTypeLabel(a).localeCompare(fileTypeLabel(b)) * direction
        if (sort.key === "owner") return a.owner.localeCompare(b.owner) * direction
        if (sort.key === "updated") return a.updatedAt.localeCompare(b.updatedAt) * direction
        return (a.sizeBytes - b.sizeBytes) * direction
      })
  }, [currentParentId, folderMissing, isRoot, query, sort, data.files, siblingOrder])

  const visibleIds = useMemo(() => children.map((node) => node.id), [children])

  /**
   * Folder-tree filter. Matching files and folders stay visible together with
   * every ancestor folder of a match; ancestors are force-expanded while the
   * filter is active. The user's own `expanded` set is never mutated, so
   * clearing the filter restores the previous expansion state exactly.
   */
  const treeFilter = useMemo<TreeFilterState | null>(() => {
    const term = treeQuery.trim().toLowerCase()
    if (!term) return null
    const matches = new Set<string>()
    const ancestors = new Set<string>()
    data.files.forEach((node) => {
      if (!matchesNodeQuery(node, term)) return
      matches.add(node.id)
      let parentId = node.parentId
      while (parentId) {
        ancestors.add(parentId)
        parentId = data.files.find((candidate) => candidate.id === parentId)?.parentId ?? null
      }
    })
    return { term, matches, ancestors, shown: new Set([...matches, ...ancestors]) }
  }, [data.files, treeQuery])

  const selectedNodes = useMemo(
    () => data.files.filter((node) => selectedIds.has(node.id)),
    [selectedIds, data.files],
  )
  const previewFile = useMemo(() => {
    if (!previewFileId) return null
    const node = data.files.find((candidate) => candidate.id === previewFileId)
    return node?.kind === "file" ? node : null
  }, [previewFileId, data.files])
  const storage = data.storage
  const storagePercent =
    storage.limitBytes > 0 ? Math.min(100, (storage.usedBytes / storage.limitBytes) * 100) : 0
  const folderUploads = data.uploads.filter(
    (upload) => upload.parentId === currentParentId && upload.status !== "done",
  )
  const visibleDoneUploads = doneUploads.filter((upload) => upload.parentId === currentParentId)
  const queueUploads = [...folderUploads, ...visibleDoneUploads]
  const queueActiveCount = folderUploads.filter(
    (upload) => upload.status === "queued" || upload.status === "uploading",
  ).length
  const queueFailedCount = folderUploads.filter((upload) => upload.status === "failed").length
  // Batch progress weighted by file size so large uploads dominate the total.
  const queueTotalBytes = queueUploads.reduce((total, upload) => total + upload.sizeBytes, 0)
  const queueProgress =
    queueTotalBytes > 0
      ? queueUploads.reduce((total, upload) => total + upload.progress * upload.sizeBytes, 0) /
        queueTotalBytes
      : 0
  const projectBase = `/projects/${projectId}`
  const gitInfo = data.git

  /**
   * Effective git status per node id. Files carry their own `gitStatus`; a
   * folder aggregates its descendants — the most severe kind wins and `count`
   * tracks how many nodes at or below it are dirty.
   */
  const gitStatusById = useMemo(() => {
    const map = new Map<string, { kind: FileGitStatus; count: number }>()
    const childrenOf = new Map<string, FileNode[]>()
    data.files.forEach((node) => {
      if (!node.parentId) return
      const siblings = childrenOf.get(node.parentId)
      if (siblings) siblings.push(node)
      else childrenOf.set(node.parentId, [node])
    })
    const visit = (node: FileNode): { kind?: FileGitStatus; count: number } => {
      let kind = node.gitStatus
      let count = node.gitStatus ? 1 : 0
      for (const child of childrenOf.get(node.id) ?? []) {
        const sub = visit(child)
        count += sub.count
        if (
          sub.kind &&
          (!kind || GIT_STATUS_PRIORITY.indexOf(sub.kind) < GIT_STATUS_PRIORITY.indexOf(kind))
        ) {
          kind = sub.kind
        }
      }
      if (kind) map.set(node.id, { kind, count })
      return { kind, count }
    }
    data.files.filter((node) => node.parentId === null).forEach(visit)
    return map
  }, [data.files])

  /** Flat list of dirty nodes for the changes panel (own status only; folders aggregate into badges). */
  const gitChanges = useMemo(
    () =>
      data.files
        .filter((node) => node.gitStatus)
        .sort(
          (a, b) =>
            GIT_STATUS_PRIORITY.indexOf(a.gitStatus!) - GIT_STATUS_PRIORITY.indexOf(b.gitStatus!) ||
            a.name.localeCompare(b.name),
        ),
    [data.files],
  )

  /** Git badge for a tree row / list row / grid card; null when clean. */
  const gitBadge = (node: FileNode) => {
    const info = gitStatusById.get(node.id)
    if (!info) return null
    const meta = GIT_STATUS_META[info.kind]
    const title =
      node.kind === "folder"
        ? `${meta.label} — ${info.count} changed item${info.count === 1 ? "" : "s"} inside`
        : meta.label
    return <GitStatusBadge status={info.kind} title={title} />
  }

  const navigateToFolder = (folder: FileNode | null, segments: string[] = path) => {
    const href = segments.length
      ? `${projectBase}/files/${segments.map(encodeURIComponent).join("/")}`
      : `${projectBase}/files`
    router.push(href)
    if (folder) {
      setExpanded((current) => new Set(current).add(folder.id))
    }
  }

  const openNode = (node: FileNode) => {
    if (node.kind === "folder") {
      const segments = fileNodePath(data.files, node)
      navigateToFolder(node, segments)
      return
    }
    setSelectedIds(new Set([node.id]))
    setLastSelectedId(node.id)
    setPreviewVariant("drawer")
    setPreviewFileId(node.id)
  }

  /** Visible tree rows (root + expanded folders/files) in display order. */
  const treeEntries = useMemo<FolderTreeEntry[]>(() => {
    // Inlined copies of `visibleTreeChildren`/`isTreeExpanded` so the memo deps
    // stay on the reactive inputs rather than per-render helpers.
    const visibleChildren = (parentId: string | null) => {
      const nodes = orderSiblings(childNodes(data.files, parentId), parentId)
      if (!treeFilter) return nodes.filter((node) => node.kind === "folder")
      return nodes.filter((node) => treeFilter.shown.has(node.id))
    }
    const entries: FolderTreeEntry[] = [
      {
        key: "root",
        folder: null,
        parentKey: null,
        expanded: true,
        hasChildren: visibleChildren(null).length > 0,
        depth: 0,
      },
    ]
    const walk = (parentId: string | null, parentKey: string, depth: number) => {
      visibleChildren(parentId).forEach((node) => {
        const isFolder = node.kind === "folder"
        const isExpanded =
          isFolder && (expanded.has(node.id) || (treeFilter?.ancestors.has(node.id) ?? false))
        entries.push({
          key: node.id,
          folder: node,
          parentKey,
          expanded: isExpanded,
          hasChildren: visibleChildren(node.id).length > 0,
          depth,
        })
        if (isExpanded) walk(node.id, node.id, depth + 1)
      })
    }
    walk(null, "root", 0)
    return entries
  }, [data.files, expanded, treeFilter, orderSiblings])

  const rovingTreeKey = treeEntries.some((entry) => entry.key === activeTreeKey)
    ? activeTreeKey
    : "root"

  // Virtualization window: entries[0] is the static "Project root" row that
  // always renders above the positioned row layer; the rest are windowed by
  // the aside's scroll position with a fixed row pitch and overscan.
  const treeWindowCount = Math.max(0, treeEntries.length - 1)
  const treeScrollOffset = treeScrollTop - treeViewportTop
  const treeFirstVisible = Math.min(
    treeWindowCount,
    Math.max(0, Math.floor(treeScrollOffset / treeRowPitch)),
  )
  const treeLastVisible = Math.min(
    treeWindowCount,
    Math.max(treeFirstVisible, Math.ceil((treeScrollOffset + treeViewportHeight) / treeRowPitch)),
  )
  const treeRangeStart = Math.max(0, treeFirstVisible - TREE_OVERSCAN)
  const treeRangeEnd = Math.min(treeWindowCount, treeLastVisible + TREE_OVERSCAN)
  const visibleTreeEntries = treeEntries.slice(1 + treeRangeStart, 1 + treeRangeEnd)

  // The roving tab stop must stay mounted even when it sits outside the
  // scroll window (e.g. after collapsing an ancestor), so render it as an
  // extra row at its true offset when the slice does not already include it.
  const treeFocusWindowIndex = treeEntries.findIndex((entry) => entry.key === rovingTreeKey) - 1
  const treeRovingEntry =
    treeFocusWindowIndex >= 0 &&
    (treeFocusWindowIndex < treeRangeStart || treeFocusWindowIndex >= treeRangeEnd)
      ? treeEntries[treeFocusWindowIndex + 1]
      : null

  // Measure the tree's geometry after render: the row pitch comes from a real
  // row (jsdom reports 0, keeping the fallback), the viewport height from the
  // aside, and the viewport's offset within the aside's scroll content.
  useEffect(() => {
    const pane = treePaneRef.current
    const viewport = treeViewportRef.current
    if (!pane || !viewport) return
    const measure = () => {
      const row = treeRef.current?.querySelector<HTMLElement>(".fm-tree-item")
      if (row && row.offsetHeight > 0) {
        setTreeRowPitch(row.offsetHeight + 2)
      }
      setTreeViewportHeight(pane.clientHeight || TREE_VIEWPORT_FALLBACK)
      setTreeViewportTop(
        viewport.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop,
      )
      setTreeScrollTop(pane.scrollTop)
    }
    measure()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(measure)
    observer.observe(pane)
    return () => observer.disconnect()
  }, [treeEntries])

  // Move DOM focus to the treeitem selected via keyboard navigation. When the
  // row sits outside the rendered window, scroll it into view instead; the
  // resulting scroll re-render finds the element and focuses it on the next
  // pass. `pendingTreeFocus` stays null on mount so the tree never grabs
  // focus on load. Only rows inside the window count as rendered — the extra
  // offscreen roving-tab-stop row must not receive focus directly.
  useEffect(() => {
    const key = pendingTreeFocus.current
    if (!key) return
    const index = treeEntries.findIndex((entry) => entry.key === key)
    if (index < 0) {
      pendingTreeFocus.current = null
      return
    }
    const inWindow = index === 0 || (index - 1 >= treeRangeStart && index - 1 < treeRangeEnd)
    const item = inWindow
      ? treeRef.current?.querySelector<HTMLElement>(`[data-tree-key="${key}"]`)
      : null
    if (item) {
      pendingTreeFocus.current = null
      item.focus()
      return
    }
    const pane = treePaneRef.current
    if (!pane) return
    // entries[0] is the static "Project root" row above the window; windowed
    // rows are offset by treeViewportTop inside the aside's scroll content.
    const rowTop =
      index === 0 ? treeViewportTop - treeRowPitch : treeViewportTop + (index - 1) * treeRowPitch
    const rowBottom = rowTop + treeRowPitch
    const viewportHeight = pane.clientHeight || TREE_VIEWPORT_FALLBACK
    const viewBottom = pane.scrollTop + viewportHeight
    if (rowTop < pane.scrollTop) {
      pane.scrollTop = Math.max(0, rowTop - treeRowPitch)
    } else if (rowBottom > viewBottom) {
      pane.scrollTop = rowBottom - viewportHeight + treeRowPitch
    }
  }, [
    activeTreeKey,
    treeEntries,
    treeRangeStart,
    treeRangeEnd,
    treeRowPitch,
    treeScrollTop,
    treeViewportTop,
  ])

  const focusTreeEntry = (key: string) => {
    pendingTreeFocus.current = key
    setActiveTreeKey(key)
  }

  const toggleFolderExpanded = (folderId: string, expand: boolean) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (expand) next.add(folderId)
      else next.delete(folderId)
      return next
    })
  }

  const handleTreeKeyDown = (event: React.KeyboardEvent<HTMLElement>, key: string) => {
    const target = event.target as HTMLElement
    const isActivation = event.key === "Enter" || event.key === " "
    // Inner buttons keep their own activation; only the treeitem itself
    // handles Enter/Space so a click-focused button does not double-fire.
    if (isActivation && target !== event.currentTarget) return
    // Shift+F10 / ContextMenu key: the focusable element is this treeitem,
    // but the Radix context-menu trigger is the inner .fm-tree-item row, so
    // keydown never reaches the trigger's own keyboard shim. Forward the key
    // as a synthetic contextmenu on that trigger (its first .fm-tree-item
    // descendant is always this row — treeitems are flattened siblings, so
    // no nested rows can be picked up). Inner buttons already reach the
    // trigger via bubbling, so only handle the treeitem itself.
    if (
      target === event.currentTarget &&
      (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))
    ) {
      event.preventDefault()
      const trigger = event.currentTarget.querySelector<HTMLElement>(".fm-tree-item")
      const anchor = trigger ?? event.currentTarget
      const rect = anchor.getBoundingClientRect()
      anchor.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        }),
      )
      return
    }
    const index = treeEntries.findIndex((entry) => entry.key === key)
    if (index < 0) return
    const entry = treeEntries[index]

    switch (event.key) {
      case "ArrowDown": {
        const next = treeEntries[index + 1]
        if (next) {
          event.preventDefault()
          focusTreeEntry(next.key)
        }
        break
      }
      case "ArrowUp": {
        const previous = treeEntries[index - 1]
        if (previous) {
          event.preventDefault()
          focusTreeEntry(previous.key)
        }
        break
      }
      case "ArrowRight": {
        event.preventDefault()
        if (!entry.folder || !entry.hasChildren) break
        if (!entry.expanded) {
          toggleFolderExpanded(entry.folder.id, true)
          break
        }
        const firstChild = treeEntries[index + 1]
        if (firstChild?.parentKey === key) focusTreeEntry(firstChild.key)
        break
      }
      case "ArrowLeft": {
        event.preventDefault()
        // Ancestors force-expanded by the tree filter stay expanded no matter
        // what the user's `expanded` set says, so collapsing them would be a
        // no-op that traps focus. Treat them as non-collapsible and move
        // focus to the parent instead.
        const filterForced =
          entry.folder !== null && (treeFilter?.ancestors.has(entry.folder.id) ?? false)
        if (entry.folder && entry.expanded && !filterForced) {
          toggleFolderExpanded(entry.folder.id, false)
        } else if (entry.parentKey) {
          focusTreeEntry(entry.parentKey)
        }
        break
      }
      case "Home": {
        const first = treeEntries[0]
        if (first) {
          event.preventDefault()
          focusTreeEntry(first.key)
        }
        break
      }
      case "End": {
        const last = treeEntries[treeEntries.length - 1]
        if (last) {
          event.preventDefault()
          focusTreeEntry(last.key)
        }
        break
      }
      case "Enter":
      case " ": {
        event.preventDefault()
        if (entry.folder?.kind === "file") {
          // File rows only appear while the tree filter is active.
          openNode(entry.folder)
        } else if (entry.folder) {
          navigateToFolder(entry.folder, fileNodePath(data.files, entry.folder))
        } else {
          navigateToFolder(null, [])
        }
        break
      }
      default: {
        // Type-ahead (ARIA treeview): printable characters accumulate into a
        // short-lived buffer and focus moves to the next visible treeitem
        // whose label starts with the buffer, wrapping around. Modifier
        // combos (Ctrl/Alt/Meta) are left to the browser.
        if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) {
          break
        }
        event.preventDefault()
        const state = treeTypeahead.current
        state.buffer += event.key.toLowerCase()
        clearTimeout(state.timeout)
        state.timeout = setTimeout(() => {
          state.buffer = ""
        }, 750)
        const label = (candidate: FolderTreeEntry) =>
          (candidate.folder?.name ?? "Project root").toLowerCase()
        for (let offset = 1; offset <= treeEntries.length; offset += 1) {
          const candidate = treeEntries[(index + offset) % treeEntries.length]
          if (label(candidate).startsWith(state.buffer)) {
            focusTreeEntry(candidate.key)
            break
          }
        }
        break
      }
    }
  }

  const rangeSelection = (id: string) => {
    if (!lastSelectedId) return [id]
    const start = visibleIds.indexOf(lastSelectedId)
    const end = visibleIds.indexOf(id)
    if (start < 0 || end < 0) return [id]
    const [from, to] = start < end ? [start, end] : [end, start]
    return visibleIds.slice(from, to + 1)
  }

  const handleRowSelect = (id: string, event: ReactMouseEvent) => {
    if (event.metaKey || event.ctrlKey) {
      setSelectedIds((current) => {
        const next = new Set(current)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    } else if (event.shiftKey) {
      setSelectedIds((current) => new Set([...current, ...rangeSelection(id)]))
    } else {
      setSelectedIds(new Set([id]))
    }
    setLastSelectedId(id)
  }

  const handleCheckboxChange = (id: string, event: ChangeEvent<HTMLInputElement>) => {
    const mouse = event.nativeEvent as unknown as MouseEvent
    if (mouse.shiftKey) {
      setSelectedIds((current) => new Set([...current, ...rangeSelection(id)]))
    } else {
      setSelectedIds((current) => {
        const next = new Set(current)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    }
    setLastSelectedId(id)
  }

  const toggleSort = (key: SortKey) => {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }))
  }

  const addFiles = async (files: FileList | File[], parentId: string | null = currentParentId) => {
    const inputs: UploadFileInput[] = Array.from(files).map((file) => ({
      name: file.name,
      sizeBytes: file.size,
      mimeType: file.type || "application/octet-stream",
    }))
    const result = await actions.addUploads(parentId, inputs)
    if (!result.ok) {
      toast({ variant: "error", title: result.error })
      return
    }
    if (result.rejected.length > 0) {
      toast({
        variant: "warning",
        title: result.rejected.map((item) => `${item.name}: ${item.error}`).join(" "),
      })
    } else if (result.accepted.length > 0) {
      toast({
        variant: "success",
        title: `${result.accepted.length} upload${result.accepted.length === 1 ? "" : "s"} queued.`,
      })
    }
  }

  const onDrop = (event: DragEvent<HTMLElement>) => {
    if (!acceptDrop(event)) return
    dragDepth.current = 0
    setIsDragging(false)
    setIsFileDrag(false)
    setDropTarget(false)
    const ids = draggedNodeIds(event)
    if (ids.length > 0) {
      const movable = movableNodeIds(ids, currentParentId)
      if (movable.length > 0) void moveNodes(movable, currentParentId)
      return
    }
    if (event.dataTransfer.files.length > 0) void addFiles(event.dataTransfer.files)
  }

  const onDragEnter = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    dragDepth.current += 1
    setIsDragging(true)
    setIsFileDrag(event.dataTransfer.types.includes("Files"))
  }

  const onDragLeave = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) {
      setIsDragging(false)
      setIsFileDrag(false)
    }
  }

  const closeDialog = () => setDialog(null)

  const createFolder = async (parentId: string | null, name: string) => {
    const result = await actions.createFolder(parentId, name)
    if (result.ok) {
      toast({ variant: "success", title: `Folder "${name.trim()}" created.` })
    }
    return result
  }

  const renameNode = async (id: string, name: string) => {
    const result = await actions.renameNode(id, name)
    if (result.ok) toast({ variant: "success", title: "Item renamed." })
    return result
  }

  const moveNodes = async (ids: string[], targetFolderId: string | null) => {
    const result = await actions.moveNodes(ids, targetFolderId)
    setSelectedIds(new Set())
    if (result.ok) {
      toast({ variant: "success", title: "Items moved." })
    } else {
      toast({ variant: "error", title: result.error })
    }
    return result
  }

  /** Copy the project-relative paths of the given nodes to the clipboard. */
  const copyNodePaths = async (nodes: FileNode[]) => {
    const text = nodes.map((node) => fileNodePath(data.files, node).join(" / ")).join("\n")
    try {
      await navigator.clipboard.writeText(text)
      toast({
        variant: "success",
        title: nodes.length === 1 ? "Path copied." : `${nodes.length} paths copied.`,
      })
    } catch {
      toast({ variant: "error", title: "Couldn't copy to clipboard." })
    }
  }

  const trashNodes = async (ids: string[]) => {
    const result = await actions.trashNodes(ids)
    if (result.ok) {
      setSelectedIds(new Set())
      setLastSelectedId(null)
      toast({
        variant: "success",
        title: `${ids.length} item${ids.length === 1 ? "" : "s"} moved to trash.`,
      })
    }
    return result
  }

  /** Ids of every ancestor folder of `folderId` (excluding the folder itself). */
  const ancestorFolderIds = (folderId: string): Set<string> => {
    const ids = new Set<string>()
    let parentId = data.files.find((node) => node.id === folderId)?.parentId ?? null
    while (parentId) {
      ids.add(parentId)
      parentId = data.files.find((node) => node.id === parentId)?.parentId ?? null
    }
    return ids
  }

  /**
   * Drop targets accept two drag kinds: existing file nodes (moved via
   * `moveNodes`) and OS files (queued as uploads into the target folder).
   * Folder targets are filtered so a folder cannot be dropped onto itself or
   * into one of its descendants (i.e. the dragged folder appears among the
   * target's ancestors). Dropping onto an ancestor folder is a valid move-up
   * reparent and is allowed.
   */
  const movableNodeIds = (ids: string[], targetFolderId: string | null): string[] => {
    if (targetFolderId === null) return ids
    const blocked = new Set([targetFolderId, ...ancestorFolderIds(targetFolderId)])
    return ids.filter((id) => !blocked.has(id))
  }

  const acceptDrop = (event: DragEvent<HTMLElement>) => {
    const types: readonly string[] = event.dataTransfer.types
    if (!types.includes(FILES_NODE_DRAG_TYPE) && !types.includes("Files")) return false
    event.preventDefault()
    event.dataTransfer.dropEffect = types.includes(FILES_NODE_DRAG_TYPE) ? "move" : "copy"
    return true
  }

  const handleDropOnFolder = (targetFolderId: string | null, event: DragEvent<HTMLElement>) => {
    if (!acceptDrop(event)) return
    setDropTarget(false)
    const ids = draggedNodeIds(event)
    if (ids.length > 0) {
      const movable = movableNodeIds(ids, targetFolderId)
      if (movable.length > 0) void moveNodes(movable, targetFolderId)
      return
    }
    if (event.dataTransfer.files.length > 0) {
      void addFiles(event.dataTransfer.files, targetFolderId)
    }
  }

  const folderDropProps = (folderId: string | null) => ({
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!acceptDrop(event)) return
      // While a node drag is in flight, only highlight folders that can
      // actually accept the dragged ids; invalid targets get dropEffect
      // "none" so the browser shows the no-drop cursor.
      if (
        activeDragIdsRef.current.length > 0 &&
        movableNodeIds(activeDragIdsRef.current, folderId).length === 0
      ) {
        event.dataTransfer.dropEffect = "none"
        setDropTarget((current) => (current === folderId ? false : current))
        return
      }
      setDropTarget(folderId)
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      const next = event.relatedTarget as Node | null
      if (next && event.currentTarget.contains(next)) return
      setDropTarget((current) => (current === folderId ? false : current))
    },
    onDrop: (event: DragEvent<HTMLElement>) => handleDropOnFolder(folderId, event),
  })

  const startNodeDrag = (node: FileNode) => (event: DragEvent<HTMLElement>) => {
    const ids =
      selectedIds.has(node.id) && selectedIds.size > 1 ? Array.from(selectedIds) : [node.id]
    activeDragIdsRef.current = ids
    event.dataTransfer.setData(FILES_NODE_DRAG_TYPE, JSON.stringify(ids))
    event.dataTransfer.setData("text/plain", node.name)
    event.dataTransfer.effectAllowed = "move"
  }

  const endNodeDrag = () => {
    activeDragIdsRef.current = []
    setDropTarget(false)
    setReorderHint(null)
  }

  /**
   * The single dragged node when it can reorder among `target`'s siblings —
   * i.e. a one-node drag whose parent matches the target's. Multi-node drags
   * and cross-folder drags return null and keep the move-into-folder behavior.
   */
  const reorderableDrag = (target: FileNode) => {
    const ids = activeDragIdsRef.current
    if (ids.length !== 1) return null
    const dragged = data.files.find((node) => node.id === ids[0])
    if (!dragged || dragged.id === target.id) return null
    if (dragged.parentId !== target.parentId) return null
    return dragged
  }

  /**
   * "before"/"after" drop position from the pointer's vertical position on a
   * row. `edge` reserves the middle band (e.g. 0.25 keeps the center third of
   * a folder row for move-inside drops); 0.5 splits the row in half.
   */
  const dropPositionOn = (
    event: DragEvent<HTMLElement>,
    edge = 0.5,
  ): "before" | "after" | null => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.height <= 0) return null
    const ratio = (event.clientY - rect.top) / rect.height
    if (ratio < edge) return "before"
    if (ratio > 1 - edge) return "after"
    return null
  }

  /**
   * Commit a sibling reorder: insert `draggedId` before/after `targetId` in
   * their shared parent's manual order. Order is local session state (the
   * workspace API has no reorder endpoint) and shows under the default
   * name sort.
   */
  const reorderNode = (draggedId: string, targetId: string, position: "before" | "after") => {
    const dragged = data.files.find((node) => node.id === draggedId)
    const target = data.files.find((node) => node.id === targetId)
    if (!dragged || !target || dragged.id === target.id) return
    if (dragged.parentId !== target.parentId) return
    const siblings = orderSiblings(childNodes(data.files, dragged.parentId), dragged.parentId)
      .map((node) => node.id)
      .filter((id) => id !== draggedId)
    const targetIndex = siblings.indexOf(targetId)
    if (targetIndex < 0) return
    siblings.splice(position === "before" ? targetIndex : targetIndex + 1, 0, draggedId)
    setSiblingOrder((current) => ({
      ...current,
      [orderKeyFor(dragged.parentId)]: siblings,
    }))
    setSelectedIds(new Set([draggedId]))
    setLastSelectedId(draggedId)
    toast({
      variant: "success",
      title: `Moved "${dragged.name}" ${position} "${target.name}".`,
    })
  }

  /** Inline indicator line for the row currently showing a reorder hint. */
  const reorderHintStyle = (targetId: string): React.CSSProperties | undefined => {
    if (reorderHint?.targetId !== targetId) return undefined
    return {
      boxShadow:
        reorderHint.position === "before"
          ? "inset 0 2px 0 var(--app-accent)"
          : "inset 0 -2px 0 var(--app-accent)",
    }
  }

  /**
   * Drag-over/drop handlers turning a node drag over a sibling row into a
   * before/after reorder. Drops that are not reorderable (multi-select,
   * different folder, OS files) are left alone so they keep bubbling to the
   * pane-level move/upload handlers.
   */
  const siblingReorderProps = (target: FileNode) => ({
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!event.dataTransfer.types.includes(FILES_NODE_DRAG_TYPE)) return
      if (!reorderableDrag(target)) {
        setReorderHint((current) => (current?.targetId === target.id ? null : current))
        return
      }
      const position = dropPositionOn(event)
      if (!position) return
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = "move"
      setReorderHint({ targetId: target.id, position })
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      const next = event.relatedTarget as Node | null
      if (next && event.currentTarget.contains(next)) return
      setReorderHint((current) => (current?.targetId === target.id ? null : current))
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      if (!event.dataTransfer.types.includes(FILES_NODE_DRAG_TYPE)) return
      setReorderHint(null)
      const position = dropPositionOn(event)
      const ids = draggedNodeIds(event)
      if (!position || ids.length !== 1) return
      const dragged = data.files.find((node) => node.id === ids[0])
      if (!dragged || dragged.id === target.id || dragged.parentId !== target.parentId) return
      event.preventDefault()
      event.stopPropagation()
      reorderNode(ids[0], target.id, position)
    },
  })

  /**
   * Folder-row drop props combining reorder zones with move-inside: the top
   * and bottom quarters of a folder row reorder before/after it, the middle
   * keeps the existing drop-into-folder behavior.
   */
  const treeFolderDropProps = (folder: FileNode) => {
    const base = folderDropProps(folder.id)
    const clearHint = () =>
      setReorderHint((current) => (current?.targetId === folder.id ? null : current))
    return {
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (event.dataTransfer.types.includes(FILES_NODE_DRAG_TYPE)) {
          if (reorderableDrag(folder)) {
            const position = dropPositionOn(event, 0.25)
            if (position) {
              event.preventDefault()
              event.stopPropagation()
              event.dataTransfer.dropEffect = "move"
              setReorderHint({ targetId: folder.id, position })
              setDropTarget((current) => (current === folder.id ? false : current))
              return
            }
          }
          clearHint()
        }
        base.onDragOver(event)
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        clearHint()
        base.onDragLeave(event)
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        if (event.dataTransfer.types.includes(FILES_NODE_DRAG_TYPE)) {
          const ids = draggedNodeIds(event)
          const position = dropPositionOn(event, 0.25)
          if (position && ids.length === 1) {
            const dragged = data.files.find((node) => node.id === ids[0])
            if (dragged && dragged.id !== folder.id && dragged.parentId === folder.parentId) {
              event.preventDefault()
              event.stopPropagation()
              setReorderHint(null)
              reorderNode(ids[0], folder.id, position)
              return
            }
          }
        }
        setReorderHint(null)
        base.onDrop(event)
      },
    }
  }

  /**
   * Vertical guide lines replicating the borders the old nested
   * `.fm-tree-children` wrappers drew at each ancestor level.
   */
  const treeGuideBackground = (depth: number): string | undefined => {
    if (depth <= 0) return undefined
    const layers: string[] = []
    for (let index = 0; index < depth; index += 1) {
      const x = TREE_GUIDE_OFFSET_PX + index * TREE_GUIDE_STEP_PX
      layers.push(
        `linear-gradient(var(--app-border), var(--app-border)) ${x}px 0 / 1px 100% no-repeat`,
      )
    }
    return layers.join(", ")
  }

  /**
   * One flattened tree row. Rows are absolutely positioned inside
   * `.fm-tree-viewport` at `top` (px) so only the visible slice plus overscan
   * is rendered; `aria-level` carries the depth formerly expressed by nested
   * `role="group"` wrappers.
   */
  const renderTreeEntry = (entry: FolderTreeEntry, top: number) => {
    const node = entry.folder
    if (!node) return null
    const rowStyle: React.CSSProperties = {
      position: "absolute",
      top,
      left: 0,
      right: 0,
    }
    const itemStyle: React.CSSProperties = {
      paddingLeft: entry.depth * TREE_INDENT_PX,
      backgroundImage: treeGuideBackground(entry.depth),
    }
    if (node.kind === "file") {
      // File rows only render while the tree filter is active; they are
      // leaf treeitems (no expander, no children).
      const selected = selectedIds.has(node.id)
      return (
        <div
          key={entry.key}
          role="treeitem"
          aria-label={node.name}
          aria-level={entry.depth + 2}
          aria-selected={selected}
          tabIndex={entry.key === rovingTreeKey ? 0 : -1}
          data-tree-key={entry.key}
          style={rowStyle}
          onKeyDown={(event) => handleTreeKeyDown(event, entry.key)}
        >
          {nodeContextMenu(
            node,
            <div
              className="fm-tree-item"
              style={{ ...itemStyle, ...reorderHintStyle(node.id) }}
              draggable
              onDragStart={startNodeDrag(node)}
              onDragEnd={endNodeDrag}
              {...siblingReorderProps(node)}
            >
              <span className="fm-tree-toggle fm-tree-toggle--leaf" aria-hidden="true" />
              <button
                type="button"
                tabIndex={-1}
                className={`fm-tree-name${selected ? "is-current" : ""}`}
                onClick={() => openNode(node)}
              >
                <Icon name={fileIconName(node)} />
                <span>
                  <HighlightedTreeName name={node.name} term={treeFilter?.term} />
                </span>
              </button>
              {gitBadge(node)}
            </div>,
          )}
        </div>
      )
    }

    const folder = node
    const isExpanded = entry.expanded
    const hasChildren = entry.hasChildren
    const isCurrent = folder.id === currentParentId
    return (
      <div
        key={entry.key}
        role="treeitem"
        aria-label={folder.name}
        aria-level={entry.depth + 2}
        aria-expanded={hasChildren ? isExpanded : undefined}
        aria-selected={isCurrent}
        tabIndex={entry.key === rovingTreeKey ? 0 : -1}
        data-tree-key={entry.key}
        style={rowStyle}
        onKeyDown={(event) => handleTreeKeyDown(event, entry.key)}
      >
        {nodeContextMenu(
          folder,
          <div
            className={`fm-tree-item${dropTarget === folder.id ? "is-drop-target" : ""}`}
            style={{ ...itemStyle, ...reorderHintStyle(folder.id) }}
            draggable
            onDragStart={startNodeDrag(folder)}
            onDragEnd={endNodeDrag}
            {...treeFolderDropProps(folder)}
          >
            <button
              type="button"
              tabIndex={-1}
              className="fm-tree-toggle"
              aria-expanded={isExpanded}
              aria-label={`${isExpanded ? "Collapse" : "Expand"} ${folder.name}`}
              onClick={() => {
                // While the tree filter is active, ancestor folders are
                // force-expanded; their expanded state belongs to the filter
                // until it clears, so collapse clicks are ignored.
                if (!treeFilter?.ancestors.has(folder.id)) {
                  toggleFolderExpanded(folder.id, !isExpanded)
                }
              }}
            >
              <Icon
                name={isExpanded ? "i-chevron-down" : "i-arrow-right"}
                className="icon icon--xs"
              />
            </button>
            <button
              type="button"
              tabIndex={-1}
              className={`fm-tree-name${isCurrent ? "is-current" : ""}`}
              aria-current={isCurrent ? "page" : undefined}
              onClick={() => navigateToFolder(folder, fileNodePath(data.files, folder))}
            >
              <Icon name="i-folder" />
              <span>
                <HighlightedTreeName name={folder.name} term={treeFilter?.term} />
              </span>
            </button>
            {gitBadge(folder)}
          </div>,
        )}
      </div>
    )
  }

  const renderRow = (node: FileNode) => {
    const selected = selectedIds.has(node.id)
    return (
      <Fragment key={node.id}>
        {nodeContextMenu(
          node,
          <div
            role="row"
            className={`fm-row app-fm-row${selected ? "is-selected" : ""}`}
            onClick={(event) => {
              const target = event.target as HTMLElement
              if (target.closest("button,input,label,details,summary,a")) return
              handleRowSelect(node.id, event)
            }}
            onDoubleClick={() => openNode(node)}
            draggable
            onDragStart={startNodeDrag(node)}
            onDragEnd={endNodeDrag}
            style={reorderHintStyle(node.id)}
            {...siblingReorderProps(node)}
          >
            <div role="cell" className="fm-cell">
              <input
                type="checkbox"
                aria-label={`Select ${node.name}`}
                checked={selected}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => handleCheckboxChange(node.id, event)}
              />
            </div>
            <div role="cell" className="fm-cell">
              <button type="button" className="fm-open" onClick={() => openNode(node)}>
                <Icon name={fileIconName(node)} className="icon icon--sm" />
                <span>{node.name}</span>
              </button>
              {gitBadge(node)}
            </div>
            <div role="cell" className="fm-cell">
              <span className="fm-type">{fileTypeLabel(node)}</span>
            </div>
            <div role="cell" className="fm-cell">
              <span className="fm-owner">
                <OwnerAvatar owner={node.owner} />
                {node.owner}
              </span>
            </div>
            <div role="cell" className="fm-cell">
              <span className="fm-date">{formatDate(node.updatedAt)}</span>
            </div>
            <div role="cell" className="fm-cell">
              <span className="fm-size">
                {node.kind === "folder" ? "—" : formatBytes(node.sizeBytes)}
              </span>
            </div>
            <div role="cell" className="fm-cell">
              {nodeActionsMenu(node)}
            </div>
          </div>,
        )}
      </Fragment>
    )
  }

  /**
   * Actions available for one or more nodes, shared by the per-row dropdown
   * menu and the right-click context menu so both stay in sync. Rename only
   * applies to a single node; Download appears when the selection contains a
   * file (folders have nothing to download).
   */
  const nodeMenuEntries = (nodes: FileNode[]): NodeMenuEntry[] => {
    const entries: NodeMenuEntry[] = []
    // Preview opens the file content in a modal without downloading; it only
    // applies to a single file (folders have no content preview).
    if (nodes.length === 1 && nodes[0].kind === "file") {
      entries.push({
        label: "Preview",
        run: () => {
          setPreviewVariant("modal")
          setPreviewFileId(nodes[0].id)
        },
      })
    }
    entries.push({ label: "Copy path", run: () => void copyNodePaths(nodes) })
    if (nodes.some((node) => node.kind === "file")) {
      entries.push({ label: "Download", run: () => downloadNodes(nodes) })
    }
    entries.push(
      nodes.length === 1
        ? { label: "Share", run: () => setDialog({ type: "share", node: nodes[0] }) }
        : { label: "Share", disabled: true, run: () => {} },
      nodes.length === 1
        ? { label: "Rename", run: () => setDialog({ type: "rename", node: nodes[0] }) }
        : { label: "Rename", disabled: true, run: () => {} },
      { label: "Move", run: () => setDialog({ type: "move", nodes }) },
      { label: "Trash", danger: true, run: () => setDialog({ type: "trash", nodes }) },
    )
    return entries
  }

  function nodeActionsMenu(node: FileNode) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          className="fm-actions-trigger"
          aria-label={`Actions for ${node.name}`}
          onClick={(event) => event.stopPropagation()}
        >
          <Ellipsis aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="app-menu">
          {nodeMenuEntries([node]).map((entry) => (
            <Fragment key={entry.label}>
              {entry.danger ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem
                className={`app-menu-item${entry.danger ? "is-danger" : ""}`}
                disabled={entry.disabled}
                onSelect={entry.run}
              >
                <span className="app-menu-item-label">{entry.label}</span>
              </DropdownMenuItem>
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  function renderContextMenu(
    entries: NodeMenuEntry[],
    children: React.ReactNode,
    onOpenChange?: (open: boolean) => void,
  ) {
    return (
      <ContextMenu onOpenChange={onOpenChange}>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent className="app-menu">
          {entries.map((entry) => (
            <Fragment key={entry.label}>
              {entry.danger ? <ContextMenuSeparator /> : null}
              <ContextMenuItem
                className={`app-menu-item${entry.danger ? "is-danger" : ""}`}
                disabled={entry.disabled}
                onSelect={entry.run}
              >
                <span className="app-menu-item-label">{entry.label}</span>
              </ContextMenuItem>
            </Fragment>
          ))}
        </ContextMenuContent>
      </ContextMenu>
    )
  }

  /**
   * Right-click menu for a file/folder row or tree item. When the node is
   * part of a multi-selection the menu acts on the whole selection; otherwise
   * the node becomes the selection so the row highlight matches the menu.
   */
  function nodeContextMenu(node: FileNode, children: React.ReactNode) {
    const bulk = selectedIds.has(node.id) && selectedIds.size > 1
    const nodes = bulk ? selectedNodes : [node]
    return renderContextMenu(nodeMenuEntries(nodes), children, (open) => {
      if (!open) return
      if (bulk || (selectedIds.size === 1 && selectedIds.has(node.id))) return
      setSelectedIds(new Set([node.id]))
      setLastSelectedId(node.id)
    })
  }

  /** Right-click menu for the "Project root" tree row (not a real node). */
  function rootContextMenu(children: React.ReactNode) {
    return renderContextMenu(
      [
        {
          label: "New folder",
          run: () => setDialog({ type: "create-folder", parentId: null }),
        },
        { label: "Upload", run: () => uploadInput.current?.click() },
      ],
      children,
    )
  }

  if (folderMissing) {
    return (
      <ScreenState
        screen="files"
        status={filesQuery.status}
        error={filesQuery.error}
        isEmpty={filesQuery.isEmpty}
        isRetrying={filesQuery.isRetrying}
        onRetry={filesQuery.refetch}
      >
        <div className="app-page">
          <EmptyState
            icon={<FolderX aria-hidden="true" />}
            title="Folder not found"
            body="The path does not exist in the mock project store."
            primaryAction={{
              label: "Back to files",
              variant: "secondary",
              onClick: () => router.push(`${projectBase}/files`),
            }}
          />
        </div>
      </ScreenState>
    )
  }

  return (
    <ScreenState
      screen="files"
      status={filesQuery.status}
      error={filesQuery.error}
      isEmpty={filesQuery.isEmpty}
      isRetrying={filesQuery.isRetrying}
      onRetry={filesQuery.refetch}
    >
      <div className="app-page">
        <div className="app-page-head">
          <div>
            <h1>Files</h1>
            <p className="app-page-subtitle">
              Mock file manager for {data.project.name}. Uploads simulate progress and reset on
              reload.
            </p>
          </div>
          <div className="app-page-actions">
            <button
              type="button"
              className="fm-btn"
              onClick={() => setDialog({ type: "create-folder", parentId: currentParentId })}
            >
              <Icon name="i-plus" /> New folder
            </button>
            <button
              type="button"
              className="fm-btn fm-btn--solid"
              onClick={() => uploadInput.current?.click()}
            >
              <Icon name="i-upload" /> Upload
            </button>
            <input
              ref={uploadInput}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                if (event.target.files) void addFiles(event.target.files)
                event.target.value = ""
              }}
            />
          </div>
        </div>

        <div className="app-files-layout">
          <aside
            className="app-file-tree"
            aria-label="Project folders"
            ref={treePaneRef}
            onScroll={(event) => setTreeScrollTop(event.currentTarget.scrollTop)}
          >
            <div className="app-file-tree-head">Folders</div>
            <label className="fm-search app-file-tree-search" htmlFor="mock-file-tree-search">
              <Icon name="i-search" />
              <input
                id="mock-file-tree-search"
                value={treeQuery}
                onChange={(event) => setTreeQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setTreeQuery("")
                }}
                placeholder="Filter files"
              />
            </label>
            <div className="fm-tree" role="tree" aria-label="Project folders" ref={treeRef}>
              <div
                role="treeitem"
                aria-label="Project root"
                aria-level={1}
                aria-selected={isRoot}
                tabIndex={rovingTreeKey === "root" ? 0 : -1}
                data-tree-key="root"
                onKeyDown={(event) => handleTreeKeyDown(event, "root")}
              >
                {rootContextMenu(
                  <div
                    className={`fm-tree-item${dropTarget === null ? "is-drop-target" : ""}`}
                    {...folderDropProps(null)}
                  >
                    <button
                      type="button"
                      tabIndex={-1}
                      className={`fm-tree-name${isRoot ? "is-current" : ""}`}
                      aria-current={isRoot ? "page" : undefined}
                      onClick={() => navigateToFolder(null, [])}
                    >
                      <Icon name="i-folder" />
                      <span>Project root</span>
                    </button>
                  </div>,
                )}
              </div>
              {/* Windowed rows: only the visible slice plus overscan renders;
                  the layer's height preserves the full scrollable extent. */}
              <div
                className="fm-tree-viewport"
                role="presentation"
                ref={treeViewportRef}
                style={{ height: treeWindowCount * treeRowPitch }}
              >
                {visibleTreeEntries.map((entry, index) =>
                  renderTreeEntry(entry, (treeRangeStart + index) * treeRowPitch),
                )}
                {treeRovingEntry
                  ? renderTreeEntry(treeRovingEntry, treeFocusWindowIndex * treeRowPitch)
                  : null}
              </div>
            </div>
            {treeFilter && treeFilter.matches.size === 0 ? (
              <p className="fm-tree-empty">
                No files or folders match &ldquo;{treeQuery.trim()}&rdquo;.
              </p>
            ) : null}
          </aside>

          <section
            className={`app-file-pane fm-pane relative${isDragging ? "is-drop-target" : ""}`}
            aria-label="Current folder"
            onDragEnter={onDragEnter}
            onDragOver={(event) => {
              event.preventDefault()
              // dragenter can be skipped when the pointer was already inside
              // the pane (e.g. drag started over a child); keep the file-drag
              // flag in sync from the live transfer types.
              setIsFileDrag(event.dataTransfer.types.includes("Files"))
              event.dataTransfer.dropEffect = event.dataTransfer.types.includes(
                FILES_NODE_DRAG_TYPE,
              )
                ? "move"
                : "copy"
            }}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            <Breadcrumb className="fm-breadcrumb">
              <BreadcrumbList>
                <BreadcrumbItem
                  className={dropTarget === null ? "is-drop-target" : undefined}
                  {...folderDropProps(null)}
                >
                  <BreadcrumbLink asChild>
                    <button type="button" onClick={() => navigateToFolder(null, [])}>
                      Files
                    </button>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                {path.map((segment, index) => {
                  const isLast = index === path.length - 1
                  const segmentFolderId =
                    findFolderByPath(data.files, path.slice(0, index + 1))?.id ?? null
                  return (
                    <Fragment key={`${segment}-${index}`}>
                      <BreadcrumbSeparator />
                      <BreadcrumbItem
                        className={dropTarget === segmentFolderId ? "is-drop-target" : undefined}
                        {...folderDropProps(segmentFolderId)}
                      >
                        {isLast ? (
                          <BreadcrumbPage>{segment}</BreadcrumbPage>
                        ) : (
                          <BreadcrumbLink asChild>
                            <button
                              type="button"
                              onClick={() => navigateToFolder(null, path.slice(0, index + 1))}
                            >
                              {segment}
                            </button>
                          </BreadcrumbLink>
                        )}
                      </BreadcrumbItem>
                    </Fragment>
                  )
                })}
              </BreadcrumbList>
            </Breadcrumb>
            <div
              className="fm-toolbar app-file-pane-head"
              style={{ borderBottom: "1px solid var(--border)" }}
            >
              <label className="fm-search" htmlFor="mock-file-search">
                <Icon name="i-search" />
                <input
                  id="mock-file-search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Filter this folder"
                />
              </label>
              <div className="fm-view-toggle" role="group" aria-label="View mode">
                <button
                  type="button"
                  className={`fm-btn${view === "list" ? "fm-btn--solid" : ""}`}
                  aria-pressed={view === "list"}
                  onClick={() => setView("list")}
                >
                  List
                </button>
                <button
                  type="button"
                  className={`fm-btn${view === "grid" ? "fm-btn--solid" : ""}`}
                  aria-pressed={view === "grid"}
                  onClick={() => setView("grid")}
                >
                  Grid
                </button>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger className="fm-btn">
                  <ArrowUpDown className="icon icon--xs" aria-hidden="true" />
                  Sort: {SORT_LABELS[sort.key]} {sort.direction === "asc" ? "↑" : "↓"}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="app-menu">
                  <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {SORT_KEYS.map((key) => (
                    <DropdownMenuItem
                      key={key}
                      className="app-menu-item"
                      onSelect={() =>
                        setSort((current) => ({
                          key,
                          direction: current.key === key ? current.direction : "asc",
                        }))
                      }
                    >
                      <span className="app-menu-item-label">{SORT_LABELS[key]}</span>
                      {sort.key === key ? (
                        <Check className="app-menu-check" aria-hidden="true" />
                      ) : null}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="app-menu-item"
                    onSelect={() =>
                      setSort((current) => ({
                        ...current,
                        direction: current.direction === "asc" ? "desc" : "asc",
                      }))
                    }
                  >
                    <span className="app-menu-item-label">
                      {sort.direction === "asc" ? "Ascending" : "Descending"}
                    </span>
                    <Check className="app-menu-check" aria-hidden="true" />
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {gitInfo ? (
                <span
                  className="fm-git-branch"
                  title={
                    gitInfo.upstream ? `Tracks ${gitInfo.upstream}` : "Local branch, no upstream"
                  }
                >
                  <Icon name="i-git" />
                  <span className="fm-git-branch-name">{gitInfo.branch}</span>
                  {gitInfo.ahead > 0 || gitInfo.behind > 0 ? (
                    <span className="fm-git-branch-sync">
                      {gitInfo.ahead > 0 ? `↑${gitInfo.ahead}` : ""}
                      {gitInfo.behind > 0 ? `↓${gitInfo.behind}` : ""}
                    </span>
                  ) : null}
                </span>
              ) : null}
              {gitInfo ? (
                <button
                  type="button"
                  className="fm-btn"
                  aria-pressed={showGitChanges}
                  onClick={() => setShowGitChanges((current) => !current)}
                >
                  Changes{gitChanges.length > 0 ? ` (${gitChanges.length})` : ""}
                </button>
              ) : null}
            </div>

            {showGitChanges && gitInfo ? (
              <div className="fm-git-changes">
                <div className="fm-git-changes-head">
                  <strong>
                    <Icon name="i-git" /> Changes on {gitInfo.branch}
                  </strong>
                  <span>
                    {gitChanges.length} changed item{gitChanges.length === 1 ? "" : "s"}
                    {gitInfo.upstream
                      ? ` · ${gitInfo.ahead} ahead, ${gitInfo.behind} behind ${gitInfo.upstream}`
                      : ""}
                  </span>
                </div>
                {gitChanges.length === 0 ? (
                  <p className="fm-git-changes-empty">Working tree clean.</p>
                ) : (
                  <ul className="fm-git-changes-list">
                    {gitChanges.map((node) => {
                      const dirPath =
                        fileNodePath(data.files, node).slice(0, -1).join(" / ") || "Project root"
                      return (
                        <li key={node.id}>
                          <button
                            type="button"
                            className="fm-git-change"
                            onClick={() => openNode(node)}
                          >
                            {gitBadge(node)}
                            <span className="fm-git-change-name">{node.name}</span>
                            <span className="fm-git-change-path">{dirPath}</span>
                            <span className="fm-git-change-meta">
                              {node.owner} · {formatDate(node.updatedAt)}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            ) : null}

            <p className="fm-drop-hint">
              Drag one or more files here to upload them to this folder — or drag items, including
              folders in the tree, onto a folder in the tree or breadcrumb to move them. Drag an
              item onto the top or bottom edge of a sibling to reorder it. Use Upload to pick
              several files at once.
            </p>

            {queueUploads.length > 0 ? (
              <div className="fm-upload-queue" aria-live="polite">
                <div className="fm-upload-summary">
                  <span>
                    {queueUploads.length} upload{queueUploads.length === 1 ? "" : "s"}
                    {queueActiveCount > 0 ? ` · ${queueActiveCount} active` : ""}
                    {queueFailedCount > 0 ? ` · ${queueFailedCount} failed` : ""}
                  </span>
                  <span>{Math.round(queueProgress)}%</span>
                </div>
                {queueUploads.map((upload) => (
                  <UploadRow
                    key={upload.id}
                    upload={upload}
                    onPause={() => void actions.updateUpload(upload.id, "pause")}
                    onResume={() => void actions.updateUpload(upload.id, "resume")}
                    onRetry={() => void actions.updateUpload(upload.id, "retry")}
                    onCancel={() => void actions.updateUpload(upload.id, "cancel")}
                  />
                ))}
              </div>
            ) : null}

            {children.length === 0 ? (
              <EmptyState
                icon={<FolderOpen aria-hidden="true" />}
                title={query ? "No matching items" : "This folder is empty"}
                body={
                  query
                    ? "Try a different filter or clear it to see the mock files again."
                    : "Create a folder or drop files here to simulate an upload."
                }
                primaryAction={
                  query
                    ? { label: "Clear filter", variant: "secondary", onClick: () => setQuery("") }
                    : {
                        label: "New folder",
                        onClick: () =>
                          setDialog({ type: "create-folder", parentId: currentParentId }),
                      }
                }
                className="border-0 bg-transparent"
              />
            ) : view === "list" ? (
              <div className="fm-list" role="table" aria-label="Files">
                <div className="fm-columns app-fm-columns" role="row">
                  <span role="columnheader" />
                  <span role="columnheader">
                    <button type="button" className="fm-sort" onClick={() => toggleSort("name")}>
                      Name {sort.key === "name" ? (sort.direction === "asc" ? "↑" : "↓") : ""}
                    </button>
                  </span>
                  <span role="columnheader" className="app-col-type">
                    <button type="button" className="fm-sort" onClick={() => toggleSort("type")}>
                      Type {sort.key === "type" ? (sort.direction === "asc" ? "↑" : "↓") : ""}
                    </button>
                  </span>
                  <span role="columnheader" className="app-col-owner">
                    <button type="button" className="fm-sort" onClick={() => toggleSort("owner")}>
                      Owner {sort.key === "owner" ? (sort.direction === "asc" ? "↑" : "↓") : ""}
                    </button>
                  </span>
                  <span role="columnheader" className="app-col-updated">
                    <button type="button" className="fm-sort" onClick={() => toggleSort("updated")}>
                      Updated {sort.key === "updated" ? (sort.direction === "asc" ? "↑" : "↓") : ""}
                    </button>
                  </span>
                  <span role="columnheader" className="fm-size">
                    <button type="button" className="fm-sort" onClick={() => toggleSort("size")}>
                      Size {sort.key === "size" ? (sort.direction === "asc" ? "↑" : "↓") : ""}
                    </button>
                  </span>
                  <span role="columnheader" />
                </div>
                {children.map(renderRow)}
              </div>
            ) : (
              <div className="fm-grid">
                {children.map((node) => {
                  const selected = selectedIds.has(node.id)
                  return (
                    <Fragment key={node.id}>
                      {nodeContextMenu(
                        node,
                        <div
                          className={`fm-card${selected ? "is-selected" : ""}`}
                          onClick={(event) => {
                            const target = event.target as HTMLElement
                            if (target.closest("button,input,label,a")) return
                            handleRowSelect(node.id, event)
                          }}
                          onDoubleClick={() => openNode(node)}
                          draggable
                          onDragStart={startNodeDrag(node)}
                          onDragEnd={endNodeDrag}
                          style={reorderHintStyle(node.id)}
                          {...siblingReorderProps(node)}
                        >
                          <div className="fm-card-name">
                            <input
                              type="checkbox"
                              aria-label={`Select ${node.name}`}
                              checked={selected}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => handleCheckboxChange(node.id, event)}
                            />
                            <Icon name={fileIconName(node)} className="icon icon--sm" />
                            <button type="button" onClick={() => openNode(node)}>
                              {node.name}
                            </button>
                            {gitBadge(node)}
                          </div>
                          <div className="fm-card-meta">
                            {fileTypeLabel(node)} ·{" "}
                            {node.kind === "folder" ? "Folder" : formatBytes(node.sizeBytes)}
                          </div>
                          <div className="fm-card-meta">
                            <OwnerAvatar owner={node.owner} /> {node.owner} ·{" "}
                            {formatDate(node.updatedAt)}
                          </div>
                          <div className="fm-card-actions">{nodeActionsMenu(node)}</div>
                        </div>,
                      )}
                    </Fragment>
                  )
                })}
              </div>
            )}

            <div className="fm-storage">
              <div className="fm-storage-label">
                <span>
                  <Icon name="i-layers" /> Storage
                </span>
                <strong>
                  {formatBytes(storage.usedBytes)} <span>/ {formatBytes(storage.limitBytes)}</span>
                </strong>
              </div>
              <div
                className="fm-storage-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(storagePercent)}
                aria-label="Mock storage usage"
              >
                <span style={{ width: `${storagePercent}%` }} />
              </div>
            </div>

            {/* Desktop file-drag overlay: visible only while OS files hover
                the pane (node drags never carry the "Files" transfer type).
                pointer-events-none keeps drop targeting on the pane itself. */}
            {isDragging && isFileDrag ? (
              <div
                className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-[inherit] border-2 border-dashed border-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-panel)_82%,transparent)] text-sm font-semibold text-[var(--app-text)]"
                role="status"
              >
                <Icon name="i-upload" className="icon icon--sm" />
                Drop files to upload them to this folder
              </div>
            ) : null}
          </section>
        </div>

        {selectedIds.size > 0 ? (
          <div className="fm-bulkbar" role="toolbar" aria-label="Selected items">
            <span>{selectedIds.size} selected</span>
            <button
              type="button"
              className="fm-btn"
              onClick={() => setDialog({ type: "move", nodes: selectedNodes })}
            >
              Move
            </button>
            <button type="button" className="fm-btn" onClick={() => downloadNodes(selectedNodes)}>
              Download
            </button>
            <button
              type="button"
              className="fm-btn fm-btn--danger"
              onClick={() => setDialog({ type: "trash", nodes: selectedNodes })}
            >
              Trash
            </button>
            <button
              type="button"
              className="fm-btn"
              onClick={() => {
                setSelectedIds(new Set())
                setLastSelectedId(null)
              }}
            >
              Clear
            </button>
          </div>
        ) : null}

        {dialog?.type === "share" ? (
          <FileShareDialog
            node={dialog.node}
            files={data.files}
            projectId={projectId}
            members={workspaceMembers.data ?? []}
            shares={fileShares.shares}
            pathname={pathname}
            search={searchParams.toString()}
            onAddShare={fileShares.addShare}
            onSetPermission={fileShares.setSharePermission}
            onRevokeShare={fileShares.revokeShare}
            onClose={closeDialog}
          />
        ) : dialog ? (
          <FileActionDialog
            dialog={dialog}
            files={data.files}
            onClose={closeDialog}
            onCreateFolder={createFolder}
            onRename={renameNode}
            onMove={moveNodes}
            onTrash={trashNodes}
          />
        ) : null}

        {previewFile ? (
          <FilePreviewDrawer
            file={previewFile}
            files={data.files}
            projectId={projectId}
            onClose={() => setPreviewFileId(null)}
            onDownload={(node) => downloadNodes([node])}
            onDelete={(node) => setDialog({ type: "trash", nodes: [node] })}
            onRename={async (node, name) => {
              const result = await renameNode(node.id, name)
              // The drawer keeps the rename form open and shows an error
              // toast when the handler rejects.
              if (!result.ok) throw new Error(result.error)
            }}
            onRestore={async (node, version) => {
              const result = await actions.restoreVersion(node.id, version.id)
              // The drawer toasts the outcome; throw so it can show the error.
              if (!result.ok) throw new Error(result.error)
            }}
            onShare={(node) => setDialog({ type: "share", node })}
            variant={previewVariant}
            previewUrl={previewFile.previewUrl}
            versions={previewFile.versions}
          />
        ) : null}
      </div>
    </ScreenState>
  )
}

function UploadRow({
  upload,
  onPause,
  onResume,
  onRetry,
  onCancel,
}: {
  upload: FileUpload
  onPause: () => void
  onResume: () => void
  onRetry: () => void
  onCancel: () => void
}) {
  const bytesPerSecond = useUploadRate(upload)
  const remainingBytes = Math.max(0, upload.sizeBytes * (1 - upload.progress / 100))
  const eta =
    upload.status === "uploading" && bytesPerSecond > 0
      ? formatEta(remainingBytes / bytesPerSecond)
      : null
  const statusLabel =
    upload.status === "queued"
      ? "Queued"
      : upload.status === "uploading"
        ? "Uploading"
        : upload.status === "paused"
          ? "Paused"
          : upload.status === "done"
            ? "Uploaded"
            : "Failed"
  return (
    <div className={`fm-upload is-${upload.status}`}>
      <div className="fm-upload-head">
        <strong>{upload.name}</strong>
        <span>
          {statusLabel} · {Math.round(upload.progress)}% · {formatBytes(upload.sizeBytes)}
          {upload.status === "uploading" && bytesPerSecond > 0
            ? ` · ${formatBytes(bytesPerSecond)}/s${eta ? ` · ${eta}` : ""}`
            : ""}
        </span>
      </div>
      <div
        className="fm-upload-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(upload.progress)}
        aria-label={`${upload.name} upload progress`}
      >
        <span style={{ width: `${upload.progress}%` }} />
      </div>
      {upload.status === "failed" && upload.error ? (
        <p className="fm-upload-error">{upload.error}</p>
      ) : null}
      {upload.status !== "done" ? (
        <div className="fm-upload-actions">
          {upload.status === "uploading" ? (
            <button type="button" onClick={onPause}>
              Pause
            </button>
          ) : null}
          {upload.status === "paused" || upload.status === "failed" ? (
            <button type="button" onClick={upload.status === "failed" ? onRetry : onResume}>
              {upload.status === "failed" ? "Retry" : "Resume"}
            </button>
          ) : null}
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  )
}
