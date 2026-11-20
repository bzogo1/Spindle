"use client"

import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import { ChevronDown, ChevronRight, RefreshCw, Search, TriangleAlert } from "lucide-react"

import type { ChurnFactor, ChurnRisk, ChurnScore } from "@/lib/churn"
import { EmptyState } from "@/components/app/states/empty-state"
import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
import { cn } from "@/lib/utils"

/**
 * Admin "Churn risk" screen for `/app/admin/churn`: a ranked table of
 * heuristic churn-risk scores backed by `GET /api/admin/churn`.
 *
 * HONESTY NOTE (mirrored in the UI): the scores are a transparent weighted
 * heuristic over the signals available in this environment — session
 * activity, email verification, onboarding completion, and bug-report
 * feedback. They are NOT a trained model and do NOT predict actual churn;
 * they exist to prioritize which accounts an admin might want to look at.
 * Missing data is treated as neutral-ish by the scorer, and NPS responses
 * cannot be attributed to users at all (anonymous by design).
 */

const CHURN_API = "/api/admin/churn"
const FETCH_LIMIT = 500

interface ChurnResponse {
  ok: boolean
  scores?: ChurnScore[]
  total?: number
  computedAt?: string
  message?: string
}

const MIN_RISK_OPTIONS = [
  { value: "low", label: "All risk levels" },
  { value: "medium", label: "Medium risk and above" },
  { value: "high", label: "High risk only" },
]

const RISK_LABEL: Record<ChurnRisk, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
}

function riskBadgeVariant(risk: ChurnRisk) {
  if (risk === "high") return "destructive" as const
  if (risk === "medium") return "secondary" as const
  return "outline" as const
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return "—"
  return new Date(ms).toLocaleString()
}

function topFactors(factors: ChurnFactor[], count = 2): string {
  return factors
    .slice(0, count)
    .map((factor) => `${factor.signal} (+${factor.impact})`)
    .join(", ")
}

export function ChurnScreen() {
  const [scores, setScores] = useState<ChurnScore[] | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [computedAt, setComputedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [minRisk, setMinRisk] = useState("low")
  const [query, setQuery] = useState("")
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`${CHURN_API}?minRisk=${minRisk}&limit=${FETCH_LIMIT}`, {
        cache: "no-store",
      })
      const body = (await response.json()) as ChurnResponse
      if (!response.ok || !body.ok || !Array.isArray(body.scores)) {
        setError(body.message ?? "Could not load churn scores.")
        setScores(null)
        return
      }
      setScores(body.scores)
      setTotal(typeof body.total === "number" ? body.total : body.scores.length)
      setComputedAt(body.computedAt ?? null)
    } catch {
      setError("Could not reach the churn endpoint.")
      setScores(null)
    } finally {
      setLoading(false)
    }
  }, [minRisk])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    if (!scores) return []
    const needle = query.trim().toLowerCase()
    if (!needle) return scores
    return scores.filter(
      (score) =>
        score.email.toLowerCase().includes(needle) ||
        (score.name ?? "").toLowerCase().includes(needle),
    )
  }, [scores, query])

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TriangleAlert className="text-muted-foreground size-4" aria-hidden="true" />
            How these scores work
          </CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          <p>
            These are{" "}
            <strong className="text-foreground">
              heuristic scores, not a machine-learning model
            </strong>
            . Each account is scored 0–100 from transparent, weighted signals available in this
            environment: days since last observed activity (the heaviest signal), active session
            count, email verification, onboarding completion, and bug-report feedback. Signals that
            cannot be read are treated as neutral, and anonymous NPS responses cannot be attributed
            to any user. Use the ranking to decide who to look at — not as a prediction that someone
            will leave.
          </p>
          {computedAt ? (
            <p className="mt-2 text-xs">Scores computed {formatDate(computedAt)}.</p>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="churn-filter-risk" className="text-muted-foreground text-xs">
            Minimum risk
          </label>
          <Select
            id="churn-filter-risk"
            aria-label="Minimum risk"
            options={MIN_RISK_OPTIONS}
            value={minRisk}
            onChange={(value) => setMinRisk(typeof value === "string" ? value : "low")}
          />
        </div>
        <div className="flex min-w-56 flex-1 flex-col gap-1">
          <label htmlFor="churn-filter-search" className="text-muted-foreground text-xs">
            Search email or name
          </label>
          <div className="relative">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <Input
              id="churn-filter-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter loaded scores…"
              className="pl-9"
            />
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn("size-4", loading && "animate-spin")} aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {loading ? (
        <LoadingPanel label="Scoring churn risk" />
      ) : error ? (
        <InlineError
          title="Churn scores unavailable"
          message={error}
          action={
            <Button variant="outline" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={scores && scores.length === 0 ? "No users to score" : "No matching users"}
          body={
            scores && scores.length === 0
              ? "No user accounts were found in the available stores, so there is nothing to score yet."
              : "No loaded scores match the current filters. Try a different risk level or search term."
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>User</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                  <TableHead>Top factors</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((score) => {
                  const expanded = expandedId === score.userId
                  return (
                    <Fragment key={score.userId}>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() => setExpandedId(expanded ? null : score.userId)}
                      >
                        <TableCell>
                          {expanded ? (
                            <ChevronDown
                              className="text-muted-foreground size-4"
                              aria-hidden="true"
                            />
                          ) : (
                            <ChevronRight
                              className="text-muted-foreground size-4"
                              aria-hidden="true"
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{score.email}</div>
                          {score.name ? (
                            <div className="text-muted-foreground text-xs">{score.name}</div>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Badge variant={riskBadgeVariant(score.risk)}>
                            {RISK_LABEL[score.risk]} risk
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">{score.score}</TableCell>
                        <TableCell className="text-muted-foreground max-w-64 truncate text-xs">
                          {topFactors(score.factors)}
                        </TableCell>
                      </TableRow>
                      {expanded ? (
                        <TableRow>
                          <TableCell colSpan={5} className="bg-muted/40">
                            <div className="grid gap-2 py-2 text-sm">
                              <p className="text-muted-foreground text-xs">
                                Computed {formatDate(score.computedAt)} · every evaluated signal,
                                highest impact first.
                              </p>
                              <ul className="grid gap-1">
                                {score.factors.map((factor) => (
                                  <li key={factor.signal} className="flex items-baseline gap-2">
                                    <span className="w-40 shrink-0 font-mono text-xs">
                                      {factor.signal}
                                    </span>
                                    <Badge variant="outline" size="sm">
                                      +{factor.impact}
                                    </Badge>
                                    <span className="text-muted-foreground">{factor.detail}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {scores && scores.length > 0 ? (
        <p className="text-muted-foreground text-xs">
          Showing {filtered.length} of {scores.length} loaded score
          {scores.length === 1 ? "" : "s"}
          {total !== null && total > scores.length
            ? ` (${total} matched the selected risk level before the ${FETCH_LIMIT}-row fetch cap)`
            : ""}
          .
        </p>
      ) : null}
    </div>
  )
}
