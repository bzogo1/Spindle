"use client"

import { useCallback, useEffect, useState } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { BarChart3 } from "lucide-react"

import { EmptyState } from "@/components/app/states/empty-state"
import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

/**
 * Admin "Referral analytics" screen for `/app/admin/referral-analytics`:
 * program-level health score, signup cohorts, referrer leaderboard,
 * reward-economics estimates, and fraud exposure — backed by
 * `GET /api/admin/referral-analytics?period=&granularity=`.
 *
 * Complements (does not duplicate) the sibling screens:
 *  - `/app/admin/referral-program` — settings + raw attribution list
 *  - `/app/admin/referral-fraud` — rule-engine review queue
 *
 * The store is the in-memory dev seam in `src/lib/referral-program.ts`, so
 * these numbers cover only records currently retained on this instance.
 * `rewardAmountCents` economics are estimates — there are no real payouts.
 */

const API = "/api/admin/referral-analytics"

type Period = "7d" | "30d" | "90d" | "all"
type Granularity = "week" | "month"

interface HealthComponents {
  activation: number | null
  qualification: number | null
  reward: number | null
  fraudFree: number | null
}

interface ReferralCohortRow {
  key: string
  start: string
  total: number
  bound: number
  pending: number
  qualified: number
  rewarded: number
  rejected: number
  fraudFlagged: number
  qualificationRate: number | null
  rewardRate: number | null
}

interface LeaderboardRow {
  referrerUserId: string
  code: string | null
  clicks: number
  bound: number
  pending: number
  qualified: number
  rewarded: number
  rejected: number
  fraudFlagged: number
  conversionRate: number | null
}

interface AnalyticsResponse {
  ok: boolean
  generatedAt?: string
  period?: { days: number | null; from: string | null }
  settings?: {
    enabled: boolean
    rewardLabel: string
    rewardAmountCents: number | null
    maxRewardsPerUser: number
    windowDays: number
  }
  totals?: {
    attributions: number
    bound: number
    pending: number
    qualified: number
    rewarded: number
    rejected: number
    fraudFlagged: number
    codes: number
  }
  health?: {
    score: number
    hasData: boolean
    components: HealthComponents
    weights: Record<string, number>
  }
  cohorts?: ReferralCohortRow[]
  leaderboard?: LeaderboardRow[]
  economics?: {
    rewardLabel: string
    rewardAmountCents: number | null
    pending: number
    qualified: number
    rewarded: number
    rejected: number
    estimatedLiabilityCents: number | null
    grantedCents: number | null
  }
  fraud?: {
    flaggedTotal: number
    flaggedRate: number | null
    flaggedPending: number
    flaggedQualified: number
    flaggedRewarded: number
    flaggedRejected: number
    flaggedRewardedCount: number
    flaggedRewardedCents: number | null
    reviewQueue: {
      pending: number
      cleared: number
      confirmedFraud: number
      total: number
    }
  }
  message?: string
}

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "all", label: "All" },
]

const GRANULARITY_OPTIONS: { value: Granularity; label: string }[] = [
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
]

const COMPONENT_LABELS: { key: keyof HealthComponents; label: string }[] = [
  { key: "activation", label: "Activation (bound share)" },
  { key: "qualification", label: "Qualification (of decided)" },
  { key: "reward", label: "Reward rate (of qualified)" },
  { key: "fraudFree", label: "Fraud-free share" },
]

const CHART_AXIS_TICK = { fontSize: 11, fill: "var(--app-text-muted)" } as const

const CHART_TOOLTIP_STYLE = {
  background: "var(--app-panel)",
  border: "1px solid var(--app-border)",
  borderRadius: 8,
  color: "var(--app-text)",
  fontSize: 12,
} as const

