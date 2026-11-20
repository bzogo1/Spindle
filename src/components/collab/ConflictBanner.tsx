"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import type { ConflictResolution, TextConflict } from "@/lib/collab/conflict"

export interface ConflictBannerProps {
  conflicts: TextConflict[]
  /** Apply a resolution; the detector routes it through the CRDT. */
  onResolve: (conflictId: string, resolution: ConflictResolution) => void
  /** Label for the "local" side (default "Yours"). */
  localLabel?: string
  /** Label for the "remote" side (default "Theirs"). */
  remoteLabel?: string
  className?: string
}

/**
 * Resolution UI for concurrent same-range edits.
 *
 * Each conflict shows both versions side-by-side — what the local user
 * typed/deleted vs. what the remote peer contributed — with three choices:
 * keep yours, use theirs, or keep both (the CRDT's merged result).
 */
export function ConflictBanner({
  conflicts,
  onResolve,
  localLabel = "Yours",
  remoteLabel = "Theirs",
  className,
}: ConflictBannerProps) {
  if (conflicts.length === 0) return null

  return (
    <div className={cn("flex flex-col gap-2", className)} data-testid="conflict-banner">
      {conflicts.map((c) => (
        <div
          key={c.id}
          role="alert"
          data-conflict-id={c.id}
          data-conflict-kind={c.kind}
          className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3"
        >
          <p className="mb-2 text-xs font-medium text-amber-700 dark:text-amber-400">
            Concurrent edit detected — both versions are merged in the document.
          </p>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="border-border/60 bg-background/60 rounded border p-2">
              <div className="text-muted-foreground mb-1 text-[10px] font-semibold tracking-wide uppercase">
                {localLabel}
              </div>
              <pre className="font-mono text-xs whitespace-pre-wrap">
                {c.localText || <span className="text-muted-foreground">(deleted)</span>}
              </pre>
            </div>
            <div className="border-border/60 bg-background/60 rounded border p-2">
              <div className="text-muted-foreground mb-1 text-[10px] font-semibold tracking-wide uppercase">
                {remoteLabel}
              </div>
              <pre className="font-mono text-xs whitespace-pre-wrap">
                {c.remoteText || <span className="text-muted-foreground">(deleted)</span>}
              </pre>
            </div>
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => onResolve(c.id, "local")}
              className="bg-primary text-primary-foreground rounded-md px-2.5 py-1 text-xs font-medium hover:opacity-90"
            >
              Keep mine
            </button>
            <button
              type="button"
              onClick={() => onResolve(c.id, "remote")}
              className="border-border hover:bg-muted rounded-md border px-2.5 py-1 text-xs font-medium"
            >
              Use theirs
            </button>
            <button
              type="button"
              onClick={() => onResolve(c.id, "merge")}
              className="border-border text-muted-foreground hover:bg-muted rounded-md border px-2.5 py-1 text-xs font-medium"
            >
              Keep both
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
