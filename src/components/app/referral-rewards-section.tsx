"use client"

import { useCallback, useEffect, useState } from "react"
import { Gift } from "lucide-react"

import { EmptyState } from "@/components/app/states/empty-state"
import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

/**
 * "Your rewards" section for `/app/referral/rewards`: the caller's own
 * reward ledger from `GET /api/referral/rewards`, newest first.
 *
 * Rewards are reporting records only — the program's `rewardLabel`
 * describes what a qualified referral earns conceptually; no credits or
 * payouts are issued (see `src/lib/referral-rewards.ts`).
 */

const API = "/api/referral/rewards"

export interface ReferralRewardView {
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

interface RewardsResponse {
  ok: boolean
  rewards?: ReferralRewardView[]
  total?: number
  rewardLabel?: string
  message?: string
}

const TYPE_LABELS: Record<ReferralRewardView["type"], string> = {
  credit: "Credit",
  badge: "Badge",
  trial_extension: "Trial extension",
}

function statusBadgeVariant(status: ReferralRewardView["status"]) {
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

export function ReferralRewardsSection() {
  const [rewards, setRewards] = useState<ReferralRewardView[] | null>(null)
  const [total, setTotal] = useState(0)
  const [rewardLabel, setRewardLabel] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [unauthenticated, setUnauthenticated] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const load = useCallback(async () => {
    setError(null)
    try {
      const response = await fetch(API, { cache: "no-store" })
      const data = (await response.json()) as RewardsResponse
      if (response.status === 401) {
        setUnauthenticated(true)
        setRewards([])
        return
      }
      if (!response.ok || !data.ok) {
        setError(data.message ?? "Could not load your rewards.")
        return
      }
      setUnauthenticated(false)
      setRewards(data.rewards ?? [])
      setTotal(data.total ?? 0)
      setRewardLabel(data.rewardLabel ?? null)
    } catch {
      setError("Could not load your rewards.")
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gift aria-hidden="true" className="size-5" />
          Your rewards
        </CardTitle>
        <CardDescription>
          {rewardLabel ??
            "Rewards earned from qualified referrals. Reporting only — no payout is issued."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && <InlineError message={error} />}
        {rewards === null && !error && (
          <LoadingPanel label="Loading your rewards" variant="table" />
        )}
        {rewards !== null && unauthenticated && (
          <p className="text-muted-foreground text-sm">
            Sign in to view the rewards you have earned.
          </p>
        )}
        {rewards !== null && !unauthenticated && rewards.length === 0 && !error && (
          <EmptyState
            icon={<Gift aria-hidden="true" />}
            title="No rewards yet"
            body="When a referral you made qualifies, the reward appears here."
          />
        )}
        {rewards !== null && !unauthenticated && rewards.length > 0 && (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead>Revoked</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rewards.map((reward) => (
                  <TableRow key={reward.id}>
                    <TableCell>{TYPE_LABELS[reward.type]}</TableCell>
                    <TableCell>
                      <Badge variant={statusBadgeVariant(reward.status)}>{reward.status}</Badge>
                    </TableCell>
                    <TableCell>{formatAmount(reward.amountCents)}</TableCell>
                    <TableCell>{formatDate(reward.issuedAt)}</TableCell>
                    <TableCell>{formatDate(reward.revokedAt)}</TableCell>
                    <TableCell className="text-muted-foreground max-w-48 truncate text-xs">
                      {reward.reason || "—"}
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
            <div className="mt-3">
              <button
                type="button"
                className="text-muted-foreground text-xs underline-offset-2 hover:underline"
                onClick={() => setReloadKey((key) => key + 1)}
              >
                Refresh
              </button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
