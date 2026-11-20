"use client"

import { History, MapPin } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  isRolledBack,
  listCheckpoints,
  rollbackMarker,
  type AgentRun,
  type AgentRunCheckpoint,
} from "@/lib/agent-runs/core"

function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

function formatCost(usd: number | undefined): string {
  if (usd === undefined) return "—"
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

export interface CheckpointTimelineProps {
  run: AgentRun
  /** Seq the run is currently positioned at (defaults to latest event). */
  currentSeq?: number
  /** Called when the user clicks a checkpoint's restore action. */
  onRollback?: (checkpoint: AgentRunCheckpoint) => void
  /** Disable all restore buttons (e.g. while a rollback is in flight). */
  rollbackDisabled?: boolean
}

/**
 * Timeline of a run's checkpoints with per-checkpoint rollback affordance.
 * Pure presentational — the parent owns the actual `rollbackRun` mutation.
 */
export function CheckpointTimeline({
  run,
  currentSeq,
  onRollback,
  rollbackDisabled = false,
}: CheckpointTimelineProps) {
  const checkpoints = listCheckpoints(run)
  const position = currentSeq ?? (run.events.length > 0 ? run.events[run.events.length - 1].seq : 0)
  const rolledBack = isRolledBack(run)
  const marker = rollbackMarker(run)

  return (
    <section
      aria-label="Run checkpoints"
      className="bg-card text-card-foreground rounded-lg border"
      data-testid="checkpoint-timeline"
    >
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <History className="text-muted-foreground size-4" aria-hidden />
        <h3 className="text-sm font-medium">Checkpoints</h3>
        <Badge variant="secondary" size="sm">
          {checkpoints.length}
        </Badge>
        {rolledBack ? (
          <Badge variant="outline" size="sm" data-testid="rolled-back-badge">
            Rolled back
          </Badge>
        ) : null}
      </header>

      {checkpoints.length === 0 ? (
        <p className="text-muted-foreground px-4 py-6 text-sm">
          No checkpoints recorded for this run yet.
        </p>
      ) : (
        <ol className="divide-y">
          {checkpoints.map((checkpoint) => {
            const isCurrent = checkpoint.seq === position
            const truncated = checkpoint.seq < position
            return (
              <li
                key={checkpoint.id}
                className={cn("flex items-center gap-3 px-4 py-3", isCurrent && "bg-accent/50")}
                data-testid={`checkpoint-${checkpoint.id}`}
              >
                <MapPin
                  className={cn(
                    "size-4 shrink-0",
                    isCurrent ? "text-primary" : "text-muted-foreground",
                  )}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {checkpoint.name ?? `Checkpoint @ seq ${checkpoint.seq}`}
                    </span>
                    {isCurrent ? (
                      <Badge variant="default" size="sm">
                        current
                      </Badge>
                    ) : null}
                    {truncated && !isCurrent ? (
                      <Badge variant="outline" size="sm">
                        earlier
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    seq {checkpoint.seq} · {checkpoint.eventCount} events ·{" "}
                    {formatTimestamp(checkpoint.timestamp)} · est. cost{" "}
                    {formatCost(checkpoint.metrics?.costUsd)}
                  </p>
                </div>
                {onRollback ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={rollbackDisabled || isCurrent}
                    onClick={() => onRollback(checkpoint)}
                    aria-label={`Restore checkpoint ${checkpoint.name ?? checkpoint.seq}`}
                  >
                    Restore
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ol>
      )}

      {marker ? (
        <p className="text-muted-foreground border-t px-4 py-2 text-xs" data-testid="rollback-note">
          Last rollback truncated {String(marker.payload?.truncatedEvents ?? 0)} events
          {typeof marker.payload?.checkpointSeq === "number"
            ? ` at seq ${marker.payload.checkpointSeq}`
            : ""}
          .
        </p>
      ) : null}
    </section>
  )
}
