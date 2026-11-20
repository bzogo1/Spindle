"use client"

import { useMemo } from "react"
import { ShieldAlert, ShieldCheck } from "lucide-react"

import {
  scanGraphSecurity,
  securitySummary,
  type AutomationGraph,
  type SecuritySeverity,
} from "@/lib/automation-graph"
import { cn } from "@/lib/utils"

interface SecurityPanelProps {
  graph: AutomationGraph
}

const SEVERITY_STYLE: Record<SecuritySeverity, string> = {
  critical: "bg-red-500/15 text-red-600 dark:text-red-400",
  warning: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  info: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
}

/**
 * Security scan of the graph: secrets in params, injection-looking strings,
 * external URLs, unvalidated inputs, and ungated actions — with severities.
 */
export function SecurityPanel({ graph }: SecurityPanelProps) {
  const findings = useMemo(() => scanGraphSecurity(graph), [graph])
  const summary = useMemo(() => securitySummary(findings), [findings])

  return (
    <section
      className="border-border bg-card flex flex-col gap-2 rounded-lg border p-3"
      aria-labelledby="builder-security-heading"
    >
      <div className="flex items-center justify-between gap-2">
        <h3
          id="builder-security-heading"
          className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase"
        >
          <ShieldAlert className="size-3.5" aria-hidden="true" />
          Security scan
        </h3>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-semibold",
            summary.clean
              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
              : summary.critical > 0
                ? "bg-red-500/15 text-red-600 dark:text-red-400"
                : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
          )}
        >
          {summary.clean
            ? "Clean"
            : `${summary.critical} critical · ${summary.warning} warning${summary.info ? ` · ${summary.info} info` : ""}`}
        </span>
      </div>

      {findings.length === 0 ? (
        <p className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
          <ShieldCheck className="size-3.5 text-emerald-500" aria-hidden="true" />
          No security findings.
        </p>
      ) : (
        <ul className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
          {findings.map((finding) => (
            <li key={finding.id} className="border-border/70 rounded-md border p-2">
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "rounded px-1 py-px text-[9px] font-semibold uppercase",
                    SEVERITY_STYLE[finding.severity],
                  )}
                >
                  {finding.severity}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
                  {finding.title}
                </span>
              </div>
              <p className="text-muted-foreground mt-1 text-[10px] leading-snug">
                {finding.detail}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
