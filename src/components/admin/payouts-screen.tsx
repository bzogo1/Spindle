"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Banknote } from "lucide-react"

import { EmptyState } from "@/components/app/states/empty-state"
import { ErrorState } from "@/components/app/states/error-state"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

/**
 * Admin "Payouts" screen for `/app/admin/payouts`: payout runs backed by
 * `GET/POST /api/admin/payouts`, `GET/POST /api/admin/payouts/[id]`, and
 * `POST /api/admin/payouts/[id]/items` for adding items to draft runs.
 * Processing is SIMULATED — `processRun` marks items paid/failed by fixed
 * rules and no money moves. See `src/lib/payouts.ts` for the state machine.
 */

const PAYOUTS_API = "/api/admin/payouts"

export type PayoutRunStatus = "draft" | "processing" | "completed" | "failed"
export type PayoutItemStatus = "pending" | "paid" | "failed"

export interface PayoutRunRow {
  id: string
  status: PayoutRunStatus
  periodStart: string
  periodEnd: string
  createdAt: string
  completedAt?: string
}

export interface PayoutItemRow {
  id: string
  payoutId: string
  affiliateId: string
  amountCents: number
  status: PayoutItemStatus
  failureReason?: string
  commissionIds: string[]
}

interface PayoutsResponse {
  ok: boolean
  runs?: PayoutRunRow[]
  run?: PayoutRunRow
  items?: PayoutItemRow[]
  message?: string
}

function runBadgeVariant(status: PayoutRunStatus) {
  switch (status) {
    case "draft":
      return "default" as const
    case "processing":
      return "secondary" as const
    case "completed":
      return "outline" as const
    case "failed":
      return "destructive" as const
  }
}

