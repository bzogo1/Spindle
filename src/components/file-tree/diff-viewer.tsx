"use client"

/**
 * Inline diff panel for the file tree: renders the line diff between an
 * old and new file content with add/del/context highlighting.
 *
 * Usage:
 *   <DiffViewer oldText={before} newText={after} />
 *   // or compute once:
 *   const diff = diffFileContents(oldText, newText)
 *   <DiffViewer diff={diff} />
 */

import { diffFileContents, type FileDiff } from "@/lib/file-tree/diff"

export interface DiffViewerProps {
  oldText?: string
  newText?: string
  /** Precomputed diff (takes precedence over oldText/newText). */
  diff?: FileDiff
  /** Max lines rendered before truncation notice (default 500). */
  maxLines?: number
  className?: string
}

export function DiffViewer({
  oldText = "",
  newText = "",
  diff,
  maxLines = 500,
  className,
}: DiffViewerProps) {
  const resolved = diff ?? diffFileContents(oldText, newText)
  const visible = resolved.lines.slice(0, maxLines)
  const truncated = resolved.lines.length - visible.length

  return (
    <div
      className={className ? `ft-diff ${className}` : "ft-diff"}
      role="region"
      aria-label="File diff"
    >
      <div className="ft-diff-summary" aria-live="polite">
        {resolved.changed ? (
          <span>
            <span className="ft-diff-added">+{resolved.added}</span>{" "}
            <span className="ft-diff-removed">−{resolved.removed}</span>
          </span>
        ) : (
          <span>No changes</span>
        )}
      </div>
      {/* Rows are <div>s (not <pre>) so line markup stays valid HTML; the
          pre-wrap styling preserves diff formatting. */}
      <div className="ft-diff-body" style={{ whiteSpace: "pre", fontFamily: "monospace" }}>
        {visible.map((line, index) => (
          <div
            key={index}
            className={`ft-diff-line ft-diff-line--${line.type}`}
            data-line-type={line.type}
          >
            <span className="ft-diff-gutter">{line.oldLine ?? ""}</span>
            <span className="ft-diff-gutter">{line.newLine ?? ""}</span>
            <span className="ft-diff-sign" aria-hidden="true">
              {line.type === "add" ? "+" : line.type === "del" ? "−" : " "}
            </span>
            <span className="ft-diff-text">{line.text}</span>
          </div>
        ))}
      </div>
      {truncated > 0 ? <p className="ft-diff-truncated">… {truncated} more lines</p> : null}
    </div>
  )
}
