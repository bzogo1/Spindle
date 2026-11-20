"use client"

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react"
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  FileText,
  History,
  Pencil,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react"

import { Skeleton, SkeletonText } from "@/components/app/states/skeleton"
import { parseDelimitedTable, DELIMITED_MAX_ROWS } from "@/components/app/delimited-table"
import { DiffViewer } from "@/components/file-tree/diff-viewer"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/components/ui/toast"
import { fileExtension, fileNodePath, fileTypeLabel, formatBytes } from "@/lib/api"
import type { FileNode, FileVersion } from "@/lib/api"

const IMAGE_EXTENSIONS = new Set(["PNG", "JPG", "JPEG", "WEBP", "GIF", "SVG", "AVIF", "BMP"])
const PDF_EXTENSIONS = new Set(["PDF"])
const VIDEO_EXTENSIONS = new Set(["MP4", "WEBM", "MOV", "M4V"])
const AUDIO_EXTENSIONS = new Set(["MP3", "WAV", "OGG", "M4A", "FLAC"])
const MARKDOWN_EXTENSIONS = new Set(["MD", "MARKDOWN"])
const DELIMITED_EXTENSIONS = new Set(["CSV", "TSV"])

const PREVIEW_LOAD_MS = 450

type PreviewKind =
  "image" | "pdf" | "video" | "audio" | "markdown" | "table" | "code" | "folder" | "unavailable"

function previewKind(file: FileNode): PreviewKind {
  if (file.kind === "folder") return "folder"
  const extension = fileExtension(file.name)
  if (IMAGE_EXTENSIONS.has(extension)) return "image"
  if (PDF_EXTENSIONS.has(extension)) return "pdf"
  if (VIDEO_EXTENSIONS.has(extension)) return "video"
  if (AUDIO_EXTENSIONS.has(extension)) return "audio"
  if (MARKDOWN_EXTENSIONS.has(extension) && file.content) return "markdown"
  if (DELIMITED_EXTENSIONS.has(extension) && file.content) return "table"
  if (file.content) return "code"
  return "unavailable"
}

function isUrlLike(value: string | undefined) {
  return typeof value === "string" && /^(https?:|data:|blob:)/i.test(value)
}

/**
 * Hrefs rendered from untrusted file content (markdown links, version
 * download URLs) may only use `http:`, `https:`, or `mailto:` schemes, or be
 * relative references (leading `/`, `#`, `?`, or no scheme at all).
 * Everything else — `javascript:`, `data:`, `vbscript:`, protocol-relative
 * `//host` — is rejected so a hostile file cannot smuggle script into an
 * anchor. Mirrors `isSafeNotificationHref` in `@/lib/notifications/actions`.
 */
function isSafePreviewHref(value: string) {
  const href = value.trim()
  if (!href || href.startsWith("//")) return false
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) return true
  return /^https?:|^mailto:/i.test(href)
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function InlineMarkdown({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g)
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={index}>{part.slice(2, -2)}</strong>
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return <code key={index}>{part.slice(1, -1)}</code>
        }
        const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)
        if (link) {
          if (!isSafePreviewHref(link[2])) {
            return (
              <span key={index} className="fm-md-unsafe-link">
                {link[1]}
              </span>
            )
          }
          return (
            <a key={index} href={link[2]} target="_blank" rel="noreferrer">
              {link[1]}
            </a>
          )
        }
        return <Fragment key={index}>{part}</Fragment>
      })}
    </>
  )
}

