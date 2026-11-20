"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { CircleDollarSign } from "lucide-react"

import { EmptyState } from "@/components/app/states/empty-state"
import { ErrorState } from "@/components/app/states/error-state"
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

/**
 * Admin "Commissions" screen for `/app/admin/commissions`: the commission
 * ledger backed by `GET /api/admin/commissions` and
 * `PATCH /api/admin/commissions/[id]`. `mark-paid` is a ledger status only —
 * no money moves; payout automation is a separate task. See
 * `src/lib/commissions.ts` for the status machine.
 */

const COMMISSIONS_API = "/api/admin/commissions"

export type CommissionStatus = "pending" | "approved" | "paid" | "void"
export type CommissionAction = "approve" | "void" | "mark-paid"

export interface CommissionRow {
  id: string
  affiliateId: string
  conversionId?: string
  amountCents: number
  currency: string
  status: CommissionStatus
  reason: string
  createdAt: string
  updatedAt: string
}

interface CommissionsResponse {
  ok: boolean
  commissions?: CommissionRow[]
  commission?: CommissionRow
  message?: string
}

const STATUS_OPTIONS: { value: CommissionStatus | "all"; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "paid", label: "Paid" },
  { value: "void", label: "Void" },
  { value: "all", label: "All statuses" },
]

function statusBadgeVariant(status: CommissionStatus) {
  switch (status) {
    case "approved":
      return "secondary" as const
    case "pending":
      return "default" as const
    case "paid":
      return "outline" as const
    case "void":
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

/** Actions offered per status; mirrors COMMISSION_TRANSITIONS in the lib. */
function actionsFor(status: CommissionStatus): CommissionAction[] {
  switch (status) {
    case "pending":
      return ["approve", "void"]
    case "approved":
      return ["mark-paid", "void"]
    case "paid":
    case "void":
      return []
  }
}

const ACTION_LABELS: Record<CommissionAction, string> = {
  approve: "Approve",
  void: "Void",
  "mark-paid": "Mark paid",
}

export function CommissionsScreen() {
  const [statusFilter, setStatusFilter] = useState<CommissionStatus | "all">("pending")
  const [affiliateFilter, setAffiliateFilter] = useState("")
  const [rows, setRows] = useState<CommissionRow[] | null>(null)
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
      const params = new URLSearchParams()
      if (statusFilter !== "all") params.set("status", statusFilter)
      const affiliateId = affiliateFilter.trim()
      if (affiliateId) params.set("affiliateId", affiliateId)
      const query = params.size > 0 ? `?${params.toString()}` : ""
      const response = await fetch(`${COMMISSIONS_API}${query}`, { cache: "no-store" })
      const data = (await response.json()) as CommissionsResponse
      if (current !== seq.current) return
      if (!response.ok || !data.ok) {
        setListError(data.message ?? "Could not load commissions.")
        return
      }
      setRows(data.commissions ?? [])
    } catch {
      if (current === seq.current) setListError("Could not load commissions.")
    }
  }, [statusFilter, affiliateFilter])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  const runAction = async (row: CommissionRow, action: CommissionAction) => {
    setPendingId(row.id)
    setActionError(null)
    try {
      const response = await fetch(`${COMMISSIONS_API}/${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const data = (await response.json()) as CommissionsResponse
      if (!response.ok || !data.ok || !data.commission) {
        setActionError(data.message ?? "Could not update the commission.")
        return
      }
      setReloadKey((key) => key + 1)
    } catch {
      setActionError("Could not update the commission.")
    } finally {
      setPendingId(null)
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-44">
            <Select
              aria-label="Filter by status"
              options={STATUS_OPTIONS}
              value={statusFilter}
              onChange={(value) =>
                setStatusFilter((value as CommissionStatus | "all") ?? "pending")
              }
            />
          </div>
          <div className="w-64">
            <Input
              aria-label="Filter by affiliate id"
              placeholder="Affiliate id (aff_…)"
              value={affiliateFilter}
              onChange={(event) => setAffiliateFilter(event.target.value)}
            />
          </div>
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
        <LoadingPanel label="Loading commissions" className="min-h-48">
          <div className="bg-muted h-64 animate-pulse rounded-xl" />
        </LoadingPanel>
      ) : null}

      {listError ? (
        <ErrorState
          title="Commissions unavailable"
          message={listError}
          onRetry={() => setReloadKey((key) => key + 1)}
        />
      ) : null}

      {rows !== null && rows.length === 0 && !listError ? (
        <EmptyState
          icon={<CircleDollarSign className="size-5" aria-hidden="true" />}
          title="No commissions here"
          body={
            statusFilter === "pending" && !affiliateFilter.trim()
              ? "The approval queue is empty — recorded commissions will appear here."
              : "No commissions match this filter."
          }
        />
      ) : null}

      {rows !== null && rows.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Affiliate</TableHead>
              <TableHead>Conversion</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
                    {row.affiliateId}
                  </code>
                </TableCell>
                <TableCell>
                  {row.conversionId ? (
                    <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
                      {row.conversionId}
                    </code>
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right font-medium">
                  {formatCents(row.amountCents)}
                </TableCell>
                <TableCell>
                  <Badge variant={statusBadgeVariant(row.status)} className="capitalize">
                    {row.status}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-56 truncate" title={row.reason}>
                  {row.reason}
                </TableCell>
                <TableCell>{formatDate(row.createdAt)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    {actionsFor(row.status).map((action) => (
                      <Button
                        key={action}
                        type="button"
                        size="sm"
                        variant={action === "void" ? "outline" : "default"}
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
