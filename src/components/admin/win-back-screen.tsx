"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { MailWarning, Play, Search } from "lucide-react"

import { EmptyState } from "@/components/app/states/empty-state"
import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"

/**
 * Admin "Win-back campaigns" screen for `/app/admin/win-back`: create draft
 * re-engagement campaigns, preview how many inactive users each would reach,
 * change status, and manually run a campaign.
 *
 * Sends are NEVER automatic — there is no scheduler. "Run campaign" calls
 * `POST /api/admin/win-back/[id]`, which executes `runCampaign` once:
 * opted-out addresses (marketing/newsletter/all scopes) are suppressed
 * before any send is attempted. Delivery goes through the Resend seam; when
 * email is unconfigured the run reports `failed` counts honestly.
 *
 * Backed by the in-memory dev-seam store in `src/lib/win-back.ts`.
 */

const API = "/api/admin/win-back"

export type WinBackStatus = "draft" | "active" | "paused" | "completed"

export interface WinBackStats {
  sent: number
  suppressed: number
  failed: number
  churnRisk?: number
}

export interface WinBackRunSummary {
  at: string
  candidates: number
  sent: number
  suppressed: number
  failed: number
}

export interface WinBackCampaignRow {
  id: string
  name: string
  status: WinBackStatus
  subject: string
  bodyTemplate: string
  minInactiveDays: number
  targetSegment?: string
  createdAt: string
  stats: WinBackStats
  lastRun?: WinBackRunSummary
}

interface ListResponse {
  ok: boolean
  campaigns?: WinBackCampaignRow[]
  total?: number
  message?: string
}

interface CampaignResponse {
  ok: boolean
  campaign?: WinBackCampaignRow
  message?: string
}

interface RunResponse {
  ok: boolean
  candidates?: number
  sent?: number
  suppressed?: number
  failed?: number
  message?: string
}

interface PreviewResponse {
  ok: boolean
  candidateCount?: number
  message?: string
}

const STATUS_OPTIONS: { value: WinBackStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "completed", label: "Completed" },
]

const SUBJECT_MAX = 200
const BODY_MAX = 50_000
const MIN_DAYS_MIN = 1
const MIN_DAYS_MAX = 3650

function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

function statusBadgeVariant(status: WinBackStatus) {
  if (status === "active") return "default" as const
  if (status === "completed") return "secondary" as const
  if (status === "paused") return "outline" as const
  return "outline" as const
}

