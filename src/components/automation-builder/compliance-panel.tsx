"use client"

import { useMemo } from "react"
import { CheckCircle2, ClipboardCheck, XCircle } from "lucide-react"

import {
  checkCompliance,
  DEFAULT_COMPLIANCE_POLICY,
  type AutomationGraph,
} from "@/lib/automation-graph"
import { cn } from "@/lib/utils"

interface CompliancePanelProps {
  graph: AutomationGraph
  /** Override the default policy; falls back to DEFAULT_COMPLIANCE_POLICY. */
  policy?: Parameters<typeof checkCompliance>[1]
}

/**
 * Compliance report against the (configurable) policy plus a publish gate:
 * error-severity failures block publishing, warnings are advisory.
 */
export function CompliancePanel({ graph, policy }: CompliancePanelProps) {
  const report = useMemo(
    () => checkCompliance(graph, policy ?? DEFAULT_COMPLIANCE_POLICY),
    [graph, policy],
  )

  return (
    <section
      className="border-border bg-card flex flex-col gap-2 rounded-lg border p-3"
      aria-labelledby="builder-compliance-heading"
    >
      <div className="flex items-center justify-between gap-2">
        <h3
          id="builder-compliance-heading"
          className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase"
        >
          <ClipboardCheck className="size-3.5" aria-hidden="true" />
          Compliance
        </h3>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-semibold",
            report.publishable
              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
              : "bg-red-500/15 text-red-600 dark:text-red-400",
          )}
          aria-live="polite"
        >
          {report.publishable
            ? report.warningCount > 0
              ? `Publishable · ${report.warningCount} warning${report.warningCount === 1 ? "" : "s"}`
              : "Ready to publish"
            : `Blocked · ${report.errorCount} failing check${report.errorCount === 1 ? "" : "s"}`}
        </span>
      </div>

      <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
        {report.checks.map((check) => (
          <li key={check.id} className="flex items-start gap-1.5">
            {check.passed ? (
              <CheckCircle2
                className="mt-0.5 size-3 shrink-0 text-emerald-500"
                aria-hidden="true"
              />
            ) : (
              <XCircle
                className={cn(
                  "mt-0.5 size-3 shrink-0",
                  check.severity === "error" ? "text-red-500" : "text-amber-500",
                )}
                aria-hidden="true"
              />
            )}
            <div className="min-w-0">
              <p className="text-[11px] leading-tight font-medium">{check.label}</p>
              {!check.passed ? (
                <p className="text-muted-foreground text-[10px] leading-snug">{check.detail}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
