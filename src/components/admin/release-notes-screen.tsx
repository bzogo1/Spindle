"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Mail, Send } from "lucide-react"

import { EmptyState } from "@/components/app/states/empty-state"
import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select } from "@/components/ui/select"

/**
 * Admin "Release notes email" screen for `/app/admin/release-notes`.
 *
 * Loads a preview from `GET /api/admin/release-notes` (latest changelog
 * entries composed into the release-notes email, active-subscriber count,
 * and whether `RESEND_API_KEY` is configured), then `POST`s to the same
 * endpoint to send. Delivery is honest: without a configured mail provider
 * the result reports every recipient as `unconfigured`, not `sent`.
 *
 * Recipients are newsletter subscribers (in-memory dev seam); "all-users"
 * falls back to subscribers because the auth backend cannot enumerate users.
 */

const API = "/api/admin/release-notes"

export interface ReleaseNotesEntryMeta {
  slug: string
  version: string
  date: string
  title: string
  tags: string[]
}

interface PreviewResponse {
  ok: boolean
  entries?: ReleaseNotesEntryMeta[]
  subject?: string
  text?: string
  textTruncated?: boolean
  html?: string
  recipientCount?: number
  emailConfigured?: boolean
  message?: string
}

interface SendResult {
  attempted: number
  /** Recipients skipped because they opted out of marketing/newsletter email. */
  suppressed: number
  sent: number
  unconfigured: number
  failed: number
}

interface SendResponse {
  ok: boolean
  audience?: string
  audienceNote?: string | null
  result?: SendResult
  emailConfigured?: boolean
  message?: string
}

const AUDIENCE_OPTIONS = [
  { value: "subscribers", label: "Newsletter subscribers" },
  { value: "all-users", label: "All users (falls back to subscribers)" },
]

function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(undefined, { dateStyle: "medium", timeZone: "UTC" })
}

