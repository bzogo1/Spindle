/**
 * Agent run optimization — post-run analysis of recorded runs.
 *
 * `analyzeRunOptimization` inspects steps and events for waste patterns:
 * redundant repeated steps, retry waste (failed attempts re-run), and context
 * bloat (oversized event/step payloads). Each finding carries a severity and
 * an actionable hint; the report aggregates estimated wasted time.
 */

import type { AgentRunRecord, AgentRunOpsStep } from "./types"
import { stepDurationMs } from "./types"

export type OptimizationSeverity = "info" | "warning" | "critical"

export type OptimizationCategory = "redundant" | "retry" | "context" | "structure"

export interface OptimizationFinding {
  id: string
  category: OptimizationCategory
  severity: OptimizationSeverity
  /** Step ids implicated, when applicable. */
  stepIds: string[]
  title: string
  detail: string
  /** Estimated wall-clock waste attributable to this finding (ms). */
  wastedMs: number
  /** Concrete suggestion for the next run. */
  hint: string
}

export interface RunOptimizationReport {
  runId: string
  findings: OptimizationFinding[]
  /** Sum of `wastedMs` across findings (upper bound — findings may overlap). */
  estimatedWasteMs: number
  /** Total serialized size of step payloads + event payloads (bytes). */
  payloadBytes: number
  /** Counts per category for quick rendering. */
  byCategory: Record<OptimizationCategory, number>
  /** One-line human summary. */
  summary: string
}

/**
 * Identity key for "same work" comparisons. Includes kind, title, detail, and
 * a payload signature (sorted top-level keys + scalar `path`-like values) so
 * two same-titled steps doing *different* work — e.g. tool calls with
 * different arguments — are not flagged as redundant/retried.
 */
function stepKey(step: AgentRunOpsStep): string {
  let payloadSig = ""
  if (step.payload && typeof step.payload === "object") {
    const keys = Object.keys(step.payload).sort()
    // Prefer an explicit path/target field when present — it's the usual
    // discriminator between same-titled tool calls.
    const pathLike = ["path", "file", "target", "url", "id", "command", "query"]
      .map((k) => step.payload?.[k])
      .filter((v) => typeof v === "string" || typeof v === "number")
      .join("|")
    payloadSig = `${keys.join(",")}#${pathLike}`
  }
  return `${step.kind}:${step.title}:${step.detail ?? ""}:${payloadSig}`
}

function payloadSize(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value ?? null)).length
  } catch {
    return 0
  }
}

function totalPayloadBytes(run: AgentRunRecord): number {
  let bytes = 0
  for (const step of run.steps) {
    if (step.payload) bytes += payloadSize(step.payload)
  }
  for (const event of run.events) {
    if (event.data) bytes += payloadSize(event.data)
  }
  return bytes
}

/** Consecutive steps with identical kind+title are redundant repeats. */
function findRedundantSteps(run: AgentRunRecord): OptimizationFinding[] {
  const findings: OptimizationFinding[] = []
  const steps = run.steps
  let i = 0
  while (i < steps.length) {
    const key = stepKey(steps[i])
    let j = i + 1
    while (j < steps.length && stepKey(steps[j]) === key) j += 1
    const runLength = j - i
    if (runLength >= 2) {
      const group = steps.slice(i, j)
      const wasted = group.slice(1).reduce((acc, step) => acc + (stepDurationMs(step) ?? 0), 0)
      findings.push({
        id: `redundant-${group[0].id}`,
        category: "redundant",
        severity: wasted > 10_000 ? "warning" : "info",
        stepIds: group.map((s) => s.id),
        title: `Repeated step “${steps[i].title}” ×${runLength}`,
        detail: `${runLength} consecutive ${steps[i].kind} steps share the same title; later copies likely re-did the same work.`,
        wastedMs: wasted,
        hint: "Deduplicate identical steps at record time, or make repeated calls idempotent so retries reuse the first result.",
      })
    }
    i = j
  }
  return findings
}

/**
 * Failed/cancelled steps that were followed by another attempt at the same
 * work (same kind+title) represent retry waste: the failed attempt's duration
 * is time spent that produced nothing.
 */
