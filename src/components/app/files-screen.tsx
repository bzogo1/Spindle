"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { ChangeEvent, DragEvent, MouseEvent as ReactMouseEvent } from "react"
import { useRouter } from "next/navigation"

import { useMockStore } from "@/components/app/mock-store-provider"
import {
  fileExtension,
  fileTypeLabel,
  formatBytes,
  type FileNode,
  type FileUpload,
} from "@/lib/project-store"

type SortKey = "name" | "type" | "owner" | "updated" | "size"
type ViewMode = "list" | "grid"

type DialogState =
  | { type: "create-folder"; parentId: string | null }
  | { type: "rename"; node: FileNode }
  | { type: "move"; nodes: FileNode[] }
  | { type: "trash"; nodes: FileNode[] }
  | null

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
  state,
  onClose,
  onCreateFolder,
  onRename,
  onMove,
  onTrash,
}: {
  dialog: Exclude<DialogState, null>
  state: ReturnType<typeof useMockStore>["state"]
  onClose: () => void
  onCreateFolder: (parentId: string | null, name: string) => { ok: boolean; error?: string }
  onRename: (id: string, name: string) => { ok: boolean; error?: string }
  onMove: (ids: string[], targetFolderId: string | null) => { ok: boolean; error?: string }
  onTrash: (ids: string[]) => { ok: boolean; error?: string }
}) {
  const [name, setName] = useState(dialog.type === "rename" ? dialog.node.name : "")
  const [targetFolderId, setTargetFolderId] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [onClose])

  const folderOptions = useMemo(() => {
    if (dialog.type !== "move") return []
    const excluded = new Set<string>()
    dialog.nodes.forEach((node) => {
      excluded.add(node.id)
      const collect = (parentId: string) => {
        state.files
          .filter((candidate) => candidate.kind === "folder" && candidate.parentId === parentId)
          .forEach((child) => {
            excluded.add(child.id)
            collect(child.id)
          })
      }
      if (node.kind === "folder") collect(node.id)
    })
    const options: { id: string | null; label: string }[] = [{ id: null, label: "Project root" }]
    collectFolderOptions(state.files, null, "", excluded, options)
    return options
  }, [dialog, state.files])

  const title =
    dialog.type === "create-folder"
      ? "New folder"
      : dialog.type === "rename"
        ? "Rename item"
        : dialog.type === "move"
          ? `Move ${dialog.nodes.length} item${dialog.nodes.length === 1 ? "" : "s"}`
          : `Move ${dialog.nodes.length} item${dialog.nodes.length === 1 ? "" : "s"} to trash`

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError("")
    const result =
      dialog.type === "create-folder"
        ? onCreateFolder(dialog.parentId, name)
        : dialog.type === "rename"
          ? onRename(dialog.node.id, name)
          : dialog.type === "move"
            ? onMove(
                dialog.nodes.map((node) => node.id),
                targetFolderId === "" ? null : targetFolderId,
              )
            : onTrash(dialog.nodes.map((node) => node.id))
    if (!result.ok) {
      setError(result.error ?? "The action failed.")
      return
    }
    onClose()
  }

  return (
    <div
      className="app-dialog-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <form
        className="app-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="file-dialog-title"
        onSubmit={submit}
      >
        <h2 id="file-dialog-title">{title}</h2>
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
              id="file-dialog-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
              required
            />
          </div>
        ) : null}
        {dialog.type === "move" ? (
          <div className="app-field">
            <label htmlFor="file-dialog-folder">Destination</label>
            <select
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
        {error ? (
          <p className="app-dialog-error" role="alert">
            {error}
          </p>
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
    </div>
  )
}

export function FilesScreen({ projectId, path }: { projectId: string; path: string[] }) {
  const router = useRouter()
  const { store, state, ready } = useMockStore()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({
    key: "name",
    direction: "asc",
  })
  const [query, setQuery] = useState("")
  const [view, setView] = useState<ViewMode>("list")
  const [dialog, setDialog] = useState<DialogState>(null)
  const [notice, setNotice] = useState("")
  const [isDragging, setIsDragging] = useState(false)
  const dragDepth = useRef(0)
  const uploadInput = useRef<HTMLInputElement>(null)

  const isRoot = path.length === 0
  const currentFolder = useMemo(
    () => store.getFolderByPath(path),
    [store, state.files, path.join("/")],
  )
  const currentParentId = isRoot ? null : (currentFolder?.id ?? null)
  const folderMissing = !isRoot && !currentFolder

  useEffect(() => {
    setSelectedIds(new Set())
    setLastSelectedId(null)
    setNotice("")
  }, [path.join("/")])

  useEffect(() => {
    if (!currentFolder || currentFolder.id === "root") return
    const ancestorIds: string[] = []
    let parentId: string | null = null
    store
      .getNodePath(currentFolder)
      .slice(0, -1)
      .forEach((part) => {
        const match = state.files.find(
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
  }, [currentFolder?.id])

  useEffect(() => {
    if (!ready) return
    const interval = window.setInterval(() => store.tickUploads(250), 250)
    return () => window.clearInterval(interval)
  }, [ready, store])

  const children = useMemo(() => {
    if (folderMissing || (!currentParentId && !isRoot)) return []
    const normalized = query.trim().toLowerCase()
    return store
      .getChildren(currentParentId)
      .filter((node) => !normalized || node.name.toLowerCase().includes(normalized))
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1
        const direction = sort.direction === "asc" ? 1 : -1
        if (sort.key === "name") return a.name.localeCompare(b.name) * direction
        if (sort.key === "type") return fileTypeLabel(a).localeCompare(fileTypeLabel(b)) * direction
        if (sort.key === "owner") return a.owner.localeCompare(b.owner) * direction
        if (sort.key === "updated") return a.updatedAt.localeCompare(b.updatedAt) * direction
        return (a.sizeBytes - b.sizeBytes) * direction
      })
  }, [currentParentId, folderMissing, isRoot, query, sort, state.files, store])

  const visibleIds = useMemo(() => children.map((node) => node.id), [children])
  const selectedNodes = useMemo(
    () => state.files.filter((node) => selectedIds.has(node.id)),
    [selectedIds, state.files],
  )
  const selectedFile =
    selectedNodes.length === 1 && selectedNodes[0].kind === "file" ? selectedNodes[0] : null
  const storage = store.getStorageUsage()
  const storagePercent = Math.min(100, (storage.usedBytes / storage.limitBytes) * 100)
  const folderUploads = state.uploads.filter(
    (upload) => upload.parentId === currentParentId && upload.status !== "done",
  )
  const projectBase = `/projects/${projectId}`

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
      const segments = store.getNodePath(node)
      navigateToFolder(node, segments)
      return
    }
    setSelectedIds(new Set([node.id]))
    setLastSelectedId(node.id)
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

  const addFiles = (files: FileList | File[]) => {
    const inputs = Array.from(files).map((file) => ({
      name: file.name,
      sizeBytes: file.size,
      mimeType: file.type || "application/octet-stream",
    }))
    const result = store.addUploads(currentParentId, inputs)
    if (result.rejected.length > 0) {
      setNotice(result.rejected.map((item) => `${item.name}: ${item.error}`).join(" "))
    } else if (result.accepted.length > 0) {
      setNotice(
        `${result.accepted.length} upload${result.accepted.length === 1 ? "" : "s"} queued.`,
      )
    }
  }

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    dragDepth.current = 0
    setIsDragging(false)
    if (event.dataTransfer.files.length > 0) addFiles(event.dataTransfer.files)
  }

  const onDragEnter = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    dragDepth.current += 1
    setIsDragging(true)
  }

  const onDragLeave = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setIsDragging(false)
  }

  const closeDialog = () => setDialog(null)

  const createFolder = (parentId: string | null, name: string) => {
    const result = store.createFolder(parentId, name)
    if (result.ok) setNotice(`Folder "${name.trim()}" created.`)
    return result
  }

  const renameNode = (id: string, name: string) => {
    const result = store.renameNode(id, name)
    if (result.ok) setNotice("Item renamed.")
    return result
  }

  const moveNodes = (ids: string[], targetFolderId: string | null) => {
    const errors: string[] = []
    ids.forEach((id) => {
      const result = store.moveNode(id, targetFolderId)
      if (!result.ok) errors.push(result.error)
    })
    setSelectedIds(new Set())
    setNotice(errors.length ? errors.join(" ") : "Items moved.")
    return { ok: errors.length === 0, error: errors.join(" ") || undefined }
  }

  const trashNodes = (ids: string[]) => {
    const result = store.trashNodes(ids)
    if (result.ok) {
      setSelectedIds(new Set())
      setLastSelectedId(null)
      setNotice(`${result.count} item${result.count === 1 ? "" : "s"} moved to trash.`)
    }
    return result.ok ? { ok: true } : { ok: false, error: result.error }
  }

  const renderTree = (parentId: string | null, depth: number): React.ReactNode => {
    return store
      .getChildren(parentId)
      .filter((node) => node.kind === "folder")
      .map((folder) => {
        const isExpanded = expanded.has(folder.id)
        const isCurrent = folder.id === currentParentId
        return (
          <div key={folder.id}>
            <div className="fm-tree-item" style={{ paddingLeft: depth * 12 }}>
              <button
                type="button"
                className="fm-tree-toggle"
                aria-expanded={isExpanded}
                aria-label={`${isExpanded ? "Collapse" : "Expand"} ${folder.name}`}
                onClick={() =>
                  setExpanded((current) => {
                    const next = new Set(current)
                    if (next.has(folder.id)) next.delete(folder.id)
                    else next.add(folder.id)
                    return next
                  })
                }
              >
                <Icon
                  name={isExpanded ? "i-chevron-down" : "i-arrow-right"}
                  className="icon icon--xs"
                />
              </button>
              <button
                type="button"
                className={`fm-tree-name${isCurrent ? " is-current" : ""}`}
                aria-current={isCurrent ? "page" : undefined}
                onClick={() => navigateToFolder(folder, store.getNodePath(folder))}
              >
                <Icon name="i-folder" />
                <span>{folder.name}</span>
              </button>
            </div>
            {isExpanded ? (
              <div className="fm-tree-children">{renderTree(folder.id, depth + 1)}</div>
            ) : null}
          </div>
        )
      })
  }

  const renderRow = (node: FileNode) => {
    const selected = selectedIds.has(node.id)
    return (
      <div
        key={node.id}
        className={`fm-row app-fm-row${selected ? " is-selected" : ""}`}
        onClick={(event) => {
          const target = event.target as HTMLElement
          if (target.closest("button,input,label,details,summary,a")) return
          handleRowSelect(node.id, event)
        }}
        onDoubleClick={() => openNode(node)}
      >
        <input
          type="checkbox"
          aria-label={`Select ${node.name}`}
          checked={selected}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => handleCheckboxChange(node.id, event)}
        />
        <button type="button" className="fm-open" onClick={() => openNode(node)}>
          <Icon name={node.kind === "folder" ? "i-folder" : "i-code"} className="icon icon--sm" />
          <span>{node.name}</span>
        </button>
        <span className="fm-type">{fileTypeLabel(node)}</span>
        <span className="fm-owner">{node.owner}</span>
        <span className="fm-date">{formatDate(node.updatedAt)}</span>
        <span className="fm-size">
          {node.kind === "folder" ? "—" : formatBytes(node.sizeBytes)}
        </span>
        <details className="fm-actions">
          <summary aria-label={`Actions for ${node.name}`}>•••</summary>
          <div className="fm-actions-menu">
            {node.kind === "file" ? (
              <button type="button" onClick={() => downloadNodes([node])}>
                Download
              </button>
            ) : null}
            <button type="button" onClick={() => setDialog({ type: "rename", node })}>
              Rename
            </button>
            <button type="button" onClick={() => setDialog({ type: "move", nodes: [node] })}>
              Move
            </button>
            <button
              type="button"
              className="is-danger"
              onClick={() => setDialog({ type: "trash", nodes: [node] })}
            >
              Trash
            </button>
          </div>
        </details>
      </div>
    )
  }

  if (!ready) {
    return (
      <div className="app-page">
        <div className="app-page-head">
          <div>
            <h1>Files</h1>
            <p className="app-page-subtitle">Loading the mock project store…</p>
          </div>
        </div>
        <div className="app-loading" aria-label="Loading files">
          <span />
          <span />
          <span />
        </div>
      </div>
    )
  }

  if (folderMissing) {
    return (
      <div className="app-page">
        <div className="app-state app-error" role="alert">
          <h2>Folder not found</h2>
          <p>The path does not exist in the mock project store.</p>
          <button
            type="button"
            className="fm-btn fm-btn--solid"
            onClick={() => router.push(`${projectBase}/files`)}
          >
            Back to files
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1>Files</h1>
          <p className="app-page-subtitle">
            Mock file manager for {state.project.name}. Uploads simulate progress and reset on
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
              if (event.target.files) addFiles(event.target.files)
              event.target.value = ""
            }}
          />
        </div>
      </div>

      {notice ? (
        <div className="app-alert app-alert--info" role="status">
          <Icon name="i-check" />
          <span>{notice}</span>
        </div>
      ) : null}

      <div className="app-files-layout">
        <aside className="app-file-tree" aria-label="Project folders">
          <div className="app-file-tree-head">Folders</div>
          <div className="fm-tree">
            <button
              type="button"
              className={`fm-tree-name${isRoot ? " is-current" : ""}`}
              aria-current={isRoot ? "page" : undefined}
              onClick={() => navigateToFolder(null, [])}
            >
              <Icon name="i-folder" />
              <span>Project root</span>
            </button>
            {renderTree(null, 0)}
          </div>
        </aside>

        <section
          className={`app-file-pane fm-pane${isDragging ? " is-drop-target" : ""}`}
          aria-label="Current folder"
          onDragEnter={onDragEnter}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <div className="fm-breadcrumb" aria-label="Breadcrumb">
            <button type="button" onClick={() => navigateToFolder(null, [])}>
              Files
            </button>
            {path.map((segment, index) => (
              <span key={`${segment}-${index}`}>
                <span aria-hidden="true">/</span>{" "}
                <button
                  type="button"
                  aria-current={index === path.length - 1 ? "page" : undefined}
                  onClick={() => navigateToFolder(null, path.slice(0, index + 1))}
                >
                  {segment}
                </button>
              </span>
            ))}
          </div>
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
                className={`fm-btn${view === "list" ? " fm-btn--solid" : ""}`}
                aria-pressed={view === "list"}
                onClick={() => setView("list")}
              >
                List
              </button>
              <button
                type="button"
                className={`fm-btn${view === "grid" ? " fm-btn--solid" : ""}`}
                aria-pressed={view === "grid"}
                onClick={() => setView("grid")}
              >
                Grid
              </button>
            </div>
          </div>

          {folderUploads.length > 0 ? (
            <div className="fm-upload-queue" aria-live="polite">
              {folderUploads.map((upload) => (
                <UploadRow
                  key={upload.id}
                  upload={upload}
                  onPause={() => store.pauseUpload(upload.id)}
                  onResume={() => store.resumeUpload(upload.id)}
                  onRetry={() => store.retryUpload(upload.id)}
                  onCancel={() => store.cancelUpload(upload.id)}
                />
              ))}
            </div>
          ) : null}

          {children.length === 0 ? (
            <div className="app-state">
              <Icon name="i-folder" className="icon" />
              <h2>{query ? "No matching items" : "This folder is empty"}</h2>
              <p>
                {query
                  ? "Try a different filter or clear it to see the mock files again."
                  : "Create a folder or drop files here to simulate an upload."}
              </p>
              {!query ? (
                <button
                  type="button"
                  className="fm-btn fm-btn--solid"
                  onClick={() => setDialog({ type: "create-folder", parentId: currentParentId })}
                >
                  New folder
                </button>
              ) : null}
            </div>
          ) : view === "list" ? (
            <div className="fm-list" role="table" aria-label="Files">
              <div className="fm-columns app-fm-columns" role="row">
                <span />
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
                <span />
              </div>
              {children.map(renderRow)}
            </div>
          ) : (
            <div className="fm-grid">
              {children.map((node) => {
                const selected = selectedIds.has(node.id)
                return (
                  <div key={node.id} className={`fm-card${selected ? " is-selected" : ""}`}>
                    <div className="fm-card-name">
                      <input
                        type="checkbox"
                        aria-label={`Select ${node.name}`}
                        checked={selected}
                        onChange={(event) => handleCheckboxChange(node.id, event)}
                      />
                      <Icon
                        name={node.kind === "folder" ? "i-folder" : "i-code"}
                        className="icon icon--sm"
                      />
                      <button type="button" onClick={() => openNode(node)}>
                        {node.name}
                      </button>
                    </div>
                    <div className="fm-card-meta">
                      {fileTypeLabel(node)} ·{" "}
                      {node.kind === "folder" ? "Folder" : formatBytes(node.sizeBytes)}
                    </div>
                    <div className="fm-card-meta">
                      {node.owner} · {formatDate(node.updatedAt)}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {selectedFile ? (
            <FilePreview file={selectedFile} onDownload={() => downloadNodes([selectedFile])} />
          ) : null}

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

      {dialog ? (
        <FileActionDialog
          dialog={dialog}
          state={state}
          onClose={closeDialog}
          onCreateFolder={createFolder}
          onRename={renameNode}
          onMove={moveNodes}
          onTrash={trashNodes}
        />
      ) : null}
    </div>
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
  const statusLabel =
    upload.status === "queued"
      ? "Queued"
      : upload.status === "uploading"
        ? "Uploading"
        : upload.status === "paused"
          ? "Paused"
          : "Failed"
  return (
    <div className={`fm-upload is-${upload.status}`}>
      <div className="fm-upload-head">
        <strong>{upload.name}</strong>
        <span>
          {statusLabel} · {Math.round(upload.progress)}%
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
    </div>
  )
}

function FilePreview({ file, onDownload }: { file: FileNode; onDownload: () => void }) {
  const lines = file.content?.split("\n").slice(0, 10) ?? []
  return (
    <div className="fm-preview">
      <div className="fm-preview-title">
        <Icon name={file.kind === "folder" ? "i-folder" : "i-eye"} />
        Preview · {file.name}
      </div>
      {file.kind === "folder" ? (
        <div className="preview-folder">
          <Icon name="i-folder" className="icon" />
          Folder preview is a directory listing in the main pane.
        </div>
      ) : lines.length > 0 ? (
        <pre>{lines.join("\n")}</pre>
      ) : ["PNG", "JPG", "JPEG", "WEBP", "GIF", "PDF"].includes(fileExtension(file.name)) ? (
        <div className="preview-image" aria-label={`${file.name} binary preview placeholder`} />
      ) : (
        <p className="fm-preview-note">Inline preview is not available for this mock file type.</p>
      )}
      <div className="fm-preview-note">
        {fileTypeLabel(file)} · {formatBytes(file.sizeBytes)} · owned by {file.owner}
      </div>
      <button type="button" className="fm-btn" onClick={onDownload}>
        <Icon name="i-arrow-down" /> Download mock file
      </button>
    </div>
  )
}