export function ReleaseNotesScreen() {
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [audience, setAudience] = useState("subscribers")
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sendResult, setSendResult] = useState<{
    result: SendResult
    audienceNote: string | null
    emailConfigured: boolean
  } | null>(null)
  const sendSeq = useRef(0)

  useEffect(() => {
    const seq = ++sendSeq.current
    setPreview(null)
    setPreviewError(null)
    void (async () => {
      try {
        const response = await fetch(API, { cache: "no-store" })
        const data = (await response.json()) as PreviewResponse
        if (seq !== sendSeq.current) return
        if (!response.ok || !data.ok) {
          setPreviewError(data.message ?? "Could not load the release-notes preview.")
          return
        }
        setPreview(data)
      } catch {
        if (seq !== sendSeq.current) return
        setPreviewError("Could not load the release-notes preview. Check your connection.")
      }
    })()
  }, [reloadKey])

  const send = useCallback(async () => {
    const recipientCount = preview?.recipientCount ?? 0
    const confirmed = window.confirm(
      `Send this release-notes email to ${recipientCount} recipient${recipientCount === 1 ? "" : "s"}?`,
    )
    if (!confirmed) return

    setSending(true)
    setSendError(null)
    setSendResult(null)
    try {
      const response = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latestCount: 1, audience }),
      })
      const data = (await response.json()) as SendResponse
      if (!response.ok || !data.ok || !data.result) {
        setSendError(data.message ?? "Could not send the release-notes email.")
        return
      }
      setSendResult({
        result: data.result,
        audienceNote: data.audienceNote ?? null,
        emailConfigured: data.emailConfigured ?? false,
      })
    } catch {
      setSendError("Could not send the release-notes email. Check your connection and try again.")
    } finally {
      setSending(false)
    }
  }, [audience, preview?.recipientCount])

  const loading = preview === null && previewError === null
  const entries = preview?.entries ?? []

  return (
    <div className="flex flex-col gap-6">
      {previewError ? (
        <InlineError
          title="Preview unavailable"
          message={
            <span className="flex flex-wrap items-center gap-2">
              <span>{previewError}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setReloadKey((key) => key + 1)}
              >
                Retry
              </Button>
            </span>
          }
        />
      ) : null}

      {loading ? <LoadingPanel label="Loading release notes" variant="table" /> : null}

      {preview && !previewError ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-muted-foreground text-sm">Recipients</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">{preview.recipientCount ?? 0}</p>
                <p className="text-muted-foreground text-xs">Active newsletter subscribers</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-muted-foreground text-sm">Delivery</CardTitle>
              </CardHeader>
              <CardContent>
                <Badge variant={preview.emailConfigured ? "secondary" : "outline"}>
                  {preview.emailConfigured ? "Configured" : "Unconfigured"}
                </Badge>
                <p className="text-muted-foreground mt-1 text-xs">
                  {preview.emailConfigured
                    ? "RESEND_API_KEY is set; sends go through Resend."
                    : "RESEND_API_KEY is not set; sends are recorded as unconfigured."}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-muted-foreground text-sm">Entries</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">{entries.length}</p>
                <p className="text-muted-foreground text-xs">Latest changelog release(s)</p>
              </CardContent>
            </Card>
          </div>

          <section className="app-panel" aria-labelledby="release-notes-preview-heading">
            <div className="app-panel-head">
              <div>
                <h2 id="release-notes-preview-heading">Email preview</h2>
                <p>
                  Latest release notes composed exactly as recipients will see them. Entry content
                  is HTML-escaped.
                </p>
              </div>
            </div>

            {entries.length === 0 ? (
              <EmptyState
                icon={<Mail aria-hidden="true" />}
                title="No release notes yet"
                body="Published changelog entries will appear here."
              />
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <span className="text-muted-foreground text-xs">Subject</span>
                  <p className="text-sm font-medium">{preview.subject}</p>
                </div>
                <ul className="text-muted-foreground flex flex-col gap-1 text-sm">
                  {entries.map((entry) => (
                    <li key={entry.slug}>
                      <span className="text-foreground font-medium">{entry.version}</span> —{" "}
                      {entry.title} ({formatDate(entry.date)})
                    </li>
                  ))}
                </ul>
                <div className="flex flex-col gap-1">
                  <span className="text-muted-foreground text-xs">Plain-text body</span>
                  <pre className="bg-muted/40 max-h-96 overflow-auto rounded-md border p-3 text-xs whitespace-pre-wrap">
                    {preview.text}
                    {preview.textTruncated ? "\n…" : ""}
                  </pre>
                </div>
              </div>
            )}
          </section>

          <section className="app-panel" aria-labelledby="release-notes-send-heading">
            <div className="app-panel-head">
              <div>
                <h2 id="release-notes-send-heading">Send</h2>
                <p>
                  Sends the latest release notes to the selected audience. At most 100 recipients
                  per send in this dev surface.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor="release-notes-audience" className="text-muted-foreground text-xs">
                  Audience
                </label>
                <Select
                  id="release-notes-audience"
                  aria-label="Audience"
                  options={AUDIENCE_OPTIONS}
                  value={audience}
                  onChange={(value) =>
                    setAudience(typeof value === "string" ? value : "subscribers")
                  }
                />
              </div>
              <Button
                type="button"
                size="sm"
                disabled={sending || entries.length === 0 || (preview?.recipientCount ?? 0) === 0}
                onClick={() => void send()}
              >
                <Send aria-hidden="true" className="size-4" />
                {sending ? "Sending…" : "Send now"}
              </Button>
            </div>
            {audience === "all-users" ? (
              <p className="text-muted-foreground mt-2 text-xs">
                The auth backend cannot enumerate all users yet, so this audience resolves to
                newsletter subscribers.
              </p>
            ) : null}

            {sendError ? <p className="text-destructive mt-3 text-sm">{sendError}</p> : null}

            {sendResult ? (
              <div className="mt-4 flex flex-col gap-2 rounded-md border p-3 text-sm">
                <p className="font-medium">Send result</p>
                <ul className="text-muted-foreground flex flex-col gap-1">
                  <li>Attempted: {sendResult.result.attempted}</li>
                  <li>Suppressed (opted out): {sendResult.result.suppressed}</li>
                  <li>Sent: {sendResult.result.sent}</li>
                  <li>Unconfigured: {sendResult.result.unconfigured}</li>
                  <li>Failed: {sendResult.result.failed}</li>
                </ul>
                {sendResult.audienceNote ? (
                  <p className="text-muted-foreground text-xs">{sendResult.audienceNote}</p>
                ) : null}
                {!sendResult.emailConfigured ? (
                  <p className="text-muted-foreground text-xs">
                    Email delivery is not configured (no RESEND_API_KEY); nothing was delivered.
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  )
}