function isMarkdownBlockStart(line: string) {
  return (
    /^```/.test(line) ||
    /^#{1,6}\s/.test(line) ||
    /^[-*]\s/.test(line) ||
    /^\d+\.\s/.test(line) ||
    /^>\s?/.test(line) ||
    /^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())
  )
}

function MarkdownPreview({ source }: { source: string }) {
  const blocks: ReactNode[] = []
  const lines = source.split("\n")
  let index = 0
  let key = 0

  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) {
      index += 1
      continue
    }

    const fence = line.match(/^```(\w*)\s*$/)
    if (fence) {
      const code: string[] = []
      index += 1
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        code.push(lines[index])
        index += 1
      }
      index += 1
      blocks.push(
        <pre key={key++} className="fm-code">
          <code>{code.join("\n")}</code>
        </pre>,
      )
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      const level = Math.min(heading[1].length + 1, 6)
      const Tag = `h${level}` as "h2" | "h3" | "h4" | "h5" | "h6"
      blocks.push(
        <Tag key={key++}>
          <InlineMarkdown text={heading[2]} />
        </Tag>,
      )
      index += 1
      continue
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      blocks.push(<hr key={key++} />)
      index += 1
      continue
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = []
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/, ""))
        index += 1
      }
      blocks.push(
        <blockquote key={key++}>
          {quote.map((quoteLine, quoteIndex) => (
            <p key={quoteIndex}>
              <InlineMarkdown text={quoteLine} />
            </p>
          ))}
        </blockquote>,
      )
      continue
    }

    if (/^[-*]\s/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^[-*]\s/.test(lines[index])) {
        items.push(lines[index].replace(/^[-*]\s/, ""))
        index += 1
      }
      blocks.push(
        <ul key={key++}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>
              <InlineMarkdown text={item} />
            </li>
          ))}
        </ul>,
      )
      continue
    }

    if (/^\d+\.\s/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\d+\.\s/.test(lines[index])) {
        items.push(lines[index].replace(/^\d+\.\s/, ""))
        index += 1
      }
      blocks.push(
        <ol key={key++}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>
              <InlineMarkdown text={item} />
            </li>
          ))}
        </ol>,
      )
      continue
    }

    const paragraph: string[] = []
    while (index < lines.length && lines[index].trim() && !isMarkdownBlockStart(lines[index])) {
      paragraph.push(lines[index].trim())
      index += 1
    }
    blocks.push(
      <p key={key++}>
        <InlineMarkdown text={paragraph.join(" ")} />
      </p>,
    )
  }

  return <div className="fm-md">{blocks}</div>
}

function languageLabelFor(file: FileNode) {
  const extension = fileExtension(file.name)
  return extension === "FILE" ? fileTypeLabel(file) : extension
}

function CodePreview({ code, label }: { code: string; label: string }) {
  const lines = code.split("\n")
  return (
    <div className="fm-code-wrap">
      <div className="fm-code-bar">
        <span className="fm-code-lang">{label}</span>
      </div>
      <pre className="fm-code" tabIndex={0} aria-label="File contents">
        <code>
          {lines.map((line, index) => (
            <Fragment key={index}>
              <span className="fm-code-line">{line || " "}</span>
              {index < lines.length - 1 ? "\n" : null}
            </Fragment>
          ))}
        </code>
      </pre>
    </div>
  )
}

