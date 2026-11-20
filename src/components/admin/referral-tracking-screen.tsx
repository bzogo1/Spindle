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
import { Filter } from "lucide-react"

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
 * Admin "Referral tracking" screen for `/app/admin/referral-tracking`:
 * funnel counts and conversion rates, per-source / per-code breakdowns,
 * top referrers, and a daily attribution series — backed by
 * `GET /api/admin/referral-tracking?days=`.
 *
 * Complements (does not duplicate) the sibling screens:
 *  - `/app/admin/referral-program` — settings + raw attribution list
 *  - `/app/admin/referral-analytics` — health score, cohorts,
 *    leaderboard, economics
 *  - `/app/admin/referral-fraud` — review queue
 *
 * The store is the in-memory dev seam in `src/lib/referral-program.ts`, so
 * these numbers cover only records currently retained on this instance.
 */

const API = "/api/admin/referral-tracking"

type AttributionStatus = "pending" | "qualified" | "rewarded" | "rejected"
type AttributionSource = "click" | "signup" | "manual"

interface FunnelCounts {
  clicks: number
  pending: number
  qualified: number
  rewarded: number
  rejected: number
  fraudFlagged: number
}

interface FunnelRates {
  pending: number
  qualified: number
  rewarded: number
  rejected: number
  qualifiedOrRewarded: number
  rewardedOfQualified: number
}

interface BreakdownCounts {
  total: number
  pending: number
  qualified: number
  rewarded: number
  rejected: number
  fraudFlagged: number
}

interface CodeBreakdownEntry extends BreakdownCounts {
  code: string
}

interface SourceBreakdownEntry extends BreakdownCounts {
  source: AttributionSource
}

interface ReferrerBreakdownEntry extends BreakdownCounts {
  referrerUserId: string
}

interface DailyPoint {
  date: string
  clicks: number
  pending: number
  qualified: number
  rewarded: number
  rejected: number
  fraudFlagged: number
}

interface TrackingResponse {
  ok: boolean
  days?: number
  generatedAt?: string
  funnel?: {
    counts: FunnelCounts
    rates: FunnelRates
  }
  byCode?: CodeBreakdownEntry[]
  bySource?: SourceBreakdownEntry[]
  topReferrers?: ReferrerBreakdownEntry[]
  daily?: DailyPoint[]
  message?: string
}

const DAY_OPTIONS: { value: number; label: string }[] = [
  { value: 7, label: "7d" },
  { value: 30, label: "30d" },
  { value: 90, label: "90d" },
]

const STATUS_ORDER: AttributionStatus[] = ["pending", "qualified", "rewarded", "rejected"]

const STATUS_LABELS: Record<AttributionStatus, string> = {
  pending: "Pending",
  qualified: "Qualified",
  rewarded: "Rewarded",
  rejected: "Rejected",
}

const STATUS_COLORS: Record<AttributionStatus, string> = {
  pending: "#d97706",
  qualified: "var(--app-accent)",
  rewarded: "#16a34a",
  rejected: "var(--destructive, #dc2626)",
}

const CHART_AXIS_TICK = { fontSize: 11, fill: "var(--app-text-muted)" } as const

const CHART_TOOLTIP_STYLE = {
  background: "var(--app-panel)",
  border: "1px solid var(--app-border)",
  borderRadius: 8,
  color: "var(--app-text)",
  fontSize: 12,
} as const

function formatRate(rate: number | undefined): string {
  if (rate === undefined || rate === null) return "—"
  return `${(rate * 100).toFixed(1)}%`
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-muted-foreground text-xs">{label}</div>
      {hint ? <div className="text-muted-foreground mt-0.5 text-[11px]">{hint}</div> : null}
    </div>
  )
}

