"use client"

import { useMemo } from "react"
import { Wand2, Wrench } from "lucide-react"

import {
  analyzeGraph,
  applyOptimization,
  type AutomationGraph,
  type OptimizationSuggestion,
} from "@/lib/automation-graph"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface OptimizationPanelProps {
  graph: AutomationGraph
  /** Called with the fixed graph when the user applies a suggestion. */
  onApply: (graph: AutomationGraph) => void
}

/**
 * Static-analysis optimization suggestions (unused nodes, redundant identity
 * transforms, mergeable chains, duplicates) with apply buttons for the
 * mechanical fixes.
 */
export function OptimizationPanel({ graph, onApply }: OptimizationPanelProps) {
  const suggestions = useMemo(() => analyzeGraph(graph), [graph])

  function handleApply(suggestion: OptimizationSuggestion) {
    onApply(applyOptimization(graph, suggestion))
  }

  return (
    <section
      className="border-border bg-card flex flex-col gap-2 rounded-lg border p-3"
      aria-labelledby="builder-optimization-heading"
    >
      <h3
        id="builder-optimization-heading"
        className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase"
      >
        <Wrench className="size-3.5" aria-hidden="true" />
        Optimization
      </h3>

      {suggestions.length === 0 ? (
        <p className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
          <Wand2 className="size-3" aria-hidden="true" />
          No optimization opportunities found.
        </p>
      ) : (
        <ul className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
          {suggestions.map((suggestion) => (
            <li
              key={suggestion.id}
              className="border-border/70 flex flex-col gap-1 rounded-md border p-2"
            >
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "rounded px-1 py-px text-[9px] font-semibold uppercase",
                    suggestion.severity === "warning"
                      ? "bg-amber-500/15 text-amber-600"
                      : "bg-sky-500/15 text-sky-600",
                  )}
                >
                  {suggestion.severity}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
                  {suggestion.title}
                </span>
                {suggestion.fix ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 px-1.5 text-[10px]"
                    onClick={() => handleApply(suggestion)}
                  >
                    Apply
                  </Button>
                ) : null}
              </div>
              <p className="text-muted-foreground text-[10px] leading-snug">{suggestion.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