function itemBadgeVariant(status: PayoutItemStatus) {
  switch (status) {
    case "paid":
      return "outline" as const
    case "pending":
      return "default" as const
    case "failed":
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

/** Runs that may still be (re)processed, mirroring processRun's rule. */
function canProcess(status: PayoutRunStatus): boolean {
  return status === "draft" || status === "failed"
}

export function PayoutsScreen() {
  const [runs, setRuns] = useState<PayoutRunRow[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [periodStart, setPeriodStart] = useState("")
  const [periodEnd, setPeriodEnd] = useState("")
  const [createPending, setCreatePending] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ run: PayoutRunRow; items: PayoutItemRow[] } | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [processPending, setProcessPending] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const [itemAffiliateId, setItemAffiliateId] = useState("")
  const [itemAmount, setItemAmount] = useState("")
  const [itemCommissions, setItemCommissions] = useState("")
  const [itemPending, setItemPending] = useState(false)
  const [itemError, setItemError] = useState<string | null>(null)

  const seq = useRef(0)
  const detailSeq = useRef(0)

  const load = useCallback(async () => {
    const current = ++seq.current
    setRuns(null)
    setListError(null)
    try {
      const response = await fetch(PAYOUTS_API, { cache: "no-store" })
      const data = (await response.json()) as PayoutsResponse
      if (current !== seq.current) return
      if (!response.ok || !data.ok) {
        setListError(data.message ?? "Could not load payout runs.")
        return
      }
      setRuns(data.runs ?? [])
    } catch {
      if (current === seq.current) setListError("Could not load payout runs.")
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  const loadDetail = useCallback(async (id: string) => {
    const current = ++detailSeq.current
    setDetail(null)
    setDetailError(null)
    try {
      const response = await fetch(`${PAYOUTS_API}/${encodeURIComponent(id)}`, {
        cache: "no-store",
      })
      const data = (await response.json()) as PayoutsResponse
      if (current !== detailSeq.current) return
      if (!response.ok || !data.ok || !data.run) {
        setDetailError(data.message ?? "Could not load the payout run.")
        return
      }
      setDetail({ run: data.run, items: data.items ?? [] })
    } catch {
      if (current === detailSeq.current) setDetailError("Could not load the payout run.")
    }
  }, [])

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId)
  }, [selectedId, loadDetail, reloadKey])

  const createRun = async () => {
    setCreatePending(true)
    setCreateError(null)
    try {
      const response = await fetch(PAYOUTS_API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ periodStart, periodEnd }),
      })
      const data = (await response.json()) as PayoutsResponse
      if (!response.ok || !data.ok) {
        setCreateError(data.message ?? "Could not create the payout run.")
        return
      }
      setPeriodStart("")
      setPeriodEnd("")
      setSelectedId(data.run?.id ?? null)
      setReloadKey((key) => key + 1)
    } catch {
      setCreateError("Could not create the payout run.")
    } finally {
      setCreatePending(false)
    }
  }

  const processRun = async () => {
    if (!detail) return
    setProcessPending(true)
    setActionError(null)
    try {
      const response = await fetch(`${PAYOUTS_API}/${encodeURIComponent(detail.run.id)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "process" }),
      })
      const data = (await response.json()) as PayoutsResponse
      if (!response.ok || !data.ok) {
        setActionError(data.message ?? "Could not process the payout run.")
        return
      }
      setReloadKey((key) => key + 1)
    } catch {
      setActionError("Could not process the payout run.")
    } finally {
      setProcessPending(false)
    }
  }

  const addItem = async () => {
    if (!detail) return
    const amountCents = Math.round(Number(itemAmount) * 100)
    if (!itemAffiliateId.trim() || !Number.isFinite(amountCents) || amountCents <= 0) {
      setItemError("Enter an affiliate id and a positive amount.")
      return
    }
    const commissionIds = itemCommissions
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
    setItemPending(true)
    setItemError(null)
    try {
      const response = await fetch(`${PAYOUTS_API}/${encodeURIComponent(detail.run.id)}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          affiliateId: itemAffiliateId.trim(),
          amountCents,
          ...(commissionIds.length > 0 ? { commissionIds } : {}),
        }),
      })
      const data = (await response.json()) as PayoutsResponse
      if (!response.ok || !data.ok) {
        setItemError(data.message ?? "Could not add the payout item.")
        return
      }
      setItemAffiliateId("")
      setItemAmount("")
      setItemCommissions("")
      setReloadKey((key) => key + 1)
    } catch {
      setItemError("Could not add the payout item.")
    } finally {
      setItemPending(false)
    }
  }

  const paidTotal = detail?.items
    .filter((item) => item.status === "paid")
    .reduce((sum, item) => sum + item.amountCents, 0)

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 rounded-xl border p-4">
        <h2 className="text-sm font-medium">New payout run</h2>
        <p className="text-muted-foreground text-xs">
          Creates a draft run for a commission period. Processing is simulated — no money moves.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-xs">
            Period start
            <Input
              type="date"
              value={periodStart}
              onChange={(event) => setPeriodStart(event.target.value)}
              className="w-44"
            />
          </label>
          <label className="grid gap-1 text-xs">
            Period end
            <Input
              type="date"
              value={periodEnd}
              onChange={(event) => setPeriodEnd(event.target.value)}
              className="w-44"
            />
          </label>
          <Button
            type="button"
            size="sm"
            disabled={createPending || !periodStart || !periodEnd}
            onClick={() => void createRun()}
          >
            {createPending ? "Creating…" : "Create run"}
          </Button>
        </div>
        {createError ? <ErrorState title="Create failed" message={createError} /> : null}
      </div>

      {actionError ? <ErrorState title="Action failed" message={actionError} /> : null}

      {runs === null && !listError ? (
        <LoadingPanel label="Loading payout runs" className="min-h-48">
          <div className="bg-muted h-64 animate-pulse rounded-xl" />
        </LoadingPanel>
      ) : null}

      {listError ? (
        <ErrorState
          title="Payout runs unavailable"
          message={listError}
          onRetry={() => setReloadKey((key) => key + 1)}
        />
      ) : null}

      {runs !== null && runs.length === 0 && !listError ? (
        <EmptyState
          icon={<Banknote className="size-5" aria-hidden="true" />}
          title="No payout runs yet"
          body="Create a run above to start a simulated payout batch for a commission period."
        />
      ) : null}

      {runs !== null && runs.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Period</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Completed</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => (
              <TableRow key={run.id}>
                <TableCell>
                  <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">{run.id}</code>
                  <span className="text-muted-foreground ml-2 text-xs">
                    {formatDate(run.periodStart)} – {formatDate(run.periodEnd)}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge variant={runBadgeVariant(run.status)} className="capitalize">
                    {run.status}
                  </Badge>
                </TableCell>
                <TableCell>{formatDate(run.createdAt)}</TableCell>
                <TableCell>{run.completedAt ? formatDate(run.completedAt) : "—"}</TableCell>
                <TableCell className="text-right">
                  <Button
                    type="button"
                    size="sm"
                    variant={selectedId === run.id ? "default" : "outline"}
                    onClick={() => setSelectedId(run.id)}
                  >
                    {selectedId === run.id ? "Viewing" : "View"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}

      {selectedId ? (
        <div className="grid gap-3 rounded-xl border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium">
                Run{" "}
                <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
                  {selectedId}
                </code>
              </h2>
              {detail ? (
                <p className="text-muted-foreground text-xs">
                  {detail.run.status} · {detail.items.length} item
                  {detail.items.length === 1 ? "" : "s"}
                  {paidTotal !== undefined
                    ? ` · ${formatCents(paidTotal ?? 0)} paid (simulated)`
                    : ""}
                </p>
              ) : null}
            </div>
            {detail && canProcess(detail.run.status) ? (
              <Button
                type="button"
                size="sm"
                disabled={processPending}
                onClick={() => void processRun()}
              >
                {processPending
                  ? "Processing…"
                  : detail.run.status === "failed"
                    ? "Retry processing (simulated)"
                    : "Process (simulated)"}
              </Button>
            ) : null}
          </div>

          {detail && detail.run.status === "draft" ? (
            <div className="grid gap-3 rounded-lg border border-dashed p-3">
              <h3 className="text-xs font-medium">Add payout item</h3>
              <p className="text-muted-foreground text-xs">
                Items can only be added while the run is in draft. Commission ids must reference
                approved commissions belonging to the same affiliate.
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <label className="grid gap-1 text-xs">
                  Affiliate id
                  <Input
                    value={itemAffiliateId}
                    onChange={(event) => setItemAffiliateId(event.target.value)}
                    placeholder="aff_…"
                    className="w-56"
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  Amount (USD)
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={itemAmount}
                    onChange={(event) => setItemAmount(event.target.value)}
                    placeholder="0.00"
                    className="w-32"
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  Commission ids (optional, comma-separated)
                  <Input
                    value={itemCommissions}
                    onChange={(event) => setItemCommissions(event.target.value)}
                    placeholder="com_…, com_…"
                    className="w-72"
                  />
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={itemPending}
                  onClick={() => void addItem()}
                >
                  {itemPending ? "Adding…" : "Add item"}
                </Button>
              </div>
              {itemError ? <ErrorState title="Add item failed" message={itemError} /> : null}
            </div>
          ) : null}

          {detailError ? (
            <ErrorState
              title="Run unavailable"
              message={detailError}
              onRetry={() => void loadDetail(selectedId)}
            />
          ) : null}

          {detail === null && !detailError ? (
            <LoadingPanel label="Loading run items" className="min-h-24">
              <div className="bg-muted h-24 animate-pulse rounded-lg" />
            </LoadingPanel>
          ) : null}

          {detail !== null && detail.items.length === 0 ? (
            <EmptyState
              icon={<Banknote className="size-5" aria-hidden="true" />}
              title="No payout items"
              body="This run has no items yet — add one above while the run is in draft."
            />
          ) : null}

          {detail !== null && detail.items.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Affiliate</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Commissions</TableHead>
                  <TableHead>Failure</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
                        {item.affiliateId}
                      </code>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCents(item.amountCents)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={itemBadgeVariant(item.status)} className="capitalize">
                        {item.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {item.commissionIds.length > 0 ? (
                        <span className="text-muted-foreground text-xs">
                          {item.commissionIds.length} linked
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-56 truncate" title={item.failureReason}>
                      {item.failureReason ?? (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
