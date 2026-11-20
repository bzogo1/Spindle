"use client"

import { useMemo, useState } from "react"
import { Flame, Play } from "lucide-react"

import {
  dryRunGraph,
  getNode,
  profileDryRun,
  validateGraph,
  type AutomationGraph,
  type ProfileReport,
} from "@/lib/automation-graph"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface ProfilerPanelProps {
  graph: AutomationGraph
}

/**
 * Per-node profiling for a dry run: timing share per node, a flame-style bar
 * view in execution order, and bottleneck highlighting.
 */
export function ProfilerPanel({ graph }: ProfilerPanelProps) {
  const [profile, setProfile] = useState<ProfileReport | null>(null)

  const hasErrors = useMemo(
    () => validateGraph(graph).some((issue) => issue.severity === "error"),
    [graph],
  )

  function run() {
    const report = dryRunGraph(graph, { seed: 5 })
    setProfile(profileDryRun(graph, report))
  }

  const maxDuration = profile ? Math.max(1, ...profile.nodes.map((n) => n.durationMs)) : 1

  return (
    <section
      className="border-border bg-card flex flex-col gap-2 rounded-lg border p-3"
      aria-labelledby="builder-profiler-heading"
    >
      <div className="flex items-center justify-between gap-2">
        <h3
          id="builder-profiler-heading"
          className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase"
        >
          <Flame className="size-3.5" aria-hidden="true" />
          Profiler
        </h3>
        <Button type="button" size="sm" onClick={run} disabled={hasErrors}>
          <Play aria-hidden="true" />
          {profile ? "Re-run profile" : "Profile run"}
        </Button>
      </div>

      {hasErrors && !profile ? (
        <p className="text-muted-foreground text-[11px]">Fix validation errors before profiling.</p>
      ) : null}

      {profile ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-muted-foreground text-[11px]">
            Total {profile.totalMs}ms ·{" "}
            {profile.bottleneckNodeId
              ? `bottleneck: ${getNode(graph, profile.bottleneckNodeId)?.label ?? profile.bottleneckNodeId}`
              : "no executed nodes"}
          </p>
          <ol className="flex max-h-56 flex-col gap-1 overflow-y-auto">
            {profile.nodes.map((nodeProfile) => {
              const isBottleneck = nodeProfile.nodeId === profile.bottleneckNodeId
              const widthPct = Math.max(2, (nodeProfile.durationMs / maxDuration) * 100)
              return (
                <li key={nodeProfile.nodeId} className="flex items-center gap-2">
                  <span className="w-24 shrink-0 truncate text-[10px]">{nodeProfile.label}</span>
                  <div className="bg-muted/60 relative h-4 min-w-0 flex-1 overflow-hidden rounded">
                    <div
                      className={cn(
                        "flex h-full items-center rounded",
                        isBottleneck
                          ? "bg-red-500/70"
                          : nodeProfile.status === "error"
                            ? "bg-red-400/50"
                            : nodeProfile.status === "skipped"
                              ? "bg-zinc-500/30"
                              : "bg-sky-500/50",
                      )}
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                  <span className="text-muted-foreground w-14 shrink-0 text-right text-[9px]">
                    {nodeProfile.durationMs}ms · {(nodeProfile.share * 100).toFixed(0)}%
                  </span>
                  {profile.hotspots.includes(nodeProfile) ? (
                    <Badge
                      variant="secondary"
                      className="bg-amber-500/15 text-[8px] text-amber-600"
                    >
                      hot
                    </Badge>
                  ) : null}
                </li>
              )
            })}
          </ol>
        </div>
      ) : (
        <p className="text-muted-foreground text-[11px]">
          Profiles a dry run and shows per-node timing as a flame-style bar chart.
        </p>
      )}
    </section>
  )
}