export function WinBackScreen() {
  const [campaigns, setCampaigns] = useState<WinBackCampaignRow[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const listSeq = useRef(0)

  const [name, setName] = useState("")
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [minInactiveDays, setMinInactiveDays] = useState("30")
  const [targetSegment, setTargetSegment] = useState("")
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [formNotice, setFormNotice] = useState<string | null>(null)

  const [previewingId, setPreviewingId] = useState<string | null>(null)
  const [previewCounts, setPreviewCounts] = useState<Record<string, number | "error">>({})
  const [runningId, setRunningId] = useState<string | null>(null)
  const [runResults, setRunResults] = useState<Record<string, string>>({})
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  const refresh = useCallback(() => setReloadKey((key) => key + 1), [])

  useEffect(() => {
    const seq = ++listSeq.current
    setCampaigns(null)
    setListError(null)
    void (async () => {
      try {
        const response = await fetch(API, { cache: "no-store" })
        const data = (await response.json()) as ListResponse
        if (seq !== listSeq.current) return
        if (!response.ok || !data.ok) {
          setListError(data.message ?? "Could not load campaigns.")
          setCampaigns([])
          return
        }
        setCampaigns(data.campaigns ?? [])
      } catch {
        if (seq !== listSeq.current) return
        setListError("Could not load campaigns. Check your connection and try again.")
        setCampaigns([])
      }
    })()
  }, [reloadKey])

  const create = useCallback(async () => {
    const days = Number.parseInt(minInactiveDays, 10)
    if (!name.trim() || !subject.trim() || !body.trim()) {
      setFormError("Name, subject, and body are all required.")
      return
    }
    if (!Number.isFinite(days) || days < MIN_DAYS_MIN || days > MIN_DAYS_MAX) {
      setFormError(`Inactive threshold must be between ${MIN_DAYS_MIN} and ${MIN_DAYS_MAX} days.`)
      return
    }
    setCreating(true)
    setFormError(null)
    setFormNotice(null)
    try {
      const response = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          subject: subject.trim(),
          body: body.trim(),
          minInactiveDays: days,
          ...(targetSegment.trim() ? { targetSegment: targetSegment.trim() } : {}),
        }),
      })
      const data = (await response.json()) as CampaignResponse
      if (!response.ok || !data.ok) {
        setFormError(data.message ?? "Could not create the campaign.")
        return
      }
      setName("")
      setSubject("")
      setBody("")
      setMinInactiveDays("30")
      setTargetSegment("")
      setFormNotice("Campaign created as a draft. Preview it, then run it when ready.")
      refresh()
    } catch {
      setFormError("Could not create the campaign. Check your connection and try again.")
    } finally {
      setCreating(false)
    }
  }, [name, subject, body, minInactiveDays, targetSegment, refresh])

  const setStatus = useCallback(
    async (id: string, status: WinBackStatus) => {
      setUpdatingId(id)
      setListError(null)
      try {
        const response = await fetch(`${API}/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        })
        const data = (await response.json()) as CampaignResponse
        if (!response.ok || !data.ok) {
          setListError(data.message ?? "Could not update the campaign.")
          return
        }
        refresh()
      } catch {
        setListError("Could not update the campaign. Check your connection and try again.")
      } finally {
        setUpdatingId(null)
      }
    },
    [refresh],
  )

  const preview = useCallback(async (id: string) => {
    setPreviewingId(id)
    try {
      const response = await fetch(`${API}?preview=1&campaignId=${encodeURIComponent(id)}`, {
        cache: "no-store",
      })
      const data = (await response.json()) as PreviewResponse
      if (!response.ok || !data.ok || typeof data.candidateCount !== "number") {
        setPreviewCounts((prev) => ({ ...prev, [id]: "error" }))
        return
      }
      setPreviewCounts((prev) => ({ ...prev, [id]: data.candidateCount as number }))
    } catch {
      setPreviewCounts((prev) => ({ ...prev, [id]: "error" }))
    } finally {
      setPreviewingId(null)
    }
  }, [])

  const run = useCallback(
    async (campaign: WinBackCampaignRow) => {
      const runnable = campaign.status !== "completed"
      if (!runnable) return
      const confirmed = window.confirm(
        `Run "${campaign.name}" now? This emails up to all inactive users ` +
          `(${campaign.minInactiveDays}+ days inactive). Opted-out addresses are skipped.`,
      )
      if (!confirmed) return

      setRunningId(campaign.id)
      setRunResults((prev) => {
        const next = { ...prev }
        delete next[campaign.id]
        return next
      })
      try {
        const response = await fetch(`${API}/${campaign.id}`, { method: "POST" })
        const data = (await response.json()) as RunResponse
        if (!response.ok || !data.ok) {
          setRunResults((prev) => ({
            ...prev,
            [campaign.id]: data.message ?? "Run failed.",
          }))
          return
        }
        setRunResults((prev) => ({
          ...prev,
          [campaign.id]:
            `Sent ${data.sent ?? 0}, suppressed ${data.suppressed ?? 0} (opt-outs), ` +
            `failed ${data.failed ?? 0} of ${data.candidates ?? 0} candidates.`,
        }))
        refresh()
      } catch {
        setRunResults((prev) => ({
          ...prev,
          [campaign.id]: "Run failed. Check your connection and try again.",
        }))
      } finally {
        setRunningId(null)
      }
    },
    [refresh],
  )

  return (
    <div className="space-y-6">
      <section className="rounded-lg border p-4">
        <h2 className="text-sm font-semibold">New campaign</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          Use {"{{name}}"} in the subject or body to personalize. Emails are only sent when you
          explicitly run the campaign — there is no automatic scheduler.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs">
            <span className="font-medium">Name</span>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Spring win-back"
              maxLength={120}
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium">Inactive threshold (days)</span>
            <Input
              value={minInactiveDays}
              onChange={(event) => setMinInactiveDays(event.target.value)}
              inputMode="numeric"
              placeholder="30"
            />
          </label>
          <label className="space-y-1 text-xs sm:col-span-2">
            <span className="font-medium">Subject</span>
            <Input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="We miss you, {{name}}"
              maxLength={SUBJECT_MAX}
            />
          </label>
          <label className="space-y-1 text-xs sm:col-span-2">
            <span className="font-medium">Body</span>
            <Textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder={"Hi {{name}},\n\nIt's been a while…"}
              rows={5}
              maxLength={BODY_MAX}
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium">Target segment (optional)</span>
            <Input
              value={targetSegment}
              onChange={(event) => setTargetSegment(event.target.value)}
              placeholder="newsletter"
              maxLength={120}
            />
          </label>
        </div>
        {formError ? <InlineError title={null} message={formError} className="mt-3" /> : null}
        {formNotice ? (
          <p className="text-muted-foreground mt-3 text-xs" role="status">
            {formNotice}
          </p>
        ) : null}
        <div className="mt-3">
          <Button onClick={() => void create()} disabled={creating}>
            {creating ? "Creating…" : "Create draft"}
          </Button>
        </div>
      </section>

      <section className="rounded-lg border">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Campaigns</h2>
          <p className="text-muted-foreground text-xs">
            Recipients who unsubscribed (marketing, newsletter, or all email) are always suppressed
            before sending.
          </p>
        </div>
        {campaigns === null ? (
          <LoadingPanel label="Loading campaigns" className="min-h-32">
            <div />
          </LoadingPanel>
        ) : listError ? (
          <div className="p-4">
            <InlineError title="Campaigns unavailable" message={listError} />
          </div>
        ) : campaigns.length === 0 ? (
          <EmptyState
            icon={<MailWarning className="h-6 w-6" />}
            title="No win-back campaigns yet"
            body="Create a draft above to start re-engaging inactive users."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Inactive ≥</TableHead>
                <TableHead className="text-right">Sent</TableHead>
                <TableHead className="text-right">Suppressed</TableHead>
                <TableHead className="text-right">Failed</TableHead>
                <TableHead className="text-right">Churn risk</TableHead>
                <TableHead>Last run</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((campaign) => {
                const previewValue = previewCounts[campaign.id]
                const runResult = runResults[campaign.id]
                return (
                  <TableRow key={campaign.id}>
                    <TableCell>
                      <div className="font-medium">{campaign.name}</div>
                      <div className="text-muted-foreground max-w-56 truncate text-xs">
                        {campaign.subject}
                        {campaign.targetSegment ? ` · ${campaign.targetSegment}` : ""}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Select
                        aria-label={`Status for ${campaign.name}`}
                        options={STATUS_OPTIONS.map((option) => ({
                          value: option.value,
                          label: option.label,
                        }))}
                        value={campaign.status}
                        disabled={campaign.status === "completed" || updatingId === campaign.id}
                        onChange={(value) => {
                          if (typeof value === "string") {
                            void setStatus(campaign.id, value as WinBackStatus)
                          }
                        }}
                      />
                      <Badge variant={statusBadgeVariant(campaign.status)} className="ml-2">
                        {campaign.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{campaign.minInactiveDays}d</TableCell>
                    <TableCell className="text-right">{campaign.stats.sent}</TableCell>
                    <TableCell className="text-right">{campaign.stats.suppressed}</TableCell>
                    <TableCell className="text-right">{campaign.stats.failed}</TableCell>
                    <TableCell className="text-right">{campaign.stats.churnRisk ?? "—"}</TableCell>
                    <TableCell className="text-xs">
                      {campaign.lastRun ? formatDateTime(campaign.lastRun.at) : "Never"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={previewingId === campaign.id}
                          onClick={() => void preview(campaign.id)}
                        >
                          <Search className="mr-1 h-3.5 w-3.5" />
                          {previewingId === campaign.id ? "…" : "Preview"}
                        </Button>
                        <Button
                          size="sm"
                          disabled={runningId === campaign.id || campaign.status === "completed"}
                          onClick={() => void run(campaign)}
                        >
                          <Play className="mr-1 h-3.5 w-3.5" />
                          {runningId === campaign.id ? "Running…" : "Run"}
                        </Button>
                      </div>
                      {typeof previewValue === "number" ? (
                        <p className="text-muted-foreground mt-1 text-xs">
                          {previewValue} candidate{previewValue === 1 ? "" : "s"} right now
                        </p>
                      ) : previewValue === "error" ? (
                        <p className="text-destructive mt-1 text-xs">Preview failed</p>
                      ) : null}
                      {runResult ? (
                        <p className="text-muted-foreground mt-1 max-w-64 text-xs">{runResult}</p>
                      ) : null}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  )
}
