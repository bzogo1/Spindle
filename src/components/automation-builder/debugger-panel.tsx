"use client"

import { useMemo, useState } from "react"
import { Bug, Pause, Play, SkipBack, SkipForward, StepForward } from "lucide-react"

import {
  dryRunGraph,
  getNode,
  getNodeType,
  validateGraph,
  type AutomationGraph,
  type DryRunReport,
  type NodeRunResult,
} from "@/lib/automation-graph"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface DebuggerPanelProps {
  graph: AutomationGraph
}

interface DebugSession {
  report: DryRunReport
  /** Index into report.results; -1 = before the first step. */
  index: number
}

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-zinc-500/15 text-zinc-500",
  running: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  success: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  error: "bg-red-500/15 text-red-600 dark:text-red-400",
  skipped: "bg-zinc-600/15 text-zinc-500",
}

const TIMELINE_SEGMENT: Record<string, string> = {
  pending: "bg-zinc-300 dark:bg-zinc-600",
  running: "bg-sky-400",
  success: "bg-emerald-500",
  error: "bg-red-500",
  skipped: "bg-zinc-300 dark:bg-zinc-700",
}

function JsonBlock({ value, label }: { value: unknown; label: string }) {
  return (
    <div>
      <p className="text-muted-foreground mb-0.5 text-[10px] font-medium">{label}</p>
      <pre className="bg-muted/60 text-muted-foreground max-h-32 overflow-auto rounded p-1.5 font-mono text-[10px]">
        {value === undefined ? "—" : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}

/**
 * Step-through debugger over the dry-run engine: breakpoints per node,
 * payload inspection at each step, and a variable inspector showing every
 * value produced so far.
 */
export function DebuggerPanel({ graph }: DebuggerPanelProps) {
  const [session, setSession] = useState<DebugSession | null>(null)
  const [breakpoints, setBreakpoints] = useState<Set<string>>(new Set())

  const hasErrors = useMemo(
    () => validateGraph(graph).some((issue) => issue.severity === "error"),
    [graph],
  )

  const results = session?.report.results ?? []
  const current: NodeRunResult | null =
    session && session.index >= 0 ? (results[session.index] ?? null) : null
  const currentNode = current ? getNode(graph, current.nodeId) : null

  /** Outputs produced by steps at or before `index` — the variable inspector. */
  const variables = useMemo(() => {
    if (!session) return [] as { nodeId: string; label: string; output: unknown }[]
    return results
      .slice(0, session.index + 1)
      .filter((r) => r.output !== undefined)
      .map((r) => ({
        nodeId: r.nodeId,
        label: getNode(graph, r.nodeId)?.label ?? r.nodeId,
        output: r.output,
      }))
  }, [session, results, graph])

  function start() {
    const report = dryRunGraph(graph, { seed: 11 })
    setSession({ report, index: -1 })
    setBreakpoints(new Set())
  }

  function step(delta: number) {
    setSession((prev) =>
      prev
        ? { ...prev, index: Math.min(results.length - 1, Math.max(-1, prev.index + delta)) }
        : prev,
    )
  }

  function continueToBreakpoint() {
    setSession((prev) => {
      if (!prev) return prev
      let next = prev.index + 1
      while (next < results.length && !breakpoints.has(results[next].nodeId)) next += 1
      return { ...prev, index: Math.min(next, results.length - 1) }
    })
  }

  function toggleBreakpoint(nodeId: string) {
    setBreakpoints((prev) => {
      const next = new Set(prev)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }

  const finished = session !== null && session.index >= results.length - 1

  /** End of the slowest step — the right edge of the execution timeline. */
  const timelineEnd = Math.max(1, ...results.map((r) => r.startedAtMs + r.durationMs))

  return (
    <section
      className="border-border bg-card flex flex-col gap-2 rounded-lg border p-3"
      aria-labelledby="builder-debugger-heading"
    >
      <div className="flex items-center justify-between gap-2">
        <h3
          id="builder-debugger-heading"
          className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase"
        >
          <Bug className="size-3.5" aria-hidden="true" />
          Debugger
        </h3>
        {!session ? (
          <Button type="button" size="sm" onClick={start} disabled={hasErrors}>
            <Play aria-hidden="true" />
            Start session
          </Button>
        ) : (
          <Button type="button" variant="ghost" size="sm" onClick={() => setSession(null)}>
            End
          </Button>
        )}
      </div>

      {hasErrors && !session ? (
        <p className="text-muted-foreground text-[11px]">Fix validation errors before debugging.</p>
      ) : null}

      {session ? (
        <>
          {/* Step controls */}
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-1.5"
              onClick={() => step(-1)}
              disabled={session.index <= -1}
              aria-label="Step back"
            >
              <SkipBack aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-1.5"
              onClick={() => step(1)}
              disabled={finished}
              aria-label="Step forward"
            >
              <StepForward aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-1.5"
              onClick={continueToBreakpoint}
              disabled={finished}
              aria-label="Continue to next breakpoint"
            >
              <Pause aria-hidden="true" />
              <span className="text-[10px]">to breakpoint</span>
            </Button>
            <span className="text-muted-foreground ml-auto text-[10px]">
              {Math.max(0, session.index + 1)}/{results.length}
            </span>
          </div>

          {/* Execution timeline: one segment per step, sized by duration */}
          <div
            className="bg-muted flex h-2 w-full gap-px overflow-hidden rounded"
            role="img"
            aria-label="Execution timeline"
          >
            {results.map((result, index) => {
              const node = getNode(graph, result.nodeId)
              const widthPct = Math.max(0.5, (result.durationMs / timelineEnd) * 100)
              return (
                <div
                  key={result.nodeId}
                  className={cn(
                    "h-full",
                    TIMELINE_SEGMENT[result.status],
                    index === session.index && "ring-foreground/60 ring-1",
                  )}
                  style={{ width: `${widthPct}%` }}
                  title={`${node?.label ?? result.nodeId} · ${result.startedAtMs}–${
                    result.startedAtMs + result.durationMs
                  }ms · ${result.status}`}
                />
              )
            })}
          </div>

          {/* Step list with breakpoint toggles */}
          <ol className="flex max-h-36 flex-col gap-0.5 overflow-y-auto">
            {results.map((result, index) => {
              const node = getNode(graph, result.nodeId)
              const isCurrent = index === session.index
              const hasBreakpoint = breakpoints.has(result.nodeId)
              return (
                <li key={result.nodeId}>
                  <div
                    className={cn(
                      "flex items-center gap-1.5 rounded px-1 py-0.5 text-[11px]",
                      isCurrent && "bg-accent",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => toggleBreakpoint(result.nodeId)}
                      aria-label={`Toggle breakpoint on ${node?.label ?? result.nodeId}`}
                      aria-pressed={hasBreakpoint}
                      className={cn(
                        "size-2.5 shrink-0 rounded-full border",
                        hasBreakpoint ? "border-red-500 bg-red-500" : "border-muted-foreground/50",
                      )}
                    />
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left hover:underline"
                      onClick={() => setSession({ ...session, index })}
                    >
                      {index + 1}. {node?.label ?? result.nodeId}
                    </button>
                    <Badge
                      variant="secondary"
                      className={cn("text-[9px]", STATUS_BADGE[result.status])}
                    >
                      {result.status}
                    </Badge>
                  </div>
                </li>
              )
            })}
          </ol>

          {/* Current step inspection */}
          {current && currentNode ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium">
                {currentNode.label}
                <span className="text-muted-foreground ml-1.5 text-[10px] font-normal">
                  {getNodeType(currentNode.type)?.label ?? currentNode.type} · {current.durationMs}
                  ms
                </span>
              </p>
              <JsonBlock label="Config" value={currentNode.config} />
              <JsonBlock label="Input payload" value={current.inputs} />
              <JsonBlock label="Output" value={current.output} />
              {current.logs.length > 0 ? (
                <pre className="bg-muted/60 text-muted-foreground max-h-24 overflow-auto rounded p-1.5 font-mono text-[10px] leading-relaxed">
                  {current.logs.join("\n")}
                </pre>
              ) : null}
              {current.error ? (
                <p className="text-destructive text-[11px]">{current.error}</p>
              ) : null}
            </div>
          ) : (
            <p className="text-muted-foreground text-[11px]">
              {session.index === -1
                ? "Before the first node — press Step forward to begin."
                : "Run complete."}
            </p>
          )}

          {/* Variable inspector */}
          {variables.length > 0 ? (
            <div className="flex flex-col gap-1">
              <p className="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase">
                Variables
              </p>
              <ul className="flex max-h-28 flex-col gap-0.5 overflow-y-auto">
                {variables.map((variable) => (
                  <li key={variable.nodeId} className="text-[10px]">
                    <details>
                      <summary className="text-muted-foreground hover:text-foreground cursor-pointer truncate">
                        {variable.label}
                      </summary>
                      <pre className="bg-muted/60 text-muted-foreground mt-0.5 max-h-20 overflow-auto rounded p-1 font-mono text-[9px]">
                        {JSON.stringify(variable.output, null, 2)}
                      </pre>
                    </details>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
          <SkipForward className="size-3" aria-hidden="true" />
          Step through a dry run node by node, inspecting payloads at each step.
        </p>
      )}
    </section>
  )
}
