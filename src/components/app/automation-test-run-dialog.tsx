"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Beaker, CheckCircle2, Loader2, RotateCcw, ShieldCheck } from "lucide-react"

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
import {
  buildRunScript,
  type AutomationRunSource,
} from "./automation-run-preview-dialog"

const LINE_INTERVAL_MS = 420

function clockLabel(date: Date) {
  return date.toTimeString().slice(0, 8)
}

function formatMs(ms: number) {
  return `${(ms / 1000).toFixed(1)}s`
}

/** Fake stdout the sandbox "produces" once the scripted steps finish. */
function buildSandboxOutput(source: AutomationRunSource, durationMs: number) {
  const variables = source.variables ?? {}
  return [
    "{",
    `  "status": "ok",`,
    `  "environment": "sandbox-preview",`,
    `  "automation": ${JSON.stringify(source.name)},`,
    `  "durationMs": ${Math.round(durationMs)},`,
    `  "stepsExecuted": ${source.steps?.length ?? 2},`,
    `  "variables": ${JSON.stringify(variables)},`,
    '  "sideEffects": "none — sandboxed dry execution"',
    "}",
  ]
}

/**
 * "Test run" — executes the automation inside a simulated sandboxed preview
 * environment entirely on the client. Reuses the same deterministic log
 * script as the run preview, but nothing is recorded: the run never enters
 * history, lastRunAt/lastRunStatus stay untouched, and a fake result payload
 * is shown at the end instead of real side effects.
 */
export function AutomationTestRunDialog({
  source,
  open,
  onOpenChange,
}: {
  source: AutomationRunSource | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [runNonce, setRunNonce] = useState(0)
  const [visibleCount, setVisibleCount] = useState(0)
  const [done, setDone] = useState(false)
  const [result, setResult] = useState<{
    durationMs: number
    lines: string[]
  } | null>(null)
  const startedAtRef = useRef<Date | null>(null)
  const finishedRef = useRef(false)

  const script = useMemo(() => {
    if (!source) return [] as string[]
    startedAtRef.current = new Date()
    return buildRunScript(source, startedAtRef.current)
  }, [source, runNonce])

  // Stream one line per tick; when the script is exhausted the test run ends.
  useEffect(() => {
    if (!open || !source || script.length === 0) return
    setVisibleCount(0)
    setDone(false)
    setResult(null)
    finishedRef.current = false

    let count = 0
    const timer = window.setInterval(() => {
      count += 1
      setVisibleCount(count)
      if (count >= script.length && !finishedRef.current) {
        finishedRef.current = true
        window.clearInterval(timer)
        const durationMs = Math.max(
          1,
          (startedAtRef.current ? Date.now() - startedAtRef.current.getTime() : 0) +
            script.length * LINE_INTERVAL_MS,
        )
        const completionLine = `${clockLabel(new Date())} Sandbox run finished in ${formatMs(durationMs)} — no side effects applied`
        const lines = [...script, completionLine]
        setDone(true)
        setResult({ durationMs, lines })
      }
    }, LINE_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [open, source?.id, runNonce, script.length])

  const totalSteps = source?.steps?.length ?? 2
  const shownSteps = done ? totalSteps : Math.min(visibleCount, totalSteps)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            <span className="inline-flex items-center gap-2">
              <Beaker aria-hidden="true" className="size-4" />
              Test run — {source?.name ?? "automation"}
            </span>
          </DialogTitle>
          <DialogDescription>
            Sandboxed preview environment: the automation is simulated client-side with mock
            inputs. Nothing is executed for real and the result is never added to run history.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-xs" aria-live="polite">
            {!done ? (
              <>
                <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                <span className="app-automation-status is-running">
                  <span className="app-status-dot is-running" aria-hidden="true" />
                  running in sandbox
                </span>
              </>
            ) : (
              <>
                <CheckCircle2 aria-hidden="true" className="size-3.5 text-emerald-600" />
                <span className="app-automation-status is-succeeded">
                  <span className="app-status-dot is-succeeded" aria-hidden="true" />
                  succeeded
                </span>
                <span className="app-automation-status is-queued">
                  <ShieldCheck aria-hidden="true" className="size-3" />
                  sandboxed
                </span>
              </>
            )}
            <span className="text-muted-foreground ml-auto">
              {shownSteps}/{totalSteps} steps · {visibleCount}/{script.length} log lines
            </span>
          </div>

          <AutomationRunLog
            lines={result ? result.lines : script}
            live
            intervalMs={LINE_INTERVAL_MS}
            className="max-h-64"
          />

          {result && source ? (
            <div className="rounded-md border border-dashed p-3">
              <p className="mb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                Simulated result · {formatMs(result.durationMs)}
              </p>
              <pre className="overflow-x-auto text-[11px] leading-relaxed">
                {buildSandboxOutput(source, result.durationMs).join("\n")}
              </pre>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          {done ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setRunNonce((nonce) => nonce + 1)
                setVisibleCount(0)
                setDone(false)
                setResult(null)
              }}
            >
              <RotateCcw aria-hidden="true" />
              Run again
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {done ? "Close" : "Cancel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
