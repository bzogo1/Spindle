"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ScrollText, ShieldCheck, ShieldAlert } from "lucide-react"

import {
  auditEntriesForRun,
  loadAuditLog,
  saveAuditLog,
  verifyAuditChain,
  type RunAuditLog,
} from "@/lib/agent-runs/ops/audit"

/**
 * Audit trail viewer: loads the localStorage audit log, verifies the
 * hash chain on demand, and lists lifecycle entries (optionally filtered
 * to one run).
 */
export function AgentRunAuditPanel({ runId }: { runId?: string }) {
  const [log, setLog] = useState<RunAuditLog>(() => loadAuditLog())
  const [verification, setVerification] = useState<{
    ok: boolean
    entriesChecked: number
    brokenAt?: number
    reason?: string
  } | null>(null)
  const [verifying, setVerifying] = useState(false)

  const refresh = useCallback(() => setLog(loadAuditLog()), [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const entries = useMemo(
    () => (runId ? auditEntriesForRun(log, runId) : log.entries),
    [log, runId],
  )

  const verify = async () => {
    setVerifying(true)
    try {
      setVerification(await verifyAuditChain(log))
    } finally {
      setVerifying(false)
    }
  }

  // Auto-verify once on mount for a quick integrity signal.
  useEffect(() => {
    void verify()
    // Mount-only: verify reads the initially loaded log.
  }, [])

  const persist = () => {
    saveAuditLog(log)
    refresh()
  }

  return (
    <section className="app-panel" aria-labelledby="audit-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="audit-heading">
            <ScrollText aria-hidden="true" className="app-panel-icon" /> Audit trail
          </h2>
          <p>
            {entries.length} entr{entries.length === 1 ? "y" : "ies"}
            {runId ? ` for run ${runId}` : " across all runs"} · append-only, hash-chained.
          </p>
        </div>
        <div className="app-share-actions">
          {verification ? (
            verification.ok ? (
              <span className="app-badge is-done">
                <ShieldCheck aria-hidden="true" className="size-3" /> chain intact (
                {verification.entriesChecked})
              </span>
            ) : (
              <span className="app-badge is-failed">
                <ShieldAlert aria-hidden="true" className="size-3" /> broken at #
                {verification.brokenAt} ({verification.reason})
              </span>
            )
          ) : null}
          <button
            type="button"
            className="fm-btn"
            onClick={() => void verify()}
            disabled={verifying}
          >
            {verifying ? "Verifying…" : "Verify chain"}
          </button>
          <button type="button" className="fm-btn" onClick={persist}>
            Persist log
          </button>
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="app-runlog-empty-steps">
          No audit entries yet — lifecycle events are recorded as runs are created, shared, and
          exported.
        </p>
      ) : (
        <table className="app-analytics-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Time</th>
              <th>Type</th>
              <th>Run</th>
              <th>Actor</th>
              <th>Hash</th>
            </tr>
          </thead>
          <tbody>
            {[...entries].reverse().map((entry) => (
              <tr key={entry.seq}>
                <td>{entry.seq}</td>
                <td>{entry.at}</td>
                <td>
                  <code>{entry.type}</code>
                </td>
                <td>
                  <code>{entry.runId}</code>
                </td>
                <td>{entry.actor ?? "—"}</td>
                <td>
                  <code title={entry.hash}>{entry.hash.slice(0, 12)}…</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
