"use client"

import { useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  computeExperimentSummaries,
  computeSearchInsightsSummary,
  type SearchInsightsSummary,
} from "@/lib/search-insights/analytics"
import { computeConversionRates, computeSearchFunnel } from "@/lib/search-insights/conversions"
import {
  computePerformanceStats,
  evaluatePerformance,
  type PerformanceStats,
} from "@/lib/search-insights/performance"
import { clearSearchEvents, readStoredEvents } from "@/lib/search-insights/store"
import type { SearchEvent } from "@/lib/search-insights/schema"

/**
 * Search analytics dashboard (tasks 37/49/50 reporting).
 *
 * Reads the localStorage event buffer written by the tracker in
 * `src/lib/search-insights` and renders totals, top queries, zero-result
 * rate, CTR, a daily trend (hand-rolled SVG bars — no chart lib), the
 * conversion funnel, per-language stats, experiment results, and a
 * performance panel with threshold warnings. All data is local; the
 * "Refresh" button re-reads storage (events recorded after mount show up
 * without a reload).
 */

const DAY_OPTIONS = [7, 30, 90] as const

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="app-stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <small>{hint}</small> : null}
    </div>
  )
}

/** Hand-rolled daily bar chart — queries per day as SVG rects. */
function TrendChart({ daily }: { daily: SearchInsightsSummary["daily"] }) {
  const width = 720
  const height = 160
  const pad = 8
  if (daily.length === 0) {
    return <p className="text-muted-foreground text-sm">No data in range.</p>
  }
  const max = Math.max(1, ...daily.map((point) => point.queries))
  const slot = (width - pad * 2) / daily.length
  const barWidth = Math.max(2, slot * 0.7)

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-40 w-full"
      role="img"
      aria-label="Searches per day"
      preserveAspectRatio="none"
    >
      {daily.map((point, index) => {
        const barHeight = (point.queries / max) * (height - pad * 2)
        const x = pad + index * slot + (slot - barWidth) / 2
        const y = height - pad - barHeight
        return (
          <g key={point.date}>
            <rect
              x={x}
              y={y}
              width={barWidth}
              height={Math.max(barHeight, point.queries > 0 ? 2 : 0)}
              rx={2}
              fill="var(--app-accent, #6366f1)"
              opacity={point.zeroResults > 0 ? 0.55 : 0.9}
            >
              <title>
                {point.date}: {point.queries} searches, {point.clicks} clicks, {point.zeroResults}{" "}
                zero-result
              </title>
            </rect>
            {index % Math.ceil(daily.length / 8) === 0 ? (
              <text
                x={x}
                y={height - 2}
                fontSize={10}
                fill="var(--app-text-muted, #888)"
                textAnchor="middle"
              >
                {point.date.slice(5)}
              </text>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}

function PerformancePanel({ stats }: { stats: PerformanceStats }) {
  const warnings = evaluatePerformance(stats)
  if (stats.samples === 0) {
    return <p className="text-muted-foreground text-sm">No performance samples yet.</p>
  }
  return (
    <div className="grid gap-3">
      <div className="app-stat-grid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
        <StatCard label="Latency p50" value={`${stats.p50LatencyMs.toFixed(0)}ms`} />
        <StatCard label="Latency p95" value={`${stats.p95LatencyMs.toFixed(0)}ms`} />
        <StatCard label="Latency mean" value={`${stats.meanLatencyMs.toFixed(0)}ms`} />
        <StatCard
          label="Cache hit rate"
          value={stats.cacheHits + stats.cacheMisses > 0 ? pct(stats.cacheHitRate) : "—"}
          hint={`${stats.cacheHits} hits / ${stats.cacheMisses} misses`}
        />
        <StatCard
          label="Index size (mean)"
          value={Math.round(stats.meanItemCount).toLocaleString()}
        />
        <StatCard label="Index size (max)" value={stats.maxItemCount.toLocaleString()} />
        <StatCard label="Samples" value={stats.samples.toLocaleString()} />
      </div>
      {warnings.length > 0 ? (
        <ul className="grid gap-1" aria-label="Performance warnings">
          {warnings.map((warning) => (
            <li
              key={warning.metric + warning.message}
              className="rounded-md border px-3 py-2 text-sm"
              style={{
                borderColor:
                  warning.level === "critical" ? "var(--app-danger, #ef4444)" : "var(--app-border)",
              }}
            >
              <strong>{warning.level === "critical" ? "Critical: " : "Warning: "}</strong>
              {warning.message}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">All performance metrics within budget.</p>
      )}
    </div>
  )
}

export function SearchInsightsDashboard() {
  const [days, setDays] = useState<number>(30)
  const [tick, setTick] = useState(0)
  // Events are read in an effect, not during render: localStorage is empty
  // during SSR, so reading it in useMemo would produce a hydration mismatch
  // (server renders the empty state, client renders data on first paint).
  const [events, setEvents] = useState<SearchEvent[]>([])

  useEffect(() => {
    setEvents(readStoredEvents())
  }, [tick])

  const data = useMemo(
    () => ({
      summary: computeSearchInsightsSummary(events, { days }),
      funnel: computeSearchFunnel(events),
      conversions: computeConversionRates(events),
      performance: computePerformanceStats(events),
      experiments: computeExperimentSummaries(events),
      eventCount: events.length,
    }),
    [events, days],
  )

  const { summary } = data
  const isEmpty = data.eventCount === 0

  function refresh() {
    setTick((value) => value + 1)
  }

  function clearAll() {
    clearSearchEvents()
    refresh()
  }

  return (
    <div className="grid gap-6">
      <section className="app-panel" aria-labelledby="search-insights-heading">
        <div className="app-panel-head">
          <div>
            <h2 id="search-insights-heading">Search insights</h2>
            <p>
              Local analytics from the command-menu search — queries, clicks, zero-result searches,
              conversions, experiments, and performance. Data stays in this browser&apos;s
              localStorage.
            </p>
          </div>
          <div className="app-toolbar" role="group" aria-label="Insights range">
            {DAY_OPTIONS.map((option) => (
              <Button
                key={option}
                type="button"
                size="xs"
                variant={days === option ? "secondary" : "outline"}
                aria-pressed={days === option}
                onClick={() => setDays(option)}
              >
                {option}d
              </Button>
            ))}
            <Button type="button" size="xs" variant="outline" onClick={refresh}>
              Refresh
            </Button>
            <Button type="button" size="xs" variant="outline" onClick={clearAll}>
              Clear data
            </Button>
          </div>
        </div>

        {isEmpty ? (
          <p className="text-muted-foreground text-sm">
            No search events recorded yet. Run a few ⌘K searches and this dashboard will populate.
          </p>
        ) : (
          <div className="app-usage-grid">
            <div
              className="app-stat-grid"
              style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}
            >
              <StatCard label="Searches" value={summary.totals.queries.toLocaleString()} />
              <StatCard
                label="Click-through rate"
                value={pct(summary.clickThroughRate)}
                hint={`${summary.totals.clicks} clicks`}
              />
              <StatCard
                label="Zero-result rate"
                value={pct(summary.zeroResultRate)}
                hint={`${summary.totals.zeroResults} empty`}
              />
              <StatCard
                label="Suggestions used"
                value={summary.totals.suggestionsUsed.toLocaleString()}
              />
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold">Searches per day</h3>
              <TrendChart daily={summary.daily} />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-semibold">Top queries</h3>
                {summary.topQueries.length === 0 ? (
                  <p className="text-muted-foreground text-sm">None yet.</p>
                ) : (
                  <ul className="grid gap-1">
                    {summary.topQueries.map((entry) => (
                      <li
                        key={entry.query}
                        className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm"
                      >
                        <span className="truncate">{entry.query}</span>
                        <span className="text-muted-foreground ml-3 shrink-0 text-xs">
                          {entry.count}× · {entry.zeroResultCount} zero
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <h3 className="mb-2 text-sm font-semibold">By language</h3>
                {summary.byLocale.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No locale data.</p>
                ) : (
                  <ul className="grid gap-1">
                    {summary.byLocale.map((locale) => (
                      <li
                        key={locale.locale}
                        className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm"
                      >
                        <span>{locale.locale}</span>
                        <span className="text-muted-foreground text-xs">
                          {locale.queries} searches · CTR {pct(locale.ctr)} · {locale.zeroResults}{" "}
                          zero
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold">Conversion funnel</h3>
              <ul className="grid gap-1">
                {data.funnel.stages.map((stage) => (
                  <li
                    key={stage.key}
                    className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm"
                  >
                    <span>{stage.label}</span>
                    <span className="text-muted-foreground text-xs">
                      {stage.count.toLocaleString()} · step {pct(stage.stepRate)} · overall{" "}
                      {pct(stage.overallRate)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground mt-2 text-xs">
                Deep conversion rate (doc open / feedback): {pct(data.funnel.deepConversionRate)}
              </p>
            </div>

            {data.experiments.length > 0 ? (
              <div>
                <h3 className="mb-2 text-sm font-semibold">Experiments</h3>
                {data.experiments.map((experiment) => (
                  <div key={experiment.experiment} className="mb-3">
                    <p className="mb-1 text-xs font-medium">{experiment.experiment}</p>
                    <ul className="grid gap-1">
                      {experiment.variants.map((variant) => (
                        <li
                          key={variant.variant}
                          className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm"
                        >
                          <span>{variant.variant}</span>
                          <span className="text-muted-foreground text-xs">
                            {variant.exposures} exposed · {variant.conversions} converted ·{" "}
                            {pct(variant.conversionRate)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : null}

            <div>
              <h3 className="mb-2 text-sm font-semibold">Performance</h3>
              <PerformancePanel stats={data.performance} />
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold">Conversion rates</h3>
              <ul className="grid gap-1">
                {data.conversions.map((rate) => (
                  <li
                    key={rate.conversion}
                    className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm"
                  >
                    <span>{rate.conversion.replace(/_/g, " ")}</span>
                    <span className="text-muted-foreground text-xs">
                      {rate.count} · {pct(rate.perSearch)} per search · {pct(rate.perClick)} per
                      click
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

export default SearchInsightsDashboard
