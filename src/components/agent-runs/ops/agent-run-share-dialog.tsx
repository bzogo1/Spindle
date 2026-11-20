"use client"

import { useMemo, useState } from "react"
import { Share2, Upload } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  createAgentRunSharePayload,
  decodeAgentRunShare,
  decodeAgentRunShareFromUrl,
  encodeAgentRunShare,
  encodeAgentRunShareForUrl,
  importAgentRunShare,
} from "@/lib/agent-runs/ops/share"
import type { AgentRunRecord } from "@/lib/agent-runs/ops/types"

/**
 * Share dialog for a recorded agent run. Produces a base64url `#share=`
 * payload (same convention as the file-tree share links) that can be pasted
 * into a URL, plus a raw JSON export. The import side accepts either format
 * and restores the run via `importAgentRunShare`.
 */
export function AgentRunShareDialog({
  run,
  onImport,
  label = "Share run",
}: {
  run: AgentRunRecord
  onImport?: (run: AgentRunRecord) => void
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [importText, setImportText] = useState("")
  const [importError, setImportError] = useState<string | null>(null)
  const [importedId, setImportedId] = useState<string | null>(null)

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") return ""
    const payload = createAgentRunSharePayload({ run })
    const encoded = encodeAgentRunShareForUrl(payload)
    return `${window.location.origin}${window.location.pathname}#share=${encoded}`
  }, [run])

  const shareJson = useMemo(() => encodeAgentRunShare(createAgentRunSharePayload({ run })), [run])

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000)
    } catch {
      setCopied(null)
    }
  }

  const doImport = () => {
    setImportError(null)
    setImportedId(null)
    // Accept base64url (URL fragment style), a share URL, or raw JSON.
    let payload = decodeAgentRunShare(importText.trim())
    if (!payload) {
      const match = importText.match(/#share=([^&\s]+)/) ?? importText.match(/[?&]share=([^&#\s]+)/)
      const candidate = match?.[1] ?? importText.trim()
      let decoded = candidate
      try {
        decoded = decodeURIComponent(candidate)
      } catch {
        // Malformed "%" escapes — decodeAgentRunShareFromUrl falls back to raw.
      }
      payload = decodeAgentRunShareFromUrl(decoded)
    }
    if (!payload) {
      setImportError(
        "Could not decode share payload — paste a share link, #share= fragment, or JSON export.",
      )
      return
    }
    const imported = importAgentRunShare(payload)
    setImportedId(imported.id)
    onImport?.(imported)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className="fm-btn">
          <Share2 aria-hidden="true" className="size-3.5" /> {label}
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share agent run</DialogTitle>
          <DialogDescription>
            Share a portable snapshot of “{run.name ?? run.prompt}”. The payload embeds the full run
            record — review it for secrets before sharing externally.
          </DialogDescription>
        </DialogHeader>

        <div className="app-share-section">
          <h3>Share link</h3>
          <p className="app-share-note">
            Base64url-encoded run snapshot. Append it as <code>#share=…</code> to any URL; receivers
            decode it with the import box below.
          </p>
          <div className="app-share-actions">
            <button type="button" className="fm-btn" onClick={() => void copy(shareUrl, "url")}>
              {copied === "url" ? "Copied!" : "Copy share URL"}
            </button>
            <button type="button" className="fm-btn" onClick={() => void copy(shareJson, "json")}>
              {copied === "json" ? "Copied!" : "Copy JSON"}
            </button>
          </div>
          <pre className="app-runlog-payload app-share-payload">{shareUrl}</pre>
        </div>

        <div className="app-share-section">
          <h3>
            <Upload aria-hidden="true" className="size-4" /> Import shared run
          </h3>
          <textarea
            className="app-share-import"
            rows={4}
            placeholder="Paste a share URL, #share= fragment, or JSON payload…"
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            aria-label="Share payload to import"
          />
          {importError ? (
            <p className="app-share-error" role="alert">
              {importError}
            </p>
          ) : null}
          {importedId ? (
            <p className="app-share-note" role="status">
              Imported as run <code>{importedId}</code>.
            </p>
          ) : null}
          <div className="app-share-actions">
            <button
              type="button"
              className="fm-btn fm-btn--solid"
              disabled={importText.trim().length === 0}
              onClick={doImport}
            >
              Import run
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
