"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Radar, ShieldAlert } from "lucide-react"

import { EmptyState } from "@/components/app/states/empty-state"
import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

/**
 * Admin "Referral fraud" screen for `/app/admin/referral-fraud`: the flagged
 * referral review queue backed by `/api/admin/referral-fraud`. An admin runs
 * a scan (POST) to evaluate stored referral records, then clears or confirms
 * each flag (PATCH on `/api/admin/referral-fraud/[id]`).
 *
 * There is no referral backend yet — the queue is fed by the in-memory dev
 * seam in `src/lib/referral-fraud.ts`, so flags do not survive restarts.
 */

const FRAUD_API = "/api/admin/referral-fraud"

type FlagStatus = "pending" | "cleared" | "confirmed_fraud"
type StatusFilter = FlagStatus | "all"

const STATUS_FILTERS: readonly { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "cleared", label: "Cleared" },
  { value: "confirmed_fraud", label: "Confirmed fraud" },
]

export interface FraudReason {
  rule: string
  detail: string
  points: number
}

export interface FlaggedReferralRow {
  id: string
  referralId: string
  referrerId: string | null
  referrerEmail: string | null
  referredId: string | null
  referredEmail: string | null
  score: number
  reasons: FraudReason[]
  status: FlagStatus
  scannedAt: string
  reviewedBy: string | null
  reviewedAt: string | null
}

interface FlagsResponse {
  ok: boolean
  flags?: FlaggedReferralRow[]
  total?: number
  message?: string
}

function scoreVariant(score: number): "destructive" | "secondary" | "outline" {
  if (score >= 70) return "destructive"
  if (score >= 40) return "secondary"
  return "outline"
}

function statusLabel(status: FlagStatus): string {
  if (status === "confirmed_fraud") return "Confirmed fraud"
  if (status === "cleared") return "Cleared"
  return "Pending"
}

function statusVariant(status: FlagStatus): "destructive" | "secondary" | "outline" {
  if (status === "confirmed_fraud") return "destructive"
  if (status === "cleared") return "secondary"
  return "outline"
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(undefined, { dateStyle: "medium" })
}

function referralSummary(flag: FlaggedReferralRow): string {
  const referrer = flag.referrerEmail ?? flag.referrerId ?? "unknown referrer"
  const referred = flag.referredEmail ?? flag.referredId ?? "unknown referred"
  return `${referrer} → ${referred}`
}

