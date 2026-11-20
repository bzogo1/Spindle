"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import { ArchiveRestore, Download, Save } from "lucide-react"

import {
  AUTO_BACKUP_MAX_RUNS,
  buildRunBackup,
  downloadRunBackup,
  loadRunsAutoBackup,
  parseRunBackup,
  saveRunsAutoBackup,
} from "@/lib/agent-runs/ops/backup"
import type { AgentRunRecord } from "@/lib/agent-runs/ops/types"

/**
 * Backup panel: export runs to a JSON file, snapshot them to the
 * localStorage auto-backup, and restore from either source. `onImport`
 * receives parsed runs so the host can merge them into its store.
 */
export function AgentRunBackupPanel({
  runs,
  onImport,
}: {
  runs: readonly AgentRunRecord[]
  onImport?: (runs: AgentRunRecord[], source: "file" | "autobackup") => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [autoInfo, setAutoInfo] = useState(() => {
    const snap = loadRunsAutoBackup()
    return snap ? { savedAt: snap.savedAt, count: snap.runs.length } : null
  })

  const manifest = useMemo(() => buildRunBackup(runs).manifest, [runs])

  const doDownload = () => {
    const ok = downloadRunBackup(runs)
    setMessage(
      ok
        ? `Downloaded backup with ${runs.length} run(s).`
        : "Download unavailable in this environment.",
    )
  }

  const doAutoBackup = () => {
    const ok = saveRunsAutoBackup(runs)
    const snap = loadRunsAutoBackup()
    setAutoInfo(snap ? { savedAt: snap.savedAt, count: snap.runs.length } : null)
    setMessage(
      ok
        ? `Auto-backup saved (${Math.min(runs.length, AUTO_BACKUP_MAX_RUNS)} run(s) max).`
        : "Auto-backup failed — storage unavailable.",
    )
  }

  const restoreAuto = useCallback(() => {
    const snap = loadRunsAutoBackup()
    if (!snap || snap.runs.length === 0) {
      setMessage("No auto-backup found.")
      return
    }
    onImport?.(snap.runs, "autobackup")
    setMessage(`Restored ${snap.runs.length} run(s) from auto-backup (saved ${snap.savedAt}).`)
  }, [onImport])

  const onFilePicked = async (file: File | undefined) => {
    if (!file) return
    const text = await file.text()
    const parsed = parseRunBackup(text)
    if (!parsed.ok) {
      setMessage(`Import failed: ${parsed.error ?? "unknown error"}`)
      return
    }
    onImport?.(parsed.runs, "file")
    setMessage(
      `Imported ${parsed.runs.length} run(s) from ${file.name}` +
        (parsed.manifest ? ` (backup from ${parsed.manifest.createdAt})` : ""),
    )
    if (fileRef.current) fileRef.current.value = ""
  }

  return (
    <section className="app-panel" aria-labelledby="backup-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="backup-heading">
            <ArchiveRestore aria-hidden="true" className="app-panel-icon" /> Backup &amp; restore
          </h2>
          <p>
            {runs.length} run{runs.length === 1 ? "" : "s"} in scope · manifest v{manifest.version}{" "}
            created {manifest.createdAt}
          </p>
        </div>
      </div>

      <div className="app-share-actions">
        <button type="button" className="fm-btn fm-btn--solid" onClick={doDownload}>
          <Download aria-hidden="true" className="size-3.5" /> Download JSON backup
        </button>
        <button type="button" className="fm-btn" onClick={doAutoBackup}>
          <Save aria-hidden="true" className="size-3.5" /> Save auto-backup
        </button>
        <button type="button" className="fm-btn" onClick={restoreAuto}>
          <ArchiveRestore aria-hidden="true" className="size-3.5" /> Restore auto-backup
        </button>
        <button type="button" className="fm-btn" onClick={() => fileRef.current?.click()}>
          Import backup file…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="app-share-hidden-input"
          aria-label="Import backup file"
          onChange={(e) => void onFilePicked(e.target.files?.[0])}
        />
      </div>

      {autoInfo ? (
        <p className="app-share-note">
          Auto-backup: {autoInfo.count} run(s), saved {autoInfo.savedAt}.
        </p>
      ) : (
        <p className="app-share-note">No auto-backup snapshot yet.</p>
      )}

      {message ? (
        <p className="app-share-note" role="status">
          {message}
        </p>
      ) : null}

      <details className="app-runlog-debug-details">
        <summary>Manifest JSON</summary>
        <pre className="app-runlog-payload">{JSON.stringify(manifest, null, 2)}</pre>
      </details>
    </section>
  )
}