export function ReferralTrackingScreen() {
  const [days, setDays] = useState(30)
  const [data, setData] = useState<TrackingResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`${API}?days=${days}`, { cache: "no-store" })
      const body = (await response.json()) as TrackingResponse
      if (!response.ok || !body.ok) {
        setError(body.message ?? "Could not load referral tracking analytics.")
        setData(null)
        return
      }
      setData(body)
    } catch {
      setError("Could not load referral tracking analytics.")
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  const funnel = data?.funnel
  const counts = funnel?.counts
  const rates = funnel?.rates
  const bySource = data?.bySource ?? []
  const byCode = data?.byCode ?? []
  const topReferrers = data?.topReferrers ?? []
  const daily = data?.daily ?? []
  const isEmpty = counts !== undefined && counts.clicks === 0

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Filter className="text-muted-foreground size-4" aria-hidden="true" />
            How these numbers work
          </CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          <p>
            Funnel-style tracking over the referral attribution store: every record begins as a{" "}
            <strong className="text-foreground">click</strong> and currently sits in exactly one
            status — pending, qualified, rewarded, or rejected — with a{" "}
            <strong className="text-foreground">fraud flag</strong> that can apply to any status.
            Conversion rates are fractions of total clicks unless noted otherwise.
          </p>
          <p className="mt-2 text-xs">
            Computed live from the in-memory dev-seam store — per-instance, bounded, and lost on
            restart. The daily series buckets records by creation day (UTC) and reports their{" "}
            <em>current</em> status.{" "}
            {data?.generatedAt ? `Generated ${new Date(data.generatedAt).toLocaleString()}.` : ""}
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">Daily series window</span>
          <div className="app-toolbar" role="group" aria-label="Tracking window">
            {DAY_OPTIONS.map((option) => (
              <Button
                key={option.value}
                type="button"
                size="xs"
                variant={days === option.value ? "secondary" : "outline"}
                aria-pressed={days === option.value}
                onClick={() => setDays(option.value)}
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
        <LoadingPanel label="Computing referral tracking" variant="panel" />
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
          icon={<Filter aria-hidden="true" />}
          title="No referral activity yet"
          body="Tracking metrics appear here once referral clicks and signups are recorded. Check back after the program has been live."
        />
      ) : (
        <>
          {/* Totals + conversion rates */}
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}
          >
            <StatCard
              label="Clicks"
              value={(counts?.clicks ?? 0).toLocaleString()}
              hint={`${counts?.fraudFlagged ?? 0} fraud flagged`}
            />
            <StatCard label="Pending" value={(counts?.pending ?? 0).toLocaleString()} />
            <StatCard label="Qualified" value={(counts?.qualified ?? 0).toLocaleString()} />
            <StatCard label="Rewarded" value={(counts?.rewarded ?? 0).toLocaleString()} />
            <StatCard label="Rejected" value={(counts?.rejected ?? 0).toLocaleString()} />
            <StatCard
              label="Qualified or rewarded"
              value={formatRate(rates?.qualifiedOrRewarded)}
              hint="of clicks"
            />
            <StatCard
              label="Rewarded of qualified"
              value={formatRate(rates?.rewardedOfQualified)}
              hint="payout completion"
            />
          </div>

          {/* Funnel */}
          <Card>
            <CardHeader>
              <CardTitle>Funnel</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <ul className="grid list-none gap-2 p-0">
                {STATUS_ORDER.map((status) => {
                  const count = counts?.[status] ?? 0
                  const rate = rates?.[status] ?? 0
                  return (
                    <li key={status} className="grid gap-1">
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="flex items-center gap-2">
                          <span
                            className="inline-block size-2.5 rounded-sm"
                            style={{ background: STATUS_COLORS[status] }}
                            aria-hidden="true"
                          />
                          {STATUS_LABELS[status]}
                        </span>
                        <strong className="tabular-nums">
                          {count.toLocaleString()}
                          <span className="text-muted-foreground ml-2 font-normal">
                            {formatRate(rate)} of clicks
                          </span>
                        </strong>
                      </div>
                      <div
                        className="h-2 overflow-hidden rounded-full"
                        style={{ background: "var(--app-border)" }}
                        role="progressbar"
                        aria-valuenow={count}
                        aria-valuemin={0}
                        aria-valuemax={counts?.clicks ?? 0}
                        aria-label={`${STATUS_LABELS[status]} funnel stage`}
                      >
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${(counts?.clicks ?? 0) > 0 ? (count / (counts?.clicks ?? 1)) * 100 : 0}%`,
                            background: STATUS_COLORS[status],
                          }}
                        />
                      </div>
                    </li>
                  )
                })}
              </ul>
              <p className="text-muted-foreground m-0 text-xs">
                Pending + qualified + rewarded + rejected = {counts?.clicks ?? 0} clicks.
              </p>
            </CardContent>
          </Card>

          {/* Daily series */}
          <Card>
            <CardHeader>
              <CardTitle>Daily attributions (last {data?.days ?? days} days, UTC)</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              {daily.some((point) => point.clicks > 0) ? (
                <div className="app-usage-chart-plot" style={{ height: 240 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={daily} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid stroke="var(--app-border)" vertical={false} />
                      <XAxis
                        dataKey="date"
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
                          STATUS_LABELS[name as AttributionStatus] ?? String(name),
                        ]}
                      />
                      <Legend
                        formatter={(value) =>
                          STATUS_LABELS[value as AttributionStatus] ?? String(value)
                        }
                      />
                      {STATUS_ORDER.map((status) => (
                        <Bar
                          key={status}
                          dataKey={status}
                          name={status}
                          stackId="status"
                          fill={STATUS_COLORS[status]}
                          fillOpacity={0.85}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-muted-foreground m-0 text-sm">
                  No attributions recorded in this window.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Per-source + top referrers */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>By source</CardTitle>
              </CardHeader>
              <CardContent>
                {bySource.length === 0 ? (
                  <p className="text-muted-foreground m-0 text-sm">No sources recorded.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Source</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-right">Pending</TableHead>
                        <TableHead className="text-right">Qualified</TableHead>
                        <TableHead className="text-right">Rewarded</TableHead>
                        <TableHead className="text-right">Rejected</TableHead>
                        <TableHead className="text-right">Fraud</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {bySource.map((entry) => (
                        <TableRow key={entry.source}>
                          <TableCell>
                            <Badge variant="outline" size="sm">
                              {entry.source}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {entry.total.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {entry.pending.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {entry.qualified.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {entry.rewarded.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {entry.rejected.toLocaleString()}
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

            <Card>
              <CardHeader>
                <CardTitle>Top referrers</CardTitle>
              </CardHeader>
              <CardContent>
                {topReferrers.length === 0 ? (
                  <p className="text-muted-foreground m-0 text-sm">No referrers yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Referrer</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-right">Qualified</TableHead>
                        <TableHead className="text-right">Rewarded</TableHead>
                        <TableHead className="text-right">Rejected</TableHead>
                        <TableHead className="text-right">Fraud</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {topReferrers.map((entry, index) => (
                        <TableRow key={entry.referrerUserId}>
                          <TableCell>
                            <div className="font-mono text-xs">{entry.referrerUserId}</div>
                            <div className="text-muted-foreground text-[11px]">#{index + 1}</div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {entry.total.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {entry.qualified.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {entry.rewarded.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {entry.rejected.toLocaleString()}
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
          </div>

          {/* Per-code breakdown */}
          <Card>
            <CardHeader>
              <CardTitle>By referral code</CardTitle>
            </CardHeader>
            <CardContent>
              {byCode.length === 0 ? (
                <p className="text-muted-foreground m-0 text-sm">No codes recorded.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Pending</TableHead>
                      <TableHead className="text-right">Qualified</TableHead>
                      <TableHead className="text-right">Rewarded</TableHead>
                      <TableHead className="text-right">Rejected</TableHead>
                      <TableHead className="text-right">Fraud</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {byCode.map((entry) => (
                      <TableRow key={entry.code}>
                        <TableCell className="font-mono text-xs">{entry.code}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {entry.total.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {entry.pending.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {entry.qualified.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {entry.rewarded.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {entry.rejected.toLocaleString()}
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
        </>
      )}
    </div>
  )
}

export default ReferralTrackingScreen