function findRetryWaste(run: AgentRunRecord): OptimizationFinding[] {
  const findings: OptimizationFinding[] = []
  const steps = run.steps
  const retried = new Map<string, { title: string; failed: AgentRunOpsStep[]; attempts: number }>()

  for (const step of steps) {
    const key = stepKey(step)
    const entry = retried.get(key) ?? { title: step.title, failed: [], attempts: 0 }
    entry.attempts += 1
    if (step.status === "failed" || step.status === "cancelled") {
      entry.failed.push(step)
    }
    retried.set(key, entry)
  }

  for (const [key, entry] of retried) {
    if (entry.failed.length === 0 || entry.attempts <= 1) continue
    const wasted = entry.failed.reduce((acc, s) => acc + (stepDurationMs(s) ?? 0), 0)
    findings.push({
      id: `retry-${key}`,
      category: "retry",
      severity: wasted > 30_000 ? "critical" : "warning",
      stepIds: entry.failed.map((s) => s.id),
      title: `Retry waste on “${entry.title}”`,
      detail: `${entry.failed.length} failed/cancelled attempt(s) out of ${entry.attempts} total; the failed time produced no result.`,
      wastedMs: wasted,
      hint: "Add backoff + jitter before retrying, and make retried calls idempotent so partial work is not repeated.",
    })
  }
  return findings
}

const BLOAT_BYTES = 64 * 1024
const BLOAT_EVENTS = 500

/** Oversized payloads / very long event streams bloat model context. */
function findContextBloat(run: AgentRunRecord): OptimizationFinding[] {
  const findings: OptimizationFinding[] = []
  const bytes = totalPayloadBytes(run)

  if (bytes > BLOAT_BYTES || run.events.length > BLOAT_EVENTS) {
    const biggest = [...run.steps]
      .filter((s) => s.payload)
      .sort((a, b) => payloadSize(b.payload) - payloadSize(a.payload))[0]
    findings.push({
      id: "context-bloat",
      category: "context",
      severity: bytes > BLOAT_BYTES * 4 ? "critical" : "warning",
      stepIds: biggest ? [biggest.id] : [],
      title: "Context bloat",
      detail: `Run carries ~${Math.round(bytes / 1024)}KB of step/event payloads across ${run.events.length} events${biggest ? `; largest single payload is step “${biggest.title}”` : ""}.`,
      wastedMs: 0,
      hint: "Truncate or summarize large tool outputs before they enter the context window; store raw payloads out-of-band and reference them by id.",
    })
  }

  const oversizedSteps = run.steps.filter((s) => s.payload && payloadSize(s.payload) > 16 * 1024)
  for (const step of oversizedSteps.slice(0, 3)) {
    findings.push({
      id: `bloat-step-${step.id}`,
      category: "context",
      severity: "info",
      stepIds: [step.id],
      title: `Large payload on “${step.title}”`,
      detail: `Step payload is ~${Math.round(payloadSize(step.payload!) / 1024)}KB.`,
      wastedMs: 0,
      hint: "Paginate or compress large tool results; keep only the fields the next step needs.",
    })
  }
  return findings
}

/** Many sequential tool calls with no intervening thought/result steps. */
function findSerialToolChains(run: AgentRunRecord): OptimizationFinding[] {
  const findings: OptimizationFinding[] = []
  let chain: AgentRunOpsStep[] = []
  const flush = () => {
    if (chain.length >= 4) {
      findings.push({
        id: `serial-chain-${chain[0].id}`,
        category: "structure",
        severity: "info",
        stepIds: chain.map((s) => s.id),
        title: `${chain.length} consecutive tool calls`,
        detail:
          "A long unbroken chain of tool calls ran serially with no reasoning step between them.",
        wastedMs: 0,
        hint: "Independent tool calls can run in parallel; interleave a short plan step to confirm ordering constraints.",
      })
    }
    chain = []
  }
  for (const step of run.steps) {
    if (step.kind === "tool_call") chain.push(step)
    else flush()
  }
  flush()
  return findings
}

export function analyzeRunOptimization(run: AgentRunRecord): RunOptimizationReport {
  const findings = [
    ...findRedundantSteps(run),
    ...findRetryWaste(run),
    ...findContextBloat(run),
    ...findSerialToolChains(run),
  ]
  const byCategory: Record<OptimizationCategory, number> = {
    redundant: 0,
    retry: 0,
    context: 0,
    structure: 0,
  }
  for (const finding of findings) byCategory[finding.category] += 1
  const estimatedWasteMs = findings.reduce((acc, f) => acc + f.wastedMs, 0)
  const payloadBytes = totalPayloadBytes(run)

  const summary =
    findings.length === 0
      ? "No optimization opportunities detected."
      : `${findings.length} finding(s): ~${Math.round(estimatedWasteMs / 1000)}s estimated waste, ~${Math.round(payloadBytes / 1024)}KB payloads.`

  return { runId: run.id, findings, estimatedWasteMs, payloadBytes, byCategory, summary }
}
