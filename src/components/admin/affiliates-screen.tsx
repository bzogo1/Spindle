"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Users } from "lucide-react"

import { EmptyState } from "@/components/app/states/empty-state"
import { ErrorState } from "@/components/app/states/error-state"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

/**
 * Admin "Affiliates" screen for `/app/admin/affiliates`: the approval queue
 * and management list backed by `GET/PATCH /api/admin/affiliates`. Approval
 * gates whether a tracking code records clicks/conversions (see
 * `src/lib/affiliate.ts`); there are no real payouts.
 */

const AFFILIATES_API = "/api/admin/affiliates"

export type AffiliateStatus = "pending" | "active" | "suspended" | "rejected"
export type AffiliateAction = "approve" | "reject" | "suspend"

export interface AffiliateStatsView {
  clicks: number
  conversions: number
  revenueCents: number
  commissionCents: number
}

export interface AffiliateRow {
  id: string
  userId: string
  email: string
  status: AffiliateStatus
  code: string
  commissionRatePct: number
  createdAt: string
  stats: AffiliateStatsView
}

interface AffiliatesResponse {
  ok: boolean
  affiliates?: AffiliateRow[]
  affiliate?: AffiliateRow
  message?: string
}

const STATUS_OPTIONS: { value: AffiliateStatus | "all"; label: string }[] = [
  { value: "pending", label: "Pending review" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All statuses" },
]

function statusBadgeVariant(status: AffiliateStatus) {
  switch (status) {
    case "active":
      return "secondary" as const
    case "pending":
      return "default" as const
    case "suspended":
      return "outline" as const
    case "rejected":
      return "destructive" as const
  }
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(undefined, { dateStyle: "medium" })
}

/** Actions offered per status; rejected accounts are terminal. */
function actionsFor(status: AffiliateStatus): AffiliateAction[] {
  switch (status) {
    case "pending":
      return ["approve", "reject"]
    case "active":
      return ["suspend"]
    case "suspended":
      return ["approve", "reject"]
    case "rejected":
      return []
  }
}

const ACTION_LABELS: Record<AffiliateAction, string> = {
  approve: "Approve",
  reject: "Reject",
  suspend: "Suspend",
}

export function AffiliatesScreen() {
  const [statusFilter, setStatusFilter] = useState<AffiliateStatus | "all">("pending")
  const [rows, setRows] = useState<AffiliateRow[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const seq = useRef(0)

  const load = useCallback(async () => {
    const current = ++seq.current
    setRows(null)
    setListError(null)
    try {
      const query = statusFilter === "all" ? "" : `?status=${statusFilter}`
      const response = await fetch(`${AFFILIATES_API}${query}`, { cache: "no-store" })
      const data = (await response.json()) as AffiliatesResponse
      if (current !== seq.current) return
      if (!response.ok || !data.ok) {
        setListError(data.message ?? "Could not load affiliates.")
        return
      }
      setRows(data.affiliates ?? [])
    } catch {
      if (current === seq.current) setListError("Could not load affiliates.")
    }
  }, [statusFilter])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  const runAction = async (row: AffiliateRow, action: AffiliateAction) => {
    setPendingId(row.id)
    setActionError(null)
    try {
      const response = await fetch(AFFILIATES_API, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: row.id, action }),
      })
      const data = (await response.json()) as AffiliatesResponse
      if (!response.ok || !data.ok || !data.affiliate) {
        setActionError(data.message ?? "Could not update the affiliate account.")
        return
      }
      setReloadKey((key) => key + 1)
    } catch {
      setActionError("Could not update the affiliate account.")
    } finally {
      setPendingId(null)
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="w-56">
          <Select
            aria-label="Filter by status"
            options={STATUS_OPTIONS}
            value={statusFilter}
            onChange={(value) => setStatusFilter((value as AffiliateStatus | "all") ?? "pending")}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setReloadKey((key) => key + 1)}
        >
          Refresh
        </Button>
      </div>

      {actionError ? <ErrorState title="Action failed" message={actionError} /> : null}

      {rows === null && !listError ? (
        <LoadingPanel label="Loading affiliates" className="min-h-48">
          <div className="bg-muted h-64 animate-pulse rounded-xl" />
        </LoadingPanel>
      ) : null}

      {listError ? (
        <ErrorState
          title="Affiliates unavailable"
          message={listError}
          onRetry={() => setReloadKey((key) => key + 1)}
        />
      ) : null}

      {rows !== null && rows.length === 0 && !listError ? (
        <EmptyState
          icon={<Users className="size-5" aria-hidden="true" />}
          title="No affiliates here"
          body={
            statusFilter === "pending"
              ? "The approval queue is empty — new applications will appear here."
              : "No affiliate accounts match this filter."
          }
        />
      ) : null}

      {rows !== null && rows.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Applicant</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Clicks</TableHead>
              <TableHead className="text-right">Conversions</TableHead>
              <TableHead className="text-right">Commission</TableHead>
              <TableHead>Applied</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <div className="font-medium">{row.email}</div>
                  <div className="text-muted-foreground text-xs">{row.commissionRatePct}% rate</div>
                </TableCell>
                <TableCell>
                  <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
                    {row.code}
                  </code>
                </TableCell>
                <TableCell>
                  <Badge variant={statusBadgeVariant(row.status)} className="capitalize">
                    {row.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">{row.stats.clicks.toLocaleString()}</TableCell>
                <TableCell className="text-right">
                  {row.stats.conversions.toLocaleString()}
                </TableCell>
                <TableCell className="text-right">
                  {formatCents(row.stats.commissionCents)}
                </TableCell>
                <TableCell>{formatDate(row.createdAt)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    {actionsFor(row.status).map((action) => (
                      <Button
                        key={action}
                        type="button"
                        size="sm"
                        variant={action === "approve" ? "default" : "outline"}
                        disabled={pendingId === row.id}
                        onClick={() => void runAction(row, action)}
                      >
                        {ACTION_LABELS[action]}
                      </Button>
                    ))}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </div>
  )
}
