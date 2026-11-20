"use client"

import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react"

import type { GraphIssue } from "@/lib/automation-graph"
import { cn } from "@/lib/utils"

interface ValidationPanelProps {
  issues: GraphIssue[]
  /** Called when an issue row is activated; lets the builder select the node/edge. */
  onSelectIssue?: (issue: GraphIssue) => void
}

export function ValidationPanel({ issues, onSelectIssue }: ValidationPanelProps) {
  const errors = issues.filter((issue) => issue.severity === "error")
  const warnings = issues.filter((issue) => issue.severity === "warning")

  return (
    <section
      className="border-border bg-card flex flex-col gap-2 rounded-lg border p-3"
      aria-labelledby="builder-validation-heading"
    >
      <div className="flex items-center justify-between">
        <h3
          id="builder-validation-heading"
          className="text-muted-foreground text-xs font-semibold tracking-wide uppercase"
        >
          Validation
        </h3>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-semibold",
            errors.length > 0
              ? "bg-destructive/15 text-destructive"
              : warnings.length > 0
                ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
          )}
        >
          {errors.length > 0
            ? `${errors.length} error${errors.length === 1 ? "" : "s"}`
            : warnings.length > 0
              ? `${warnings.length} warning${warnings.length === 1 ? "" : "s"}`
              : "Valid"}
        </span>
      </div>

      {issues.length === 0 ? (
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <CheckCircle2 className="size-3.5 text-emerald-500" aria-hidden="true" />
          No issues found.
        </p>
      ) : (
        <ul className="flex max-h-40 flex-col gap-1.5 overflow-y-auto">
          {issues.map((issue, index) => {
            const icon =
              issue.severity === "error" ? (
                <XCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              )
            const key = `${issue.code}-${issue.edgeId ?? issue.nodeId ?? index}`
            return (
              <li
                key={key}
                className={cn(
                  "rounded-md border px-2 py-1.5 text-[11px] leading-snug",
                  issue.severity === "error"
                    ? "border-destructive/30 bg-destructive/5 text-destructive"
                    : "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300",
                )}
              >
                {onSelectIssue ? (
                  <button
                    type="button"
                    className="flex w-full cursor-pointer items-start gap-1.5 text-left"
                    onClick={() => onSelectIssue(issue)}
                  >
                    {icon}
                    <span>{issue.message}</span>
                  </button>
                ) : (
                  <span className="flex items-start gap-1.5">
                    {icon}
                    <span>{issue.message}</span>
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
