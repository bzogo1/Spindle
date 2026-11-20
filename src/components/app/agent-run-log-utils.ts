import type { AgentRunLogEntry, AgentRunLogStatus, AgentRunLogStepKind } from "@/lib/api"

export function statusLabel(status: AgentRunLogStatus) {
  return status.replace(/_/g, " ")
}

export function stepKindLabel(kind: AgentRunLogStepKind) {
  if (kind === "thought") return "Thought"
  if (kind === "tool_call") return "Tool call"
  return "Result"
}

export function formatDurationMs(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return "—"
  if (ms < 1000) return `${Math.round(ms)}ms`
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    const rest = seconds % 60
    return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  return restMinutes > 0 ? `${hours}h ${restMinutes}m` : `${hours}h`
}

/** Wall-clock duration of a run; for active runs `now` keeps it ticking. */
export function runDurationMs(
  run: {
    createdAt: string
    startedAt: string | null
    finishedAt: string | null
  },
  now = Date.now(),
) {
  const start = run.startedAt ?? run.createdAt
  const end = run.finishedAt ? new Date(run.finishedAt).getTime() : now
  const startMs = new Date(start).getTime()
  if (Number.isNaN(startMs) || Number.isNaN(end)) return null
  return Math.max(0, end - startMs)
}

const ACTIVE_STATUSES: AgentRunLogStatus[] = ["queued", "running", "waiting_approval"]

export function isActiveRun(status: AgentRunLogStatus) {
  return ACTIVE_STATUSES.includes(status)
}

/* ------------------------------------------------------------------------ */
/* Cost / token formatting                                                   */
/* ------------------------------------------------------------------------ */

/** Reported run cost in USD; `null` when the run has no cost metric yet. */
export function runCostUsd(run: Pick<AgentRunLogEntry, "usage">): number | null {
  const cost = run.usage?.costUsd
  return typeof cost === "number" && Number.isFinite(cost) ? cost : null
}

/** Reported total tokens for a run; `null` when no token metric exists. */
export function runTotalTokens(run: Pick<AgentRunLogEntry, "usage">): number | null {
  const usage = run.usage
  if (!usage) return null
  if (typeof usage.totalTokens === "number" && Number.isFinite(usage.totalTokens)) {
    return usage.totalTokens
  }
  const input = usage.inputTokens ?? 0
  const output = usage.outputTokens ?? 0
  return input + output > 0 ? input + output : null
}

/** Compact USD formatting: 4 decimals for sub-cent amounts, else 2. */
export function formatCostUsd(usd: number): string {
  if (!Number.isFinite(usd)) return "—"
  if (usd !== 0 && Math.abs(usd) < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

/** Compact token count: 12.4k / 1.2M style. */
export function formatTokenCount(tokens: number): string {
  if (!Number.isFinite(tokens)) return "—"
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`
  return String(Math.round(tokens))
}