function DelimitedTablePreview({
  source,
  delimiter,
  label,
}: {
  source: string
  delimiter: string
  label: string
}) {
  const table = parseDelimitedTable(source, delimiter)

  if (table.headers.length === 0) {
    return <p className="fm-preview-note">This file appears to be empty.</p>
  }

  const cellStyle: CSSProperties = {
    padding: "6px 10px",
    borderBottom: "1px solid var(--app-border)",
    textAlign: "left",
    verticalAlign: "top",
    whiteSpace: "nowrap",
    maxWidth: 320,
    overflow: "hidden",
    textOverflow: "ellipsis",
  }

  return (
    <div className="fm-code-wrap">
      <div className="fm-code-bar">
        <span className="fm-code-lang">{label}</span>
      </div>
      <div
        role="region"
        aria-label={`${label} parsed table preview`}
        tabIndex={0}
        style={{ overflow: "auto", maxHeight: 420 }}
      >
        <table
          style={{
            borderCollapse: "collapse",
            fontSize: 12,
            fontFamily: "IBM Plex Mono, ui-monospace, monospace",
            color: "var(--app-text)",
            minWidth: "100%",
          }}
        >
          <thead>
            <tr>
              {table.headers.map((header, index) => (
                <th
                  key={index}
                  scope="col"
                  style={{
                    ...cellStyle,
                    position: "sticky",
                    top: 0,
                    background: "var(--app-panel-alt)",
                    fontWeight: 600,
                  }}
                >
                  {header || `Column ${index + 1}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} style={cellStyle}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.truncated ? (
        <p className="fm-preview-note" style={{ margin: "8px 0 0" }}>
          Showing the first {DELIMITED_MAX_ROWS} rows. Download the file to see all rows.
        </p>
      ) : null}
    </div>
  )
}

function UnsupportedCard({
  file,
  detail,
  onDownload,
}: {
  file: FileNode
  detail: string
  onDownload: (file: FileNode) => void
}) {
  return (
    <div className="fm-fallback" role="note">
      <FileText className="fm-fallback-icon" aria-hidden="true" />
      <div className="fm-fallback-text">
        <strong>{file.name}</strong>
        <span>
          {fileTypeLabel(file)} · {formatBytes(file.sizeBytes)}
        </span>
        <p className="fm-preview-note">
          Preview is not available for this file type. {detail} Download the file to view its
          contents.
        </p>
      </div>
      <button type="button" className="fm-btn fm-btn--solid" onClick={() => onDownload(file)}>
        <Download aria-hidden="true" /> Download
      </button>
    </div>
  )
}

function PreviewSkeleton() {
  return (
    <div className="fm-drawer-skeleton" aria-hidden="true">
      <Skeleton className="h-4 w-1/3" />
      <SkeletonText lines={7} />
      <Skeleton className="h-40 w-full" />
      <SkeletonText lines={3} />
    </div>
  )
}

export function FilePreviewDrawer({
  file,
  files,
  projectId,
  onClose,
  onDownload,
  onDelete,
  versions,
  previewUrl,
  onRename,
  onRestore,
  error,
  onRetry,
}: {
  file: FileNode
  files: FileNode[]
  projectId: string
  onClose: () => void
  onDownload: (file: FileNode) => void
  onDelete: (file: FileNode) => void
  /** Optional version history; the API does not expose this yet. */
  versions?: FileVersion[]
  /** Optional URL for binary previews (image/pdf/video); falls back to a
   * URL-looking `file.content` value when present. */
  previewUrl?: string
  /** Optional rename handler wired to `workspace.renameFileNode`. */
  onRename?: (file: FileNode, name: string) => void | Promise<unknown>
  /** Optional restore handler wired to `workspace.restoreFileNodeVersion`;
   * enables the per-version Restore action. */
  onRestore?: (file: FileNode, version: FileVersion) => void | Promise<unknown>
  /** Upstream load error; shows the error state instead of the preview. */
  error?: string | null
  onRetry?: () => void
}) {
  const [loaded, setLoaded] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copiedContent, setCopiedContent] = useState(false)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [viewingVersion, setViewingVersion] = useState<FileVersion | null>(null)
  const [diffVersionId, setDiffVersionId] = useState<string | null>(null)
  const [restorePending, setRestorePending] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState(file.name)
  const [renamePending, setRenamePending] = useState(false)
  const renameButtonRef = useRef<HTMLButtonElement>(null)
  const wasRenaming = useRef(false)
  const { toast } = useToast()

  // When the rename form closes, return focus to the button that opened it.
  useEffect(() => {
    if (wasRenaming.current && !renaming) renameButtonRef.current?.focus()
    wasRenaming.current = renaming
  }, [renaming])

  useEffect(() => {
    setLoaded(false)
    setMediaError(null)
    setViewingVersion(null)
    setDiffVersionId(null)
    setRestorePending(false)
    setRenaming(false)
    setDraftName(file.name)
    const timer = window.setTimeout(() => setLoaded(true), PREVIEW_LOAD_MS)
    return () => window.clearTimeout(timer)
  }, [file.id, file.name])

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(timer)
  }, [copied])

  useEffect(() => {
    if (!copiedContent) return
    const timer = window.setTimeout(() => setCopiedContent(false), 1600)
    return () => window.clearTimeout(timer)
  }, [copiedContent])

  const folderPath = useMemo(() => {
    const segments = fileNodePath(files, file).slice(0, -1)
    return segments.length ? segments.join(" / ") : "Project root"
  }, [files, file])
  const fullPath = useMemo(() => fileNodePath(files, file).join(" / "), [files, file])

  // When a historical version is selected it supplies the preview payload.
  const previewFile = useMemo<FileNode>(() => {
    if (!viewingVersion) return file
    return {
      ...file,
      // No fallback to `file.content`: a version without its own snapshot must
      // not preview the current content under the historical label.
      content: viewingVersion.content,
      sizeBytes: viewingVersion.sizeBytes ?? file.sizeBytes,
      updatedAt: viewingVersion.createdAt,
    }
  }, [file, viewingVersion])
  const previewKindForFile = useMemo(() => previewKind(previewFile), [previewFile])

  const resolvedPreviewUrl = useMemo(() => {
    if (viewingVersion?.url) return viewingVersion.url
    if (previewUrl) return previewUrl
    if (isUrlLike(previewFile.content)) return previewFile.content
    return undefined
  }, [previewUrl, previewFile.content, viewingVersion?.url])

  const versionRows = useMemo(() => {
    const rows: (FileVersion & { current?: boolean })[] = [
      {
        id: "current",
        label: "Current",
        createdAt: file.updatedAt,
        author: file.owner,
        sizeBytes: file.sizeBytes,
        content: file.content,
        current: true,
      },
      ...(versions ?? []),
    ]
    return rows
  }, [file, versions])

  const copyLink = async () => {
    const segments = fileNodePath(files, file).slice(0, -1).map(encodeURIComponent).join("/")
    const url = `${window.location.origin}/projects/${projectId}/files${
      segments ? `/${segments}` : ""
    }?preview=${encodeURIComponent(file.id)}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      setCopied(false)
      toast({
        variant: "error",
        title: "Couldn't copy link",
        description: "Your browser blocked clipboard access. Copy the URL manually.",
      })
    }
  }

  const copyContent = async () => {
    const content = previewFile.content
    if (!content) return
    try {
      await navigator.clipboard.writeText(content)
      setCopiedContent(true)
    } catch {
      toast({
        variant: "error",
        title: "Couldn't copy contents",
        description: "Your browser blocked clipboard access.",
      })
    }
  }

  const submitRename = async () => {
    const name = draftName.trim()
    if (!onRename || !name || name === file.name) {
      setRenaming(false)
      return
    }
    setRenamePending(true)
    try {
      await onRename(file, name)
      setRenaming(false)
    } catch (renameError) {
      toast({
        variant: "error",
        title: "Couldn't rename file",
        description: renameError instanceof Error ? renameError.message : "Please try again.",
      })
    } finally {
      setRenamePending(false)
    }
  }

  const downloadVersion = (version: FileVersion & { current?: boolean }) => {
    if (version.current) {
      onDownload(file)
      return
    }
    if (version.url && isSafePreviewHref(version.url)) {
      const anchor = document.createElement("a")
      anchor.href = version.url
      anchor.download = `${file.name}.${version.label}`
      anchor.rel = "noreferrer"
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      return
    }
    onDownload(file)
  }

  const restoreVersion = async (version: FileVersion) => {
    if (version.content == null || !onRestore || restorePending) return
    setRestorePending(true)
    try {
      await onRestore(file, version)
      setViewingVersion(null)
      setDiffVersionId(null)
      toast({
        variant: "success",
        title: `Restored ${version.label}`,
        description: `${file.name} now matches version ${version.label}. The previous content was kept as a new version.`,
      })
    } catch (restoreError) {
      toast({
        variant: "error",
        title: "Couldn't restore version",
        description: restoreError instanceof Error ? restoreError.message : "Please try again.",
      })
    } finally {
      setRestorePending(false)
    }
  }

  const showCopyContent =
    (previewKindForFile === "code" ||
      previewKindForFile === "markdown" ||
      previewKindForFile === "table") &&
    Boolean(previewFile.content)

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right top-0 right-0 bottom-0 left-0 w-full max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none p-0 sm:left-auto sm:max-w-xl"
      >
        <div className="fm-drawer">
          <header className="fm-drawer-head">
            <div className="fm-drawer-heading">
              <FileText className="fm-drawer-icon" aria-hidden="true" />
              <div className="fm-drawer-title">
                {renaming ? (
                  <>
                    {/* Radix requires a DialogTitle for the accessible name;
                        keep it mounted (visually hidden) while renaming. */}
                    <DialogTitle className="sr-only">{file.name}</DialogTitle>
                    <form
                      className="fm-rename"
                      onSubmit={(event) => {
                        event.preventDefault()
                        void submitRename()
                      }}
                    >
                      <input
                        className="fm-rename-input"
                        value={draftName}
                        onChange={(event) => setDraftName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.stopPropagation()
                            setRenaming(false)
                            setDraftName(file.name)
                          }
                        }}
                        aria-label="Rename file"
                        autoFocus
                        disabled={renamePending}
                      />
                      <button
                        type="submit"
                        className="fm-btn fm-btn--solid fm-rename-save"
                        disabled={renamePending || !draftName.trim()}
                        aria-label="Save name"
                      >
                        <Check aria-hidden="true" />
                      </button>
                    </form>
                  </>
                ) : (
                  <DialogTitle className="fm-drawer-name">
                    {file.name}
                    {onRename ? (
                      <button
                        ref={renameButtonRef}
                        type="button"
                        className="fm-icon-btn"
                        aria-label="Rename file"
                        onClick={() => {
                          setDraftName(file.name)
                          setRenaming(true)
                        }}
                      >
                        <Pencil aria-hidden="true" />
                      </button>
                    ) : null}
                  </DialogTitle>
                )}
                <DialogDescription className="fm-drawer-meta">
                  {fileTypeLabel(previewFile)} · {formatBytes(previewFile.sizeBytes)} ·{" "}
                  {viewingVersion
                    ? `version ${viewingVersion.label} by ${viewingVersion.author}`
                    : `updated ${formatDate(previewFile.updatedAt)}`}
                </DialogDescription>
              </div>
            </div>
            <DialogClose asChild>
              <button type="button" className="fm-btn fm-drawer-close" aria-label="Close preview">
                <X aria-hidden="true" />
              </button>
            </DialogClose>
          </header>

          <div className="fm-drawer-path" title={fullPath}>
            {folderPath}
          </div>

          <div className="fm-drawer-body">
            {error ? (
              <div className="fm-fallback fm-fallback--error" role="alert">
                <AlertTriangle className="fm-fallback-icon" aria-hidden="true" />
                <div className="fm-fallback-text">
                  <strong>Preview failed to load</strong>
                  <p className="fm-preview-note">{error}</p>
                </div>
                {onRetry ? (
                  <button type="button" className="fm-btn" onClick={onRetry}>
                    Try again
                  </button>
                ) : null}
              </div>
            ) : !loaded ? (
              <PreviewSkeleton />
            ) : previewKindForFile === "image" ? (
              resolvedPreviewUrl ? (
                <img
                  className="fm-drawer-media"
                  src={resolvedPreviewUrl}
                  alt={previewFile.name}
                  onError={() => setMediaError("The image could not be decoded or loaded.")}
                />
              ) : mediaError ? (
                <UnsupportedCard file={previewFile} detail={mediaError} onDownload={onDownload} />
              ) : (
                <div
                  className="preview-image fm-drawer-image"
                  role="img"
                  aria-label={`${file.name} image preview placeholder`}
                />
              )
            ) : previewKindForFile === "pdf" ? (
              resolvedPreviewUrl ? (
                <iframe
                  className="fm-drawer-media fm-drawer-frame"
                  src={resolvedPreviewUrl}
                  title={`${previewFile.name} PDF preview`}
                />
              ) : (
                <UnsupportedCard
                  file={previewFile}
                  detail="A downloadable URL is required to render PDFs inline."
                  onDownload={onDownload}
                />
              )
            ) : previewKindForFile === "video" ? (
              resolvedPreviewUrl ? (
                <video
                  className="fm-drawer-media"
                  src={resolvedPreviewUrl}
                  controls
                  preload="metadata"
                  aria-label={`${previewFile.name} video preview`}
                />
              ) : (
                <UnsupportedCard
                  file={previewFile}
                  detail="A downloadable URL is required to stream video inline."
                  onDownload={onDownload}
                />
              )
            ) : previewKindForFile === "audio" ? (
              resolvedPreviewUrl ? (
                <div className="fm-audio">
                  <audio
                    src={resolvedPreviewUrl}
                    controls
                    preload="metadata"
                    aria-label={`${previewFile.name} audio preview`}
                  />
                </div>
              ) : (
                <UnsupportedCard
                  file={previewFile}
                  detail="A downloadable URL is required to stream audio inline."
                  onDownload={onDownload}
                />
              )
            ) : previewKindForFile === "markdown" ? (
              <MarkdownPreview source={previewFile.content ?? ""} />
            ) : previewKindForFile === "table" ? (
              <DelimitedTablePreview
                source={previewFile.content ?? ""}
                delimiter={fileExtension(previewFile.name) === "TSV" ? "\t" : ","}
                label={fileExtension(previewFile.name)}
              />
            ) : previewKindForFile === "code" ? (
              <CodePreview code={previewFile.content ?? ""} label={languageLabelFor(previewFile)} />
            ) : previewKindForFile === "folder" ? (
              <p className="fm-preview-note">
                This is a folder. Open it in the file browser to see its contents.
              </p>
            ) : (
              <UnsupportedCard
                file={previewFile}
                detail="This file type has no inline renderer."
                onDownload={onDownload}
              />
            )}

            {viewingVersion ? (
              <div className="fm-version-banner" role="status">
                <span>
                  Viewing version {viewingVersion.label} · {formatDate(viewingVersion.createdAt)} by{" "}
                  {viewingVersion.author}
                </span>
                <button type="button" className="fm-btn" onClick={() => setViewingVersion(null)}>
                  Back to current
                </button>
              </div>
            ) : null}

            <section className="fm-details" aria-label="File details">
              <h3 className="fm-details-title">Details</h3>
              <dl className="fm-details-grid">
                <div>
                  <dt>Type</dt>
                  <dd>{fileTypeLabel(file)}</dd>
                </div>
                <div>
                  <dt>Size</dt>
                  <dd>{formatBytes(file.sizeBytes)}</dd>
                </div>
                <div>
                  <dt>Owner</dt>
                  <dd>{file.owner || "—"}</dd>
                </div>
                <div>
                  <dt>Modified</dt>
                  <dd>{formatDate(file.updatedAt)}</dd>
                </div>
                <div className="fm-details-wide">
                  <dt>Location</dt>
                  <dd title={fullPath}>{fullPath}</dd>
                </div>
              </dl>
            </section>

            <section className="fm-versions" aria-label="Version history">
              <h3 className="fm-details-title">
                <History aria-hidden="true" /> Version history
              </h3>
              {versionRows.length > 1 ? (
                <ul className="fm-version-list">
                  {versionRows.map((version) => {
                    const isViewing = viewingVersion?.id === version.id && !version.current
                    const isDiffing = diffVersionId === version.id
                    const canDiff =
                      !version.current && version.content != null && file.content != null
                    const canRestore =
                      !version.current && version.content != null && Boolean(onRestore)
                    return (
                      <li
                        key={version.id}
                        className={isViewing ? "fm-version is-active" : "fm-version"}
                      >
                        <div className="fm-version-main">
                          <strong>{version.current ? "Current version" : version.label}</strong>
                          <span>
                            {formatDate(version.createdAt)} · {version.author}
                            {version.sizeBytes != null && !version.current
                              ? ` · ${formatBytes(version.sizeBytes)}`
                              : ""}
                          </span>
                        </div>
                        <div className="fm-version-actions">
                          {!version.current && (version.content || version.url) ? (
                            <button
                              type="button"
                              className="fm-btn"
                              aria-pressed={isViewing}
                              onClick={() =>
                                setViewingVersion(isViewing ? null : (version as FileVersion))
                              }
                            >
                              {isViewing ? "Viewing" : "View"}
                            </button>
                          ) : null}
                          {canDiff ? (
                            <button
                              type="button"
                              className="fm-btn"
                              aria-pressed={isDiffing}
                              onClick={() => setDiffVersionId(isDiffing ? null : version.id)}
                            >
                              {isDiffing ? "Hide diff" : "Diff"}
                            </button>
                          ) : null}
                          {canRestore ? (
                            <button
                              type="button"
                              className="fm-btn"
                              disabled={restorePending}
                              onClick={() => void restoreVersion(version as FileVersion)}
                            >
                              <RotateCcw aria-hidden="true" />
                              {restorePending ? "Restoring…" : "Restore"}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="fm-btn"
                            onClick={() => downloadVersion(version)}
                          >
                            <Download aria-hidden="true" /> Download
                          </button>
                        </div>
                        {isDiffing && version.content != null && file.content != null ? (
                          <div className="fm-version-diff">
                            <p className="fm-preview-note">
                              Changes since {version.label}: lines removed from that version are
                              marked −, lines added since are marked +.
                            </p>
                            <DiffViewer
                              oldText={version.content}
                              newText={file.content}
                              maxLines={200}
                            />
                          </div>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="fm-preview-note">
                  Only the current version is available. Earlier versions will appear here once the
                  files API exposes history.
                </p>
              )}
            </section>
          </div>

          <footer className="fm-drawer-actions">
            {showCopyContent ? (
              <button type="button" className="fm-btn" onClick={() => void copyContent()}>
                {copiedContent ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                {copiedContent ? "Copied" : "Copy contents"}
              </button>
            ) : null}
            <button type="button" className="fm-btn fm-btn--solid" onClick={() => onDownload(file)}>
              <Download aria-hidden="true" /> Download
            </button>
            <button type="button" className="fm-btn" onClick={() => void copyLink()}>
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              {copied ? "Copied" : "Copy link"}
            </button>
            <button type="button" className="fm-btn fm-btn--danger" onClick={() => onDelete(file)}>
              <Trash2 aria-hidden="true" /> Delete
            </button>
          </footer>
        </div>
      </DialogContent>
    </Dialog>
  )
}
