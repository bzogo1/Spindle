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
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

/**
 * Admin "Referral program" screen for `/app/admin/referral-program`:
 * program settings form (enabled toggle, reward label/amount, per-user
 * reward cap, attribution window) plus program-wide stats and the recent
 * attribution list. Backed by `GET|PATCH /api/admin/referral-program`.
 *
 * The store is the in-memory dev seam in `src/lib/referral-program.ts`;
 * `rewardAmountCents` is reporting metadata only — there are no real
 * payouts.
 */

const API = "/api/admin/referral-program"

export interface ReferralProgramSettingsView {
  enabled: boolean
  rewardLabel: string
  rewardAmountCents: number | null
  maxRewardsPerUser: number
  windowDays: number
}

export interface ReferralAttributionRow {
  id: string
  code: string
  referrerUserId: string
  referredUserId: string | null
  status: "pending" | "qualified" | "rewarded" | "rejected"
  source: string
  createdAt: string
  qualifiedAt?: string
  rewardedAt?: string
  rejectedReason?: string
  fraudFlagged?: boolean
}

interface ProgramStatsView {
  clicks: number
  pending: number
  qualified: number
  rewarded: number
  rejected: number
  fraudFlagged: number
  codes: number
  totals: ProgramStatsView & { codes: number }
}

interface ProgramResponse {
  ok: boolean
  settings?: ReferralProgramSettingsView
  stats?: ProgramStatsView
  attributions?: ReferralAttributionRow[]
  total?: number
  message?: string
}

interface SettingsDraft {
  enabled: boolean
  rewardLabel: string
  /** Dollars as typed; empty string means "no monetary value" (null cents). */
  rewardAmount: string
  maxRewardsPerUser: string
  windowDays: string
}

function centsToDollars(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2)
}

function draftFromSettings(settings: ReferralProgramSettingsView): SettingsDraft {
  return {
    enabled: settings.enabled,
    rewardLabel: settings.rewardLabel,
    rewardAmount: centsToDollars(settings.rewardAmountCents),
    maxRewardsPerUser: String(settings.maxRewardsPerUser),
    windowDays: String(settings.windowDays),
  }
}

function statusBadgeVariant(status: ReferralAttributionRow["status"]) {
  switch (status) {
    case "rewarded":
      return "secondary" as const
    case "qualified":
      return "default" as const
    case "pending":
      return "outline" as const
    case "rejected":
      return "destructive" as const
  }
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-2xl font-semibold">{value.toLocaleString()}</div>
      <div className="text-muted-foreground text-xs">{label}</div>
    </div>
  )
}