function formatCents(cents: number | null): string {
  if (cents === null) return "—"
  return `$${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function formatRate(rate: number | null): string {
  if (rate === null) return "—"
  return `${rate}%`
}

function healthColor(score: number): string {
  if (score >= 70) return "var(--app-accent)"
  if (score >= 40) return "#d97706"
  return "var(--destructive, #dc2626)"
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-muted-foreground text-xs">{label}</div>
      {hint ? <div className="text-muted-foreground mt-0.5 text-[11px]">{hint}</div> : null}
    </div>
  )
}

export function ReferralAnalyticsScreen() {
  const [period, setPeriod] = useState<Period>("all")
  const [granularity, setGranularity] = useState<Granularity>("month")
  const [data, setData] = useState<AnalyticsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (period !== "all") params.set("period", period)
      params.set("granularity", granularity)
      const response = await fetch(`${API}?${params.toString()}`, { cache: "no-store" })
      const body = (await response.json()) as AnalyticsResponse
      if (!response.ok || !body.ok) {
        setError(body.message ?? "Could not load referral analytics.")
        setData(null)
        return
      }
      setData(body)
    } catch {
      setError("Could not load referral analytics.")
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [period, granularity])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  const totals = data?.totals
  const health = data?.health
  const cohorts = data?.cohorts ?? []
  const leaderboard = data?.leaderboard ?? []
  const economics = data?.economics
  const fraud = data?.fraud
  const isEmpty = totals !== undefined && totals.attributions === 0

  const cohortChartData = cohorts.map((cohort) => ({
    key: cohort.key,
    signups: cohort.total,
    converted: cohort.qualified + cohort.rewarded,
  }))

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="text-muted-foreground size-4" aria-hidden="true" />
            How these numbers work
          </CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          <p>
            Program-level analytics over the referral attribution store: a composite{" "}
            <strong className="text-foreground">health score</strong> (activation, qualification,
            reward, and fraud-free rates, weighted 20/30/20/30), signup{" "}
            <strong className="text-foreground">cohorts</strong>, a referrer{" "}
            <strong className="text-foreground">leaderboard</strong>, estimated reward{" "}
            <strong className="text-foreground">liability</strong>, and fraud exposure. An empty
            store reports a neutral score of 50.
          </p>
          <p className="mt-2 text-xs">
            Computed live from the in-memory dev-seam store — per-instance, bounded, and lost on
            restart. Reward amounts are reporting estimates only; there are no real payouts.
            {data?.generatedAt ? ` Generated ${new Date(data.generatedAt).toLocaleString()}.` : ""}
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">Period</span>
          <div className="app-toolbar" role="group" aria-label="Analytics period">
            {PERIOD_OPTIONS.map((option) => (
              <Button
                key={option.value}
                type="button"
                size="xs"
                variant={period === option.value ? "secondary" : "outline"}
                aria-pressed={period === option.value}
                onClick={() => setPeriod(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">Cohort bucket</span>
          <div className="app-toolbar" role="group" aria-label="Cohort granularity">
            {GRANULARITY_OPTIONS.map((option) => (
              <Button
                key={option.value}
                type="button"
                size="xs"
                variant={granularity === option.value ? "secondary" : "outline"}
                aria-pressed={granularity === option.value}
                onClick={() => setGranularity(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setLoading(true)
            setReloadKey((key) => key + 1)
          }}
          disabled={loading}
        >
          Refresh
        </Button>
      </div>

      {loading && data === null ? (
        <LoadingPanel label="Computing referral analytics" variant="panel" />
      ) : error ? (
        <InlineError
          message={error}
          action={
            <Button variant="outline" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          }
        />
      ) : data === null ? null : isEmpty ? (
        <EmptyState
          icon={<BarChart3 aria-hidden="true" />}
          title="No referral activity yet"
          body="Analytics appear here once referral clicks and signups are recorded. Adjust the period or check back after the program has been live."
        />
      ) : (
        <>
          {/* Health score */}
          <Card>
            <CardHeader>
              <CardTitle>Program health</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-[auto_1fr]">
              <div className="flex flex-col items-center justify-center gap-1 px-4">
                <div
                  className="text-5xl font-semibold tabular-nums"
                  style={{ color: healthColor(health?.score ?? 0) }}
                >
                  {health?.score ?? "—"}
                </div>
                <div className="text-muted-foreground text-xs">
                  / 100{health && !health.hasData ? " · neutral (no data)" : ""}
                </div>
                <div
                  className="mt-2 h-2 w-40 overflow-hidden rounded-full"
                  style={{ background: "var(--app-border)" }}
                  role="progressbar"
                  aria-valuenow={health?.score ?? 0}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Program health score"
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${health?.score ?? 0}%`,
                      background: healthColor(health?.score ?? 0),
                    }}
                  />
                </div>
              </div>
              <ul className="grid gap-2 sm:grid-cols-2">
                {COMPONENT_LABELS.map(({ key, label }) => {
                  const value = health?.components[key] ?? null
                  return (
                    <li key={key} className="grid gap-1">
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="text-muted-foreground">{label}</span>
                        <strong className="tabular-nums">{formatRate(value)}</strong>
                      </div>
                      <div
                        className="h-1.5 overflow-hidden rounded-full"
                        style={{ background: "var(--app-border)" }}
                        aria-hidden="true"
                      >
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${value ?? 0}%`,
                            background: healthColor(value ?? 0),
                          }}
                        />
                      </div>
                    </li>
                  )
                })}
              </ul>
            </CardContent>
          </Card>

          {/* Totals */}
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}
          >
            <StatCard label="Attributions" value={(totals?.attributions ?? 0).toLocaleString()} />
            <StatCard label="Bound to users" value={(totals?.bound ?? 0).toLocaleString()} />
            <StatCard label="Pending" value={(totals?.pending ?? 0).toLocaleString()} />
            <StatCard label="Qualified" value={(totals?.qualified ?? 0).toLocaleString()} />
            <StatCard label="Rewarded" value={(totals?.rewarded ?? 0).toLocaleString()} />
            <StatCard label="Rejected" value={(totals?.rejected ?? 0).toLocaleString()} />
            <StatCard label="Fraud flagged" value={(totals?.fraudFlagged ?? 0).toLocaleString()} />
            <StatCard label="Codes issued" value={(totals?.codes ?? 0).toLocaleString()} />
          </div>

          {/* Cohorts */}
          <Card>
            <CardHeader>
              <CardTitle>Cohorts ({granularity === "week" ? "ISO week" : "month"})</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              {cohortChartData.length > 0 ? (
                <div className="app-usage-chart-plot" style={{ height: 220 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={cohortChartData}
                      margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                    >
                      <CartesianGrid stroke="var(--app-border)" vertical={false} />
                      <XAxis
                        dataKey="key"
                        tick={CHART_AXIS_TICK}
                        tickLine={false}
                        axisLine={false}
                        interval="equidistantPreserveStart"
                        minTickGap={24}
                      />
                      <YAxis
                        tick={CHART_AXIS_TICK}
                        tickLine={false}
                        axisLine={false}
                        width={32}
                        allowDecimals={false}
                      />
                      <Tooltip
                        contentStyle={CHART_TOOLTIP_STYLE}
                        formatter={(value, name) => [
                          Number(value).toLocaleString(),
                          name === "signups" ? "Signups" : "Qualified + rewarded",
                        ]}
                      />
                      <Legend
                        formatter={(value) =>
                          value === "signups" ? "Signups" : "Qualified + rewarded"
                        }
                      />
                      <Bar
                        dataKey="signups"
                        name="signups"
                        fill="var(--app-accent)"
                        fillOpacity={0.85}
                        radius={[3, 3, 0, 0]}
                      />
                      <Bar
                        dataKey="converted"
                        name="converted"
                        fill="#16a34a"
                        fillOpacity={0.85}
                        radius={[3, 3, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : null}
              {cohorts.length === 0 ? (
                <p className="text-muted-foreground m-0 text-sm">No cohorts in this period.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cohort</TableHead>
                      <TableHead className="text-right">Signups</TableHead>
                      <TableHead className="text-right">Bound</TableHead>
                      <TableHead className="text-right">Pending</TableHead>
                      <TableHead className="text-right">Qualified</TableHead>
                      <TableHead className="text-right">Rewarded</TableHead>
                      <TableHead className="text-right">Rejected</TableHead>
                      <TableHead className="text-right">Qual. rate</TableHead>
                      <TableHead className="text-right">Reward rate</TableHead>
                      <TableHead className="text-right">Fraud</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...cohorts].reverse().map((cohort) => (
                      <TableRow key={cohort.key}>
                        <TableCell className="font-mono text-xs">{cohort.key}</TableCell>
                        <TableCell className="text-right tabular-nums">{cohort.total}</TableCell>
                        <TableCell className="text-right tabular-nums">{cohort.bound}</TableCell>
                        <TableCell className="text-right tabular-nums">{cohort.pending}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {cohort.qualified}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{cohort.rewarded}</TableCell>
                        <TableCell className="text-right tabular-nums">{cohort.rejected}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatRate(cohort.qualificationRate)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatRate(cohort.rewardRate)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {cohort.fraudFlagged > 0 ? (
                            <Badge variant="destructive" size="sm">
                              {cohort.fraudFlagged}
                            </Badge>
                          ) : (
                            "0"
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Leaderboard + economics + fraud */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Referrer leaderboard</CardTitle>
              </CardHeader>
              <CardContent>
                {leaderboard.length === 0 ? (
                  <p className="text-muted-foreground m-0 text-sm">No referrers yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Referrer</TableHead>
                        <TableHead className="text-right">Clicks</TableHead>
                        <TableHead className="text-right">Qualified</TableHead>
                        <TableHead className="text-right">Rewarded</TableHead>
                        <TableHead className="text-right">Conv.</TableHead>
                        <TableHead className="text-right">Fraud</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {leaderboard.map((entry, index) => (
                        <TableRow key={entry.referrerUserId}>
                          <TableCell>
                            <div className="font-mono text-xs">{entry.referrerUserId}</div>
                            <div className="text-muted-foreground text-[11px]">
                              #{index + 1}
                              {entry.code ? ` · ${entry.code}` : ""}
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{entry.clicks}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {entry.qualified}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {entry.rewarded}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatRate(entry.conversionRate)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {entry.fraudFlagged > 0 ? (
                              <Badge variant="destructive" size="sm">
                                {entry.fraudFlagged}
                              </Badge>
                            ) : (
                              "0"
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <div className="grid gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Reward economics</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <p className="text-muted-foreground m-0 text-sm">
                    Reward:{" "}
                    <strong className="text-foreground">{economics?.rewardLabel ?? "—"}</strong>
                    {economics?.rewardAmountCents != null
                      ? ` · ${formatCents(economics.rewardAmountCents)} each`
                      : " · no monetary value set"}
                  </p>
                  <div
                    className="grid gap-3"
                    style={{ gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}
                  >
                    <StatCard
                      label="Est. liability"
                      value={formatCents(economics?.estimatedLiabilityCents ?? null)}
                      hint="pending + qualified"
                    />
                    <StatCard
                      label="Granted estimate"
                      value={formatCents(economics?.grantedCents ?? null)}
                      hint="rewarded count"
                    />
                    <StatCard
                      label="Outstanding"
                      value={(
                        (economics?.pending ?? 0) + (economics?.qualified ?? 0)
                      ).toLocaleString()}
                      hint="may still convert"
                    />
                  </div>
                  <p className="text-muted-foreground m-0 text-xs">
                    Estimates only — pending and qualified attributions may still convert to
                    rewards. No money moves; rewards are conceptual marks in the dev-seam store.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Fraud exposure</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <div
                    className="grid gap-3"
                    style={{ gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}
                  >
                    <StatCard
                      label="Flagged attributions"
                      value={(fraud?.flaggedTotal ?? 0).toLocaleString()}
                      hint={formatRate(fraud?.flaggedRate ?? null) + " of total"}
                    />
                    <StatCard
                      label="Flagged & rewarded"
                      value={(fraud?.flaggedRewardedCount ?? 0).toLocaleString()}
                      hint={formatCents(fraud?.flaggedRewardedCents ?? null) + " exposure"}
                    />
                    <StatCard
                      label="Review queue"
                      value={(fraud?.reviewQueue.total ?? 0).toLocaleString()}
                      hint={`${fraud?.reviewQueue.pending ?? 0} pending · ${fraud?.reviewQueue.confirmedFraud ?? 0} confirmed`}
                    />
                  </div>
                  <ul className="text-muted-foreground m-0 grid list-none gap-1 p-0 text-xs">
                    <li>
                      Flagged by status — pending {fraud?.flaggedPending ?? 0}, qualified{" "}
                      {fraud?.flaggedQualified ?? 0}, rewarded {fraud?.flaggedRewarded ?? 0},
                      rejected {fraud?.flaggedRejected ?? 0}.
                    </li>
                    <li>
                      The review queue is the separate rule-engine store from the Referral fraud
                      screen; flagged attributions above carry the per-record fraud mark.
                    </li>
                  </ul>
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default ReferralAnalyticsScreen
