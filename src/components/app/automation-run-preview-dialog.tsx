"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { CheckCircle2, Loader2, Play } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { AutomationRunLog } from "./automation-run-log"

/** Minimal shape of an automation needed to preview a run. */
export interface AutomationRunSource {
  id: string
  name: string
  prompt?: string
  actionLabel?: string
  trigger?: { kind: string; label: string; detail: string; meta?: string }
  steps?: { id: string; kind: string; label: string; detail?: string }[]
  variables?: Record<string, string>
}

export interface AutomationRunResult {
  status: "succeeded" | "failed" | "cancelled"
  durationMs: number
  logs: string[]
}

interface RunStep {
  label: string
  detail?: string
  kind: string
}

const LINE_INTERVAL_MS = 420

function clockLabel(date: Date) {
  return date.toTimeString().slice(0, 8)
}

/** Replace `{{name}}` placeholders with defined automation variables. */
export function substituteVariables(text: string, variables: Record<string, string>) {
  return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] : match,
  )
}

/**
 * Build the deterministic log script for a mock run: a header, one entry per
 * configured step, variable resolution, and a completion line. Timestamps are
 * wall-clock so the streamed output matches the historical run format.
 */
export function buildRunScript(source: AutomationRunSource, startedAt: Date): string[] {
  const variables = source.variables ?? {}
  const subst = (text: string) => substituteVariables(text, variables)

  const steps: RunStep[] =
    source.steps && source.steps.length > 0
      ? source.steps.map((step) => ({
          kind: step.kind,
          label: step.label,
          detail: step.detail ? subst(step.detail) : undefined,
        }))
      : [
          {
            kind: "trigger",
            label: source.trigger
              ? `${source.trigger.label}: ${source.trigger.detail}`
              : "Manual trigger",
          },
          { kind: "action", label: source.actionLabel ?? "Run automation" },
        ]

  const lines: string[] = []
  const push = (offsetMs: number, text: string) => {
    lines.push(`${clockLabel(new Date(startedAt.getTime() + offsetMs))} ${text}`)
  }

  push(0, `Run started${source.trigger ? ` via ${source.trigger.label.toLowerCase()}` : ""}`)
  if (source.trigger?.detail) push(120, `Trigger detail: ${subst(source.trigger.detail)}`)

  const varEntries = Object.entries(variables)
  if (varEntries.length > 0) {
    push(
      260,
      `Loaded ${varEntries.length} variable${varEntries.length === 1 ? "" : "s"}: ${varEntries
        .map(([key, value]) => `${key}=${value}`)
        .join(", ")}`,
    )
  }

  steps.forEach((step, index) => {
    const at = 500 + index * 900
    push(at, `Step ${index + 1}/${steps.length} [${step.kind}] ${subst(step.label)}`)
    if (step.detail) push(at + 260, `  ↳ ${step.detail}`)
    if (step.kind === "condition") {
      push(at + 520, "  ↳ Condition evaluated → passed")
    } else if (step.kind === "action") {
      push(at + 520, `  ↳ Executed ${source.actionLabel ?? "action"}`)
    }
  })

  if (source.prompt) {
    push(500 + steps.length * 900, `Applied prompt instructions (${source.prompt.length} chars)`)
  }

  return lines
}

/**
 * "Run now" preview: streams a simulated execution of the automation's steps
 * into the live log viewer and reports the outcome so the panel can record
 * the run in history.
 */
export function AutomationRunPreviewDialog({
  source,
  open,
  onOpenChange,
  onFinish,
  onProgress,
}: {
  source: AutomationRunSource | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onFinish?: (result: AutomationRunResult) => void
  /** Called with the revealed log lines as they stream, for live history. */
  onProgress?: (lines: string[]) => void
}) {
  const [visibleCount, setVisibleCount] = useState(0)
  const [done, setDone] = useState(false)
  const startedAtRef = useRef<Date | null>(null)
  const finishedRef = useRef(false)
  const onProgressRef = useRef(onProgress)
  onProgressRef.current = onProgress

  const script = useMemo(() => {
    if (!source) return [] as string[]
    startedAtRef.current = new Date()
    return buildRunScript(source, startedAtRef.current)
  }, [source])

  // Stream one line per tick; when the script is exhausted the run succeeds.
  useEffect(() => {
    if (!open || !source || script.length === 0) return
    setVisibleCount(0)
    setDone(false)
    finishedRef.current = false

    let count = 0
    const timer = window.setInterval(() => {
      count += 1
      setVisibleCount(count)
      onProgressRef.current?.(script.slice(0, count))
      if (count >= script.length && !finishedRef.current) {
        finishedRef.current = true
        window.clearInterval(timer)
        const durationMs = Math.max(
          1,
          (startedAtRef.current ? Date.now() - startedAtRef.current.getTime() : 0) +
            script.length * LINE_INTERVAL_MS,
        )
        const completionLine = `${clockLabel(new Date())} Run completed successfully in ${(
          durationMs / 1000
        ).toFixed(1)}s`
        setDone(true)
        onFinish?.({
          status: "succeeded",
          durationMs,
          logs: [...script, completionLine],
        })
      }
    }, LINE_INTERVAL_MS)

    return () => window.clearInterval(timer)
    // Restart the stream per opened source; `script` is memoized on `source`.
  }, [open, source?.id, script.length])

  const visibleLines = script.slice(0, visibleCount)
  const totalSteps = source?.steps?.length ?? 2
  const shownSteps = done ? totalSteps : Math.min(visibleCount, totalSteps)

  function handleOpenChange(next: boolean) {
    if (!next && !done && !finishedRef.current) {
      // Closing mid-run records a cancelled run with whatever streamed out.
      onFinish?.({
        status: "cancelled",
        durationMs: startedAtRef.current ? Date.now() - startedAtRef.current.getTime() : 0,
        logs: [...visibleLines, `${clockLabel(new Date())} Run cancelled by user`],
      })
    }
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            <span className="inline-flex items-center gap-2">
              <Play aria-hidden="true" className="size-4" />
              Run preview — {source?.name ?? "automation"}
            </span>
          </DialogTitle>
          <DialogDescription>
            Simulated execution with mock inputs — no real side effects. The finished run is added
            to the automation&apos;s history.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-xs" aria-live="polite">
            {!done ? (
              <>
                <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                <span className="app-automation-status is-running">
                  <span className="app-status-dot is-running" aria-hidden="true" />
                  running
                </span>
              </>
            ) : (
              <>
                <CheckCircle2 aria-hidden="true" className="size-3.5 text-emerald-600" />
                <span className="app-automation-status is-succeeded">
                  <span className="app-status-dot is-succeeded" aria-hidden="true" />
                  succeeded
                </span>
              </>
            )}
            <span className="text-muted-foreground ml-auto">
              {shownSteps}/{totalSteps} steps · {visibleCount}/
              {script.length} log lines
            </span>
          </div>

          <AutomationRunLog lines={script} live intervalMs={LINE_INTERVAL_MS} className="max-h-64" />

          {source?.variables && Object.keys(source.variables).length > 0 ? (
            <p className="text-muted-foreground text-[11px]">
              Variables applied:{" "}
              {Object.entries(source.variables)
                .map(([key, value]) => `${key}=${value}`)
                .join(", ")}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            {done ? "Close" : "Cancel run"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