export function ReferralProgramScreen() {
  const [settings, setSettings] = useState<ReferralProgramSettingsView | null>(null)
  const [stats, setStats] = useState<ProgramStatsView | null>(null)
  const [attributions, setAttributions] = useState<ReferralAttributionRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [draft, setDraft] = useState<SettingsDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [formNotice, setFormNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch(API, { cache: "no-store" })
      const data = (await response.json()) as ProgramResponse
      if (!response.ok || !data.ok || !data.settings) {
        setError(data.message ?? "Could not load the referral program.")
        return
      }
      setError(null)
      setSettings(data.settings)
      setStats(data.stats ?? null)
      setAttributions(data.attributions ?? [])
      setTotal(data.total ?? 0)
      setDraft((current) => current ?? draftFromSettings(data.settings!))
    } catch {
      setError("Could not load the referral program.")
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  const amountValid =
    draft !== null &&
    (draft.rewardAmount.trim() === "" ||
      (Number.isFinite(Number(draft.rewardAmount)) && Number(draft.rewardAmount) >= 0))
  const numbersValid =
    draft !== null &&
    Number.isInteger(Number(draft.maxRewardsPerUser)) &&
    Number(draft.maxRewardsPerUser) >= 1 &&
    Number.isInteger(Number(draft.windowDays)) &&
    Number(draft.windowDays) >= 1

  const save = async () => {
    if (!draft) return
    setSaving(true)
    setFormError(null)
    setFormNotice(null)
    try {
      const amount = draft.rewardAmount.trim()
      const response = await fetch(API, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enabled: draft.enabled,
          rewardLabel: draft.rewardLabel.trim(),
          rewardAmountCents: amount === "" ? null : Math.round(Number(amount) * 100),
          maxRewardsPerUser: Number(draft.maxRewardsPerUser),
          windowDays: Number(draft.windowDays),
        }),
      })
      const data = (await response.json()) as ProgramResponse
      if (!response.ok || !data.ok || !data.settings) {
        setFormError(data.message ?? "Could not save settings.")
        return
      }
      setSettings(data.settings)
      setDraft(draftFromSettings(data.settings))
      setFormNotice("Settings saved.")
      setReloadKey((key) => key + 1)
    } catch {
      setFormError("Could not save settings.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Program settings</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {error && <InlineError message={error} />}
          {settings === null || draft === null ? (
            <LoadingPanel label="Loading referral program settings" variant="panel" />
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Switch
                  id="rp-enabled"
                  checked={draft.enabled}
                  onCheckedChange={(checked) => setDraft({ ...draft, enabled: checked })}
                />
                <Label htmlFor="rp-enabled">Program enabled</Label>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="rp-reward-label">Reward label</Label>
                  <Input
                    id="rp-reward-label"
                    value={draft.rewardLabel}
                    onChange={(event) => setDraft({ ...draft, rewardLabel: event.target.value })}
                    placeholder="A free month of Spindle Pro"
                    maxLength={200}
                  />
                  <p className="text-muted-foreground text-xs">
                    Shown to users as what a qualified referral earns. Reporting only — no real
                    payouts.
                  </p>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="rp-reward-amount">Reward amount (USD, optional)</Label>
                  <Input
                    id="rp-reward-amount"
                    type="number"
                    min={0}
                    step="0.01"
                    value={draft.rewardAmount}
                    onChange={(event) => setDraft({ ...draft, rewardAmount: event.target.value })}
                    placeholder="e.g. 10.00"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="rp-max-rewards">Max rewards per user</Label>
                  <Input
                    id="rp-max-rewards"
                    type="number"
                    min={1}
                    value={draft.maxRewardsPerUser}
                    onChange={(event) =>
                      setDraft({ ...draft, maxRewardsPerUser: event.target.value })
                    }
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="rp-window-days">Attribution window (days)</Label>
                  <Input
                    id="rp-window-days"
                    type="number"
                    min={1}
                    value={draft.windowDays}
                    onChange={(event) => setDraft({ ...draft, windowDays: event.target.value })}
                  />
                </div>
              </div>
              {!amountValid && (
                <p className="text-destructive text-sm">
                  Reward amount must be a non-negative number.
                </p>
              )}
              {!numbersValid && (
                <p className="text-destructive text-sm">
                  Max rewards and window days must be positive integers.
                </p>
              )}
              {formError && <InlineError message={formError} />}
              {formNotice && <p className="text-muted-foreground text-sm">{formNotice}</p>}
              <div>
                <Button
                  onClick={() => void save()}
                  disabled={saving || !amountValid || !numbersValid || !draft.rewardLabel.trim()}
                >
                  Save settings
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Program stats</CardTitle>
        </CardHeader>
        <CardContent>
          {stats === null ? (
            <LoadingPanel label="Loading stats" variant="table" />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              <StatCard label="Codes" value={stats.totals.codes} />
              <StatCard label="Clicks" value={stats.totals.clicks} />
              <StatCard label="Pending" value={stats.totals.pending} />
              <StatCard label="Qualified" value={stats.totals.qualified} />
              <StatCard label="Rewarded" value={stats.totals.rewarded} />
              <StatCard label="Rejected" value={stats.totals.rejected} />
              <StatCard label="Fraud flagged" value={stats.totals.fraudFlagged} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent attributions</CardTitle>
        </CardHeader>
        <CardContent>
          {attributions === null ? (
            <LoadingPanel label="Loading attributions" variant="table" />
          ) : attributions.length === 0 ? (
            <EmptyState
              icon={<Gift aria-hidden="true" />}
              title="No attributions yet"
              body="Clicks and signups recorded through referral codes will appear here."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Referrer</TableHead>
                  <TableHead>Referred</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attributions.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">{row.code}</TableCell>
                    <TableCell className="font-mono text-xs">{row.referrerUserId}</TableCell>
                    <TableCell className="font-mono text-xs">{row.referredUserId ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Badge variant={statusBadgeVariant(row.status)}>{row.status}</Badge>
                        {row.fraudFlagged && <Badge variant="destructive">fraud</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>{row.source}</TableCell>
                    <TableCell>{formatDate(row.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {attributions !== null && attributions.length > 0 && total > attributions.length && (
            <p className="text-muted-foreground mt-3 text-xs">
              Showing the {attributions.length} most recent of {total} attributions.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
