"use client"

import { useState } from "react"
import { History, MessageSquare, RotateCcw, Save, Trash2 } from "lucide-react"

import {
  describeDiff,
  diffGraphs,
  nodeLabel,
  type AutomationGraph,
  type GraphVersion,
} from "@/lib/automation-graph"
import { formatDateTime, formatRelativeTime } from "@/components/app/format"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface VersionHistoryPanelProps {
  /** Newest-first versions for the current scope. */
  versions: GraphVersion[]
  onRestore: (graph: AutomationGraph) => void
  /** Record an explicit snapshot; `label` is optional. */
  onSnapshot: (label?: string) => void
  onDelete: (versionId: string) => void
  /** Current canvas graph — enables "diff vs current" on the newest version. */
  currentGraph?: AutomationGraph
  /** Persist a comment on a version (see `updateGraphVersionComment`). */
  onUpdateComment?: (versionId: string, comment: string) => void
}

function DiffDetails({ before, after }: { before: AutomationGraph; after: AutomationGraph }) {
  const diff = diffGraphs(before, after)
  return (
    <div className="text-muted-foreground flex flex-col gap-1 text-[10px]">
      <p>{describeDiff(diff)}</p>
      {diff.changedNodes.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {diff.changedNodes.slice(0, 6).map((change) => (
            <li key={change.nodeId}>
              ~ {change.label}: {change.changes.map((c) => c.field).join(", ")}
            </li>
          ))}
          {diff.changedNodes.length > 6 ? <li>…and {diff.changedNodes.length - 6} more</li> : null}
        </ul>
      ) : null}
      {diff.addedNodes.length > 0 ? (
        <p>+ {diff.addedNodes.map((n) => n.label).join(", ")}</p>
      ) : null}
      {diff.removedNodes.length > 0 ? (
        <p>− {diff.removedNodes.map((n) => nodeLabel(before, n.id)).join(", ")}</p>
      ) : null}
    </div>
  )
}

function VersionComment({
  version,
  onUpdateComment,
}: {
  version: GraphVersion
  onUpdateComment?: (versionId: string, comment: string) => void
}) {
  const [draft, setDraft] = useState(version.comment ?? "")

  if (!onUpdateComment) {
    return version.comment ? (
      <p className="text-muted-foreground flex items-start gap-1 text-[10px] italic">
        <MessageSquare className="mt-px size-2.5 shrink-0" aria-hidden="true" />
        {version.comment}
      </p>
    ) : null
  }

  return (
    <Input
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft.trim() !== (version.comment ?? "")) onUpdateComment(version.id, draft)
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur()
        }
      }}
      placeholder="Add a comment…"
      aria-label={`Comment for version ${version.label ?? version.graph.name}`}
      className="h-6 px-1.5 text-[10px]"
      maxLength={140}
    />
  )
}

/**
 * Version history for the automation graph: named/auto snapshots persisted
 * to localStorage by `src/lib/automation-graph/history.ts`, with per-version
 * comments and diffs against the previous snapshot. Restore replaces the
 * canvas with the stored graph.
 */
export function VersionHistoryPanel({
  versions,
  onRestore,
  onSnapshot,
  onDelete,
  currentGraph,
  onUpdateComment,
}: VersionHistoryPanelProps) {
  const [label, setLabel] = useState("")

  function handleSnapshot() {
    onSnapshot(label)
    setLabel("")
  }

  return (
    <section
      className="border-border bg-card flex flex-col gap-2 rounded-lg border p-3"
      aria-labelledby="builder-version-history-heading"
    >
      <h3
        id="builder-version-history-heading"
        className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase"
      >
        <History className="size-3" aria-hidden="true" />
        Version history
      </h3>

      <div className="flex gap-1.5">
        <Input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Label (optional)"
          aria-label="Version label"
          className="h-8 min-w-0 flex-1 text-xs"
          maxLength={60}
        />
        <Button type="button" variant="outline" size="sm" onClick={handleSnapshot}>
          <Save aria-hidden="true" />
          Snapshot
        </Button>
      </div>

      {versions.length === 0 ? (
        <p className="border-border/60 text-muted-foreground border-t pt-2 text-[11px]">
          No saved versions yet. Edits are snapshotted automatically; use Snapshot to pin a named
          checkpoint.
        </p>
      ) : (
        <ul className="border-border/60 mt-1 flex max-h-64 flex-col gap-1 overflow-y-auto border-t pt-2">
          {versions.map((version, index) => {
            // Diff against the next older version; for the newest entry also
            // offer a diff against the live canvas.
            const older = versions[index + 1]
            const vsCurrent =
              index === 0 && currentGraph ? diffGraphs(version.graph, currentGraph) : null
            return (
              <li
                key={version.id}
                className="border-border/60 flex flex-col gap-1 rounded border px-1.5 py-1.5"
              >
                <div className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
                    {version.label ?? version.graph.name}
                  </span>
                  <button
                    type="button"
                    className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive rounded p-0.5"
                    aria-label={`Delete version ${version.label ?? version.graph.name}`}
                    onClick={() => onDelete(version.id)}
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
                <VersionComment version={version} onUpdateComment={onUpdateComment} />
                <p
                  className="text-muted-foreground text-[10px]"
                  title={formatDateTime(version.createdAt)}
                >
                  {version.graph.nodes.length} node
                  {version.graph.nodes.length === 1 ? "" : "s"} · {version.graph.edges.length}{" "}
                  connection{version.graph.edges.length === 1 ? "" : "s"} ·{" "}
                  {formatRelativeTime(version.createdAt)}
                </p>
                {older ? (
                  <details className="text-[10px]">
                    <summary className="text-muted-foreground hover:text-foreground cursor-pointer">
                      Changes vs previous version
                    </summary>
                    <div className="mt-1">
                      <DiffDetails before={older.graph} after={version.graph} />
                    </div>
                  </details>
                ) : null}
                {vsCurrent && !vsCurrent.unchanged ? (
                  <details className="text-[10px]">
                    <summary className="text-muted-foreground hover:text-foreground cursor-pointer">
                      Diff vs current canvas
                    </summary>
                    <div className="mt-1">
                      <DiffDetails before={version.graph} after={currentGraph!} />
                    </div>
                  </details>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 w-full text-[11px]"
                  onClick={() => onRestore(version.graph)}
                >
                  <RotateCcw aria-hidden="true" />
                  Restore this version
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
