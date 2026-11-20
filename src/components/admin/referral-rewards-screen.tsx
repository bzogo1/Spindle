"use client"

import { useCallback, useEffect, useState } from "react"
import { Gift } from "lucide-react"

import { EmptyState } from "@/components/app/states/empty-state"
import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
 * Admin "Referral rewards" screen for `/app/admin/referral-rewards`:
 * reward-ledger stats, filters (status/type/referrer/attribution), an
 * issue form (`POST /api/admin/referral-rewards` with an attribution id),
 * and per-row revoke (`PATCH /api/admin/referral-rewards/[id]`).
 *
 * Backed by the in-memory dev seam in `src/lib/referral-rewards.ts` —
 * rewards are reporting records only; there is no payout pipeline.
 */

const API = "/api/admin/referral-rewards"

export interface ReferralRewardRow {
  id: string
  attributionId: string
  referrerUserId: string
  type: "credit" | "badge" | "trial_extension"
  status: "pending" | "issued" | "revoked"
  amountCents: number | null
  issuedAt: string | null
  revokedAt: string | null
  reason: string
}

interface RewardStatsView {
  total: number
  pending: number
  issued: number
  revoked: number
  byType: Record<string, number>
}

interface RewardsResponse {
  ok: boolean
  rewards?: ReferralRewardRow[]
  total?: number
  stats?: RewardStatsView
  rewardLabel?: string
  reward?: ReferralRewardRow
  message?: string
}

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "issued", label: "Issued" },
  { value: "revoked", label: "Revoked" },
]

const TYPE_OPTIONS = [
  { value: "", label: "All types" },
  { value: "credit", label: "Credit" },
  { value: "badge", label: "Badge" },
  { value: "trial_extension", label: "Trial extension" },
]

const ISSUE_TYPE_OPTIONS = TYPE_OPTIONS.filter((option) => option.value !== "")

interface Filters {
  status: string
  type: string
  referrerUserId: string
  attributionId: string
}

const EMPTY_FILTERS: Filters = {
  status: "",
  type: "",
  referrerUserId: "",
  attributionId: "",
}