export function ReferralFraudScreen() {
  const [flags, setFlags] = useState<FlaggedReferralRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [filter, setFilter] = useState<StatusFilter>("pending")
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const requestSeq = useRef(0)

  const load = useCallback(async (status: StatusFilter) => {
    const seq = ++requestSeq.current
    setFlags(null)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (status !== "all") params.set("status", status)
      const query = params.toString()
      const suffix = query ? `?${query}` : ""
      const response = await fetch(`${FRAUD_API}${suffix}`, { cache: "no-store" })
      const data = (await response.json()) as FlagsResponse
      if (seq !== requestSeq.current) return
      if (!response.ok || !data.ok) {
        setError(data.message ?? "Could not load the fraud queue.")
        setFlags([])
        return
      }
      setFlags(data.flags ?? [])
      setTotal(data.total ?? 0)
    } catch {
      if (seq !== requestSeq.current) return
      setError("Could not load the fraud queue. Check your connection and try again.")
      setFlags([])
    }
  }, [])

  useEffect(() => {
    void load(filter)
  }, [filter, load])

  const runScan = useCallback(async () => {
    setScanning(true)
    setError(null)
    try {
      const response = await fetch(FRAUD_API, { method: "POST" })
      const data = (await response.json()) as FlagsResponse
      if (!response.ok || !data.ok) {
        setError(data.message ?? "The fraud scan failed.")
        return
      }
      // Rescan then reload so the queue reflects any status changes.
      await load(filter)
    } catch {
      setError("The fraud scan failed. Check your connection and try again.")
    } finally {
      setScanning(false)
    }
  }, [filter, load])

  const review = useCallback(
    async (flag: FlaggedReferralRow, status: FlagStatus) => {
      setReviewingId(flag.id)
      setError(null)
      try {
        const response = await fetch(`${FRAUD_API}/${encodeURIComponent(flag.id)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status }),
        })
        const data = (await response.json()) as { ok: boolean; message?: string }
        if (!response.ok || !data.ok) {
          setError(data.message ?? "Could not update the flag.")
          return
        }
        // Reload so the row moves between status filters correctly.
        await load(filter)
      } catch {
        setError("Could not update the flag. Check your connection and try again.")
      } finally {
        setReviewingId(null)
      }
    },
    [filter, load],
  )

  const loading = flags === null && error === null

  return (
    <section className="app-panel" aria-labelledby="admin-referral-fraud-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="admin-referral-fraud-heading">Referral fraud queue</h2>
          <p>
            Suspicious referrals flagged by the fraud rules. Run a scan to evaluate stored referral
            records, then clear or confirm each flag.
          </p>
        </div>
        <div className="app-panel-head-actions">
          <div className="flex items-center gap-2" role="group" aria-label="Filter by status">
            {STATUS_FILTERS.map((option) => (
              <Button
                key={option.value}
                type="button"
                size="sm"
                variant={filter === option.value ? "default" : "outline"}
                onClick={() => setFilter(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
          <Button type="button" size="sm" onClick={() => void runScan()} disabled={scanning}>
            <Radar aria-hidden="true" className="size-4" />
            {scanning ? "Scanning…" : "Run scan"}
          </Button>
        </div>
      </div>

      {error ? (
        <InlineError
          title="Fraud queue unavailable"
          message={
            <span className="flex flex-wrap items-center gap-2">
              <span>{error}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => void load(filter)}>
                Retry
              </Button>
            </span>
          }
        />
      ) : null}

      {loading ? (
        <LoadingPanel label="Loading fraud queue" variant="table" />
      ) : flags !== null && flags.length > 0 ? (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Referral</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Reasons</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Scanned</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {flags.map((flag) => (
                <TableRow key={flag.id}>
                  <TableCell>
                    <div className="font-medium">{referralSummary(flag)}</div>
                    <div className="text-muted-foreground text-xs">{flag.referralId}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={scoreVariant(flag.score)}>{flag.score}</Badge>
                  </TableCell>
                  <TableCell>
                    <ul className="space-y-1 text-xs">
                      {flag.reasons.map((reason) => (
                        <li key={reason.rule}>
                          <span className="font-medium">{reason.rule}</span>
                          {" — "}
                          {reason.detail}
                        </li>
                      ))}
                    </ul>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(flag.status)}>{statusLabel(flag.status)}</Badge>
                    {flag.reviewedBy ? (
                      <div className="text-muted-foreground mt-1 text-xs">
                        by {flag.reviewedBy}
                        {flag.reviewedAt ? ` · ${formatDate(flag.reviewedAt)}` : ""}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>{formatDate(flag.scannedAt)}</TableCell>
                  <TableCell className="text-right">
                    {flag.status === "pending" ? (
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={reviewingId === flag.id}
                          onClick={() => void review(flag, "cleared")}
                        >
                          Clear
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          disabled={reviewingId === flag.id}
                          onClick={() => void review(flag, "confirmed_fraud")}
                        >
                          Confirm fraud
                        </Button>
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-xs">Reviewed</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-muted-foreground mt-3 text-xs">
            {total} flag{total === 1 ? "" : "s"} in this view.
          </p>
        </>
      ) : error ? null : (
        <EmptyState
          icon={<ShieldAlert aria-hidden="true" />}
          title={filter === "pending" ? "No pending flags" : "No flagged referrals"}
          body={
            filter === "pending"
              ? "Nothing needs review right now. Run a scan to re-check stored referrals."
              : "No referrals match this status filter."
          }
        />
      )}
    </section>
  )
}