function statusBadgeVariant(status: ReferralRewardRow["status"]) {
  switch (status) {
    case "issued":
      return "secondary" as const
    case "pending":
      return "outline" as const
    case "revoked":
      return "destructive" as const
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

function formatAmount(cents: number | null): string {
  if (cents === null) return "—"
  return `$${(cents / 100).toFixed(2)}`
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-2xl font-semibold">{value.toLocaleString()}</div>
      <div className="text-muted-foreground text-xs">{label}</div>
    </div>
  )
}

function filtersToQuery(filters: Filters): string {
  const params = new URLSearchParams()
  if (filters.status) params.set("status", filters.status)
  if (filters.type) params.set("type", filters.type)
  if (filters.referrerUserId.trim()) params.set("referrerUserId", filters.referrerUserId.trim())
  if (filters.attributionId.trim()) params.set("attributionId", filters.attributionId.trim())
  params.set("limit", "200")
  const query = params.toString()
  return query ? `?${query}` : ""
}

export function ReferralRewardsScreen() {
  const [rewards, setRewards] = useState<ReferralRewardRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState<RewardStatsView | null>(null)
  const [rewardLabel, setRewardLabel] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [draftFilters, setDraftFilters] = useState<Filters>(EMPTY_FILTERS)
  const [appliedFilters, setAppliedFilters] = useState<Filters>(EMPTY_FILTERS)

  const [issueAttributionId, setIssueAttributionId] = useState("")
  const [issueType, setIssueType] = useState("credit")
  const [issueAmount, setIssueAmount] = useState("")
  const [issueReason, setIssueReason] = useState("")
  const [issuing, setIssuing] = useState(false)
  const [issueError, setIssueError] = useState<string | null>(null)
  const [issueNotice, setIssueNotice] = useState<string | null>(null)

  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${API}${filtersToQuery(appliedFilters)}`, {
        cache: "no-store",
      })
      const data = (await response.json()) as RewardsResponse
      if (!response.ok || !data.ok) {
        setError(data.message ?? "Could not load referral rewards.")
        return
      }
      setError(null)
      setRewards(data.rewards ?? [])
      setTotal(data.total ?? 0)
      setStats(data.stats ?? null)
      setRewardLabel(data.rewardLabel ?? null)
    } catch {
      setError("Could not load referral rewards.")
    }
  }, [appliedFilters])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  const applyFilters = () => {
    setAppliedFilters({ ...draftFilters })
  }

  const amountValid =
    issueAmount.trim() === "" || (Number.isFinite(Number(issueAmount)) && Number(issueAmount) >= 0)

  const issue = async () => {
    const attributionId = issueAttributionId.trim()
    if (!attributionId) return
    setIssuing(true)
    setIssueError(null)
    setIssueNotice(null)
    try {
      const amount = issueAmount.trim()
      const response = await fetch(API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          attributionId,
          type: issueType,
          ...(amount !== "" ? { amountCents: Math.round(Number(amount) * 100) } : {}),
          ...(issueReason.trim() ? { reason: issueReason.trim() } : {}),
        }),
      })
      const data = (await response.json()) as RewardsResponse
      if (!response.ok || !data.ok) {
        setIssueError(data.message ?? "Could not issue the reward.")
        return
      }
      setIssueAttributionId("")
      setIssueAmount("")
      setIssueReason("")
      setIssueNotice(`Reward ${data.reward?.id ?? ""} issued.`.trim())
      setReloadKey((key) => key + 1)
    } catch {
      setIssueError("Could not issue the reward.")
    } finally {
      setIssuing(false)
    }
  }

  const revoke = async (reward: ReferralRewardRow) => {
    setRevokingId(reward.id)
    setRowError(null)
    try {
      const response = await fetch(`${API}/${encodeURIComponent(reward.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "revoke" }),
      })
      const data = (await response.json()) as RewardsResponse
      if (!response.ok || !data.ok) {
        setRowError(data.message ?? "Could not revoke the reward.")
        return
      }
      setReloadKey((key) => key + 1)
    } catch {
      setRowError("Could not revoke the reward.")
    } finally {
      setRevokingId(null)
    }
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Issue a reward</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="text-muted-foreground text-sm">
            {rewardLabel ??
              "Issue a reporting reward for a qualified referral attribution. The attribution must not be fraud-flagged and can only receive one reward."}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="rr-attribution-id">Attribution ID</Label>
              <Input
                id="rr-attribution-id"
                value={issueAttributionId}
                onChange={(event) => setIssueAttributionId(event.target.value)}
                placeholder="rfa_…"
                className="font-mono text-xs"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rr-issue-type">Type</Label>
              <Select
                id="rr-issue-type"
                aria-label="Reward type"
                options={ISSUE_TYPE_OPTIONS}
                value={issueType}
                onChange={(value) =>
                  setIssueType(typeof value === "string" && value ? value : "credit")
                }
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rr-issue-amount">Value (USD, optional)</Label>
              <Input
                id="rr-issue-amount"
                type="number"
                min={0}
                step="0.01"
                value={issueAmount}
                onChange={(event) => setIssueAmount(event.target.value)}
                placeholder="Reporting value only — no payout"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rr-issue-reason">Reason (optional)</Label>
              <Input
                id="rr-issue-reason"
                value={issueReason}
                onChange={(event) => setIssueReason(event.target.value)}
                placeholder="Admin note"
                maxLength={500}
              />
            </div>
          </div>
          {!amountValid && (
            <p className="text-destructive text-sm">Value must be a non-negative number.</p>
          )}
          {issueError && <InlineError message={issueError} />}
          {issueNotice && <p className="text-muted-foreground text-sm">{issueNotice}</p>}
          <div>
            <Button
              onClick={() => void issue()}
              disabled={issuing || !issueAttributionId.trim() || !amountValid}
            >
              {issuing ? "Issuing…" : "Issue reward"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reward stats</CardTitle>
        </CardHeader>
        <CardContent>
          {stats === null ? (
            <LoadingPanel label="Loading stats" variant="table" />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="Total" value={stats.total} />
              <StatCard label="Pending" value={stats.pending} />
              <StatCard label="Issued" value={stats.issued} />
              <StatCard label="Revoked" value={stats.revoked} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reward ledger</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="rr-filter-status" className="text-muted-foreground text-xs">
                Status
              </Label>
              <Select
                id="rr-filter-status"
                aria-label="Status"
                options={STATUS_OPTIONS}
                value={draftFilters.status || null}
                onChange={(value) =>
                  setDraftFilters({
                    ...draftFilters,
                    status: typeof value === "string" ? value : "",
                  })
                }
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="rr-filter-type" className="text-muted-foreground text-xs">
                Type
              </Label>
              <Select
                id="rr-filter-type"
                aria-label="Type"
                options={TYPE_OPTIONS}
                value={draftFilters.type || null}
                onChange={(value) =>
                  setDraftFilters({ ...draftFilters, type: typeof value === "string" ? value : "" })
                }
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="rr-filter-referrer" className="text-muted-foreground text-xs">
                Referrer user ID
              </Label>
              <Input
                id="rr-filter-referrer"
                value={draftFilters.referrerUserId}
                onChange={(event) =>
                  setDraftFilters({ ...draftFilters, referrerUserId: event.target.value })
                }
                className="w-56 font-mono text-xs"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="rr-filter-attribution" className="text-muted-foreground text-xs">
                Attribution ID
              </Label>
              <Input
                id="rr-filter-attribution"
                value={draftFilters.attributionId}
                onChange={(event) =>
                  setDraftFilters({ ...draftFilters, attributionId: event.target.value })
                }
                className="w-56 font-mono text-xs"
              />
            </div>
            <Button variant="outline" onClick={applyFilters}>
              Apply
            </Button>
          </div>

          {error && <InlineError message={error} />}
          {rowError && <InlineError message={rowError} />}
          {rewards === null ? (
            error ? null : (
              <LoadingPanel label="Loading rewards" variant="table" />
            )
          ) : rewards.length === 0 ? (
            <EmptyState
              icon={<Gift aria-hidden="true" />}
              title="No rewards yet"
              body="Issue a reward for a qualified attribution and it will appear here."
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reward</TableHead>
                    <TableHead>Attribution</TableHead>
                    <TableHead>Referrer</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Issued</TableHead>
                    <TableHead>Revoked</TableHead>
                    <TableHead>Note</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rewards.map((reward) => (
                    <TableRow key={reward.id}>
                      <TableCell className="font-mono text-xs">{reward.id}</TableCell>
                      <TableCell className="font-mono text-xs">{reward.attributionId}</TableCell>
                      <TableCell className="font-mono text-xs">{reward.referrerUserId}</TableCell>
                      <TableCell>{reward.type}</TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(reward.status)}>{reward.status}</Badge>
                      </TableCell>
                      <TableCell>{formatAmount(reward.amountCents)}</TableCell>
                      <TableCell>{formatDate(reward.issuedAt)}</TableCell>
                      <TableCell>{formatDate(reward.revokedAt)}</TableCell>
                      <TableCell className="text-muted-foreground max-w-40 truncate text-xs">
                        {reward.reason || "—"}
                      </TableCell>
                      <TableCell>
                        {reward.status !== "revoked" && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={revokingId === reward.id}
                            onClick={() => void revoke(reward)}
                          >
                            {revokingId === reward.id ? "Revoking…" : "Revoke"}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {total > rewards.length && (
                <p className="text-muted-foreground mt-3 text-xs">
                  Showing the {rewards.length} most recent of {total} rewards.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
