"use client"

import { useCallback, useEffect, useState } from "react"
import { ChevronDown, ChevronRight, FlaskConical, Plus, Trash2 } from "lucide-react"

import { EmptyState } from "@/components/app/states/empty-state"
import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
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
 * Admin "Landing A/B" screen for `/app/admin/landing-ab`: experiment list,
 * create/edit form, status transitions, and per-variant results backed by
 * `GET|POST /api/admin/landing-ab` and `GET|PATCH /api/admin/landing-ab/[id]`.
 *
 * Experiments target a named surface — `"referral-landing"` is the surface the
 * `/r/[code]` page resolves. Variant `config` keys (`headline`, `ctaLabel`,
 * `showSocialProof`) are interpreted by the surface. The store behind the API
 * is the in-memory dev seam described in `src/lib/landing-ab.ts`.
 *
 * Types are redeclared locally: `src/lib/landing-ab.ts` is server-only
 * (`node:crypto`) and must not enter the client bundle.
 */

const API = "/api/admin/landing-ab"
const MIN_VARIANTS = 2
const MAX_VARIANTS = 6
const NAME_MAX = 120
const CONFIG_MAX = 500

export type LandingAbStatus = "draft" | "running" | "paused" | "completed"

export interface LandingAbVariantRow {
  id: string
  weight: number
  config: {
    headline?: string
    ctaLabel?: string
    showSocialProof?: boolean
    [key: string]: string | number | boolean | undefined
  }
}

export interface LandingAbExperimentRow {
  id: string
  name: string
  variants: LandingAbVariantRow[]
  status: LandingAbStatus
  startAt?: string
  endAt?: string
  winnerVariantId?: string
  createdAt: string
  completedAt?: string
}

export interface LandingAbVariantResult {
  variantId: string
  weight: number
  assigned: number
  views: number
  ctaClicks: number
  signupClicks: number
  viewRate: number
  clickRate: number
}

export interface LandingAbResults {
  experimentId: string
  status: LandingAbStatus
  winnerVariantId?: string
  variants: LandingAbVariantResult[]
  totals: {
    assigned: number
    views: number
    ctaClicks: number
    signupClicks: number
  }
}

interface ListResponse {
  ok: boolean
  experiments?: LandingAbExperimentRow[]
  message?: string
}

interface SingleResponse {
  ok: boolean
  experiment?: LandingAbExperimentRow
  results?: LandingAbResults
  message?: string
}

interface VariantDraft {
  /** Existing variant id when editing; empty string = let the server generate one. */
  id: string
  weight: string
  headline: string
  ctaLabel: string
  showSocialProof: boolean
}

function formatDate(iso: string | undefined): string {
  if (!iso) return "—"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(undefined, { dateStyle: "medium" })
}

function formatDateTime(iso: string | undefined): string {
  if (!iso) return "—"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

function statusBadgeVariant(status: LandingAbStatus) {
  if (status === "running") return "secondary" as const
  if (status === "completed") return "outline" as const
  if (status === "paused") return "destructive" as const
  return "outline" as const
}

function emptyVariant(): VariantDraft {
  return { id: "", weight: "1", headline: "", ctaLabel: "", showSocialProof: true }
}

function variantToDraft(variant: LandingAbVariantRow): VariantDraft {
  return {
    id: variant.id,
    weight: String(variant.weight),
    headline: variant.config.headline ?? "",
    ctaLabel: variant.config.ctaLabel ?? "",
    showSocialProof: variant.config.showSocialProof ?? true,
  }
}

/** Serializes the draft form into the API's `{ id?, weight?, config? }` shape. */
function variantToPayload(draft: VariantDraft) {
  const config: LandingAbVariantRow["config"] = {}
  if (draft.headline.trim()) config.headline = draft.headline.trim()
  if (draft.ctaLabel.trim()) config.ctaLabel = draft.ctaLabel.trim()
  config.showSocialProof = draft.showSocialProof
  const weight = Number.parseInt(draft.weight, 10)
  return {
    ...(draft.id.trim() ? { id: draft.id.trim() } : {}),
    ...(Number.isInteger(weight) && weight >= 1 ? { weight } : {}),
    config,
  }
}

/** `datetime-local` input value → ISO string, or undefined when empty/invalid. */
function localToIso(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const date = new Date(trimmed)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

/** ISO timestamp → `datetime-local` input value (local time, minute precision). */
function isoToLocal(iso: string | undefined): string {
  if (!iso) return ""
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function LandingAbScreen() {
  const [experiments, setExperiments] = useState<LandingAbExperimentRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [resultsById, setResultsById] = useState<Record<string, LandingAbResults | null>>({})
  const [resultsError, setResultsError] = useState<Record<string, string | null>>({})
  const [winners, setWinners] = useState<Record<string, string>>({})
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [name, setName] = useState("")
  const [startAt, setStartAt] = useState("")
  const [endAt, setEndAt] = useState("")
  const [variants, setVariants] = useState<VariantDraft[]>([emptyVariant(), emptyVariant()])
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createNotice, setCreateNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch(API, { cache: "no-store" })
      const data = (await response.json()) as ListResponse
      if (!response.ok || !data.ok) {
        setError(data.message ?? "Could not load experiments.")
        setExperiments([])
        return
      }
      setExperiments(data.experiments ?? [])
      setError(null)
    } catch {
      setError("Could not load experiments. Check your connection and try again.")
      setExperiments([])
    }
  }, [])

  useEffect(() => {
    setExperiments(null)
    void load()
  }, [load, reloadKey])

  const loadResults = useCallback(async (id: string) => {
    try {
      const response = await fetch(`${API}/${id}`, { cache: "no-store" })
      const data = (await response.json()) as SingleResponse
      if (!response.ok || !data.ok || !data.results) {
        setResultsError((current) => ({
          ...current,
          [id]: data.message ?? "Could not load results.",
        }))
        return
      }
      setResultsById((current) => ({ ...current, [id]: data.results! }))
      setResultsError((current) => ({ ...current, [id]: null }))
    } catch {
      setResultsError((current) => ({
        ...current,
        [id]: "Could not load results. Check your connection and try again.",
      }))
    }
  }, [])

  const toggleExpanded = useCallback(
    (experiment: LandingAbExperimentRow) => {
      setExpandedId((current) => {
        if (current === experiment.id) return null
        if (resultsById[experiment.id] === undefined) void loadResults(experiment.id)
        return experiment.id
      })
    },
    [loadResults, resultsById],
  )

  const patchExperiment = useCallback(async (id: string, payload: Record<string, unknown>) => {
    setBusyId(id)
    setActionError(null)
    try {
      const response = await fetch(`${API}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = (await response.json()) as SingleResponse
      if (!response.ok || !data.ok || !data.experiment) {
        setActionError(data.message ?? "Could not update the experiment.")
        return
      }
      setExperiments((current) =>
        (current ?? []).map((experiment) => (experiment.id === id ? data.experiment! : experiment)),
      )
      if (data.results) {
        setResultsById((current) => ({ ...current, [id]: data.results! }))
      }
    } catch {
      setActionError("Could not update the experiment. Check your connection and try again.")
    } finally {
      setBusyId(null)
    }
  }, [])

  const createExperiment = useCallback(async () => {
    setCreating(true)
    setCreateError(null)
    setCreateNotice(null)
    try {
      const startIso = localToIso(startAt)
      const endIso = localToIso(endAt)
      const response = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          variants: variants.map(variantToPayload),
          ...(startIso ? { startAt: startIso } : {}),
          ...(endIso ? { endAt: endIso } : {}),
        }),
      })
      const data = (await response.json()) as SingleResponse
      if (!response.ok || !data.ok) {
        setCreateError(data.message ?? "Could not create the experiment.")
        return
      }
      setName("")
      setStartAt("")
      setEndAt("")
      setVariants([emptyVariant(), emptyVariant()])
      setCreateNotice("Draft experiment saved. Start it to begin assigning variants.")
      setReloadKey((key) => key + 1)
    } catch {
      setCreateError("Could not create the experiment. Check your connection and try again.")
    } finally {
      setCreating(false)
    }
  }, [name, startAt, endAt, variants])

  const updateVariant = useCallback(
    (index: number, field: keyof VariantDraft, value: string | boolean) => {
      setVariants((current) =>
        current.map((variant, i) => (i === index ? { ...variant, [field]: value } : variant)),
      )
    },
    [],
  )

  const formValid =
    name.trim().length > 0 &&
    name.trim().length <= NAME_MAX &&
    variants.length >= MIN_VARIANTS &&
    variants.length <= MAX_VARIANTS &&
    variants.every((variant) => {
      const weight = Number.parseInt(variant.weight, 10)
      return (
        Number.isInteger(weight) &&
        weight >= 1 &&
        weight <= 1_000_000 &&
        variant.headline.trim().length <= CONFIG_MAX &&
        variant.ctaLabel.trim().length <= CONFIG_MAX
      )
    }) &&
    new Set(variants.map((variant) => variant.id.trim()).filter(Boolean)).size ===
      variants.filter((variant) => variant.id.trim()).length &&
    (startAt.trim() === "" || localToIso(startAt) !== undefined) &&
    (endAt.trim() === "" || localToIso(endAt) !== undefined) &&
    !(localToIso(startAt) && localToIso(endAt) && localToIso(startAt)! >= localToIso(endAt)!)

  const loading = experiments === null && error === null

  return (
    <div className="flex flex-col gap-6">
      <section className="app-panel" aria-labelledby="admin-landing-ab-list-heading">
        <div className="app-panel-head">
          <div>
            <h2 id="admin-landing-ab-list-heading">Experiments</h2>
            <p>
              A/B tests for landing pages. The <code>referral-landing</code> surface is resolved by
              <code> /r/[code]</code>; assignment is sticky per anonymous visitor and events
              (views/clicks) feed the results table.
            </p>
          </div>
        </div>

        {actionError ? <InlineError title="Update failed" message={actionError} /> : null}
        {error ? (
          <InlineError
            title="Experiments unavailable"
            message={
              <span className="flex flex-wrap items-center gap-2">
                <span>{error}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setReloadKey((key) => key + 1)}
                >
                  Retry
                </Button>
              </span>
            }
          />
        ) : null}

        {loading ? (
          <LoadingPanel label="Loading experiments" variant="table" />
        ) : experiments !== null && experiments.length === 0 && !error ? (
          <EmptyState
            icon={<FlaskConical aria-hidden="true" />}
            title="No experiments yet"
            body="Create an experiment below to start assigning landing-page variants."
          />
        ) : error ? null : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name / surface</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Variants</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>Created</TableHead>
                <TableHead aria-label="Expand" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(experiments ?? []).map((experiment) => {
                const expanded = expandedId === experiment.id
                return (
                  <ExperimentRows
                    key={experiment.id}
                    experiment={experiment}
                    expanded={expanded}
                    results={resultsById[experiment.id]}
                    resultsError={resultsError[experiment.id] ?? null}
                    winner={
                      winners[experiment.id] ??
                      experiment.winnerVariantId ??
                      experiment.variants[0]?.id ??
                      ""
                    }
                    busy={busyId === experiment.id}
                    onToggle={() => toggleExpanded(experiment)}
                    onWinnerChange={(variantId) =>
                      setWinners((current) => ({ ...current, [experiment.id]: variantId }))
                    }
                    onAction={(payload) => void patchExperiment(experiment.id, payload)}
                    onResultsRetry={() => void loadResults(experiment.id)}
                    onUpdated={(updated) => {
                      setExperiments((current) =>
                        (current ?? []).map((row) => (row.id === updated.id ? updated : row)),
                      )
                    }}
                  />
                )
              })}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="app-panel" aria-labelledby="admin-landing-ab-create-heading">
        <div className="app-panel-head">
          <div>
            <h2 id="admin-landing-ab-create-heading">New experiment</h2>
            <p>
              Drafts start in <code>draft</code> status — start one to begin deterministic variant
              assignment for its surface. Use <code>referral-landing</code> to test the{" "}
              <code>/r/[code]</code> invite page.
            </p>
          </div>
        </div>

        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (!formValid || creating) return
            void createExperiment()
          }}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="lab-name" className="text-muted-foreground text-xs">
                Name / surface
              </label>
              <Input
                id="lab-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="referral-landing"
                maxLength={NAME_MAX}
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="lab-start" className="text-muted-foreground text-xs">
                Starts at (optional)
              </label>
              <Input
                id="lab-start"
                type="datetime-local"
                value={startAt}
                onChange={(event) => setStartAt(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="lab-end" className="text-muted-foreground text-xs">
                Ends at (optional)
              </label>
              <Input
                id="lab-end"
                type="datetime-local"
                value={endAt}
                onChange={(event) => setEndAt(event.target.value)}
              />
            </div>
          </div>
          <p className="text-muted-foreground text-xs">
            The name is the surface identifier the page resolves — currently only{" "}
            <code>referral-landing</code> is wired. The optional window gates assignment: outside it
            the surface falls back to control copy.
          </p>

          <fieldset className="flex flex-col gap-3">
            <legend className="text-muted-foreground text-xs">
              Variants ({variants.length}/{MAX_VARIANTS})
            </legend>
            {variants.map((variant, index) => (
              <Card key={index}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between text-sm">
                    <span>Variant {index + 1}</span>
                    {variants.length > MIN_VARIANTS ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove variant ${index + 1}`}
                        onClick={() =>
                          setVariants((current) => current.filter((_, i) => i !== index))
                        }
                      >
                        <Trash2 aria-hidden="true" className="size-4" />
                      </Button>
                    ) : null}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  <div className="grid gap-2 sm:grid-cols-[6rem_1fr_1fr]">
                    <Input
                      type="number"
                      min={1}
                      value={variant.weight}
                      onChange={(event) => updateVariant(index, "weight", event.target.value)}
                      placeholder="Weight"
                      aria-label={`Variant ${index + 1} weight`}
                      required
                    />
                    <Input
                      value={variant.headline}
                      onChange={(event) => updateVariant(index, "headline", event.target.value)}
                      placeholder="Headline override (optional)"
                      maxLength={CONFIG_MAX}
                      aria-label={`Variant ${index + 1} headline`}
                    />
                    <Input
                      value={variant.ctaLabel}
                      onChange={(event) => updateVariant(index, "ctaLabel", event.target.value)}
                      placeholder="CTA label override (optional)"
                      maxLength={CONFIG_MAX}
                      aria-label={`Variant ${index + 1} CTA label`}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      id={`lab-social-${index}`}
                      checked={variant.showSocialProof}
                      onCheckedChange={(checked) =>
                        updateVariant(index, "showSocialProof", checked)
                      }
                    />
                    <Label htmlFor={`lab-social-${index}`} className="text-xs">
                      Show social proof
                    </Label>
                  </div>
                </CardContent>
              </Card>
            ))}
            {variants.length < MAX_VARIANTS ? (
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setVariants((current) => [...current, emptyVariant()])}
                >
                  <Plus aria-hidden="true" className="size-4" />
                  Add variant
                </Button>
              </div>
            ) : null}
          </fieldset>

          {createError ? <p className="text-destructive text-sm">{createError}</p> : null}
          {createNotice ? <p className="text-muted-foreground text-sm">{createNotice}</p> : null}
          <div>
            <Button type="submit" size="sm" disabled={creating || !formValid}>
              {creating ? "Saving…" : "Create experiment"}
            </Button>
          </div>
        </form>
      </section>
    </div>
  )
}

function ExperimentRows({
  experiment,
  expanded,
  results,
  resultsError,
  winner,
  busy,
  onToggle,
  onWinnerChange,
  onAction,
  onResultsRetry,
  onUpdated,
}: {
  experiment: LandingAbExperimentRow
  expanded: boolean
  results: LandingAbResults | null | undefined
  resultsError: string | null
  winner: string
  busy: boolean
  onToggle: () => void
  onWinnerChange: (variantId: string) => void
  onAction: (payload: Record<string, unknown>) => void
  onResultsRetry: () => void
  onUpdated: (experiment: LandingAbExperimentRow) => void
}) {
  const canStart = experiment.status === "draft"
  const canPause = experiment.status === "running"
  const canResume = experiment.status === "paused"
  const canConclude = experiment.status === "running" || experiment.status === "paused"
  const completed = experiment.status === "completed"

  const schedule =
    experiment.startAt || experiment.endAt
      ? `${formatDateTime(experiment.startAt)} → ${formatDateTime(experiment.endAt)}`
      : "Always"

  return (
    <>
      <TableRow>
        <TableCell className="font-medium">{experiment.name}</TableCell>
        <TableCell>
          <Badge variant={statusBadgeVariant(experiment.status)}>{experiment.status}</Badge>
        </TableCell>
        <TableCell className="text-right">{experiment.variants.length}</TableCell>
        <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
          {schedule}
        </TableCell>
        <TableCell className="whitespace-nowrap">{formatDate(experiment.createdAt)}</TableCell>
        <TableCell className="text-right">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`${expanded ? "Collapse" : "Expand"} ${experiment.name}`}
            aria-expanded={expanded}
            onClick={onToggle}
          >
            {expanded ? (
              <ChevronDown aria-hidden="true" className="size-4" />
            ) : (
              <ChevronRight aria-hidden="true" className="size-4" />
            )}
          </Button>
        </TableCell>
      </TableRow>
      {expanded ? (
        <TableRow>
          <TableCell colSpan={6} className="bg-muted/30">
            <div className="flex flex-col gap-3 py-2">
              {experiment.status === "draft" ? (
                <DraftEditor
                  key={experiment.id}
                  experiment={experiment}
                  busy={busy}
                  onSaved={onUpdated}
                />
              ) : (
                <ul className="flex flex-col gap-1 text-sm">
                  {experiment.variants.map((variant) => (
                    <li key={variant.id}>
                      <span className="font-mono text-xs">{variant.id.slice(0, 12)}…</span>
                      {experiment.winnerVariantId === variant.id ? (
                        <Badge variant="secondary" className="ml-2">
                          winner
                        </Badge>
                      ) : null}
                      <span className="text-muted-foreground">
                        {" "}
                        — weight {variant.weight}
                        {variant.config.headline ? `, “${variant.config.headline}”` : ""}
                        {variant.config.ctaLabel ? `, CTA “${variant.config.ctaLabel}”` : ""}
                        {variant.config.showSocialProof === false ? ", social proof off" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {canStart ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    onClick={() => onAction({ status: "running" })}
                  >
                    Start
                  </Button>
                ) : null}
                {canPause ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => onAction({ status: "paused" })}
                  >
                    Pause
                  </Button>
                ) : null}
                {canResume ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    onClick={() => onAction({ status: "running" })}
                  >
                    Resume
                  </Button>
                ) : null}
                {canConclude ? (
                  <>
                    <Select
                      aria-label={`Winner for ${experiment.name}`}
                      options={experiment.variants.map((variant) => ({
                        value: variant.id,
                        label: `${variant.id.slice(0, 12)}… — weight ${variant.weight}`,
                      }))}
                      value={winner}
                      onChange={(value) => onWinnerChange(typeof value === "string" ? value : "")}
                      className="w-56"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy || !winner}
                      onClick={() => onAction({ status: "completed", winnerVariantId: winner })}
                    >
                      Conclude
                    </Button>
                  </>
                ) : null}
                {completed ? (
                  <p className="text-muted-foreground text-xs">
                    Completed
                    {experiment.completedAt ? ` ${formatDateTime(experiment.completedAt)}` : ""}
                    {experiment.winnerVariantId
                      ? " — winner locked in; all visitors resolve to it."
                      : ""}
                  </p>
                ) : null}
              </div>

              <div>
                <h3 className="text-sm font-medium">Results</h3>
                {resultsError ? (
                  <InlineError
                    title="Results unavailable"
                    message={
                      <span className="flex flex-wrap items-center gap-2">
                        <span>{resultsError}</span>
                        <Button type="button" variant="outline" size="sm" onClick={onResultsRetry}>
                          Retry
                        </Button>
                      </span>
                    }
                  />
                ) : results === undefined ? (
                  <LoadingPanel label="Loading results" variant="table" />
                ) : results === null ? (
                  <p className="text-muted-foreground text-sm">No results for this experiment.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Variant</TableHead>
                        <TableHead className="text-right">Weight</TableHead>
                        <TableHead className="text-right">Assigned</TableHead>
                        <TableHead className="text-right">Views</TableHead>
                        <TableHead className="text-right">CTA clicks</TableHead>
                        <TableHead className="text-right">Signups</TableHead>
                        <TableHead className="text-right">View rate</TableHead>
                        <TableHead className="text-right">Click rate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {results.variants.map((variant) => {
                        const isWinner = results.winnerVariantId === variant.variantId
                        return (
                          <TableRow key={variant.variantId}>
                            <TableCell className="font-mono text-xs">
                              {variant.variantId.slice(0, 12)}…
                              {isWinner ? (
                                <Badge variant="secondary" className="ml-2">
                                  winner
                                </Badge>
                              ) : null}
                            </TableCell>
                            <TableCell className="text-right">{variant.weight}</TableCell>
                            <TableCell className="text-right">{variant.assigned}</TableCell>
                            <TableCell className="text-right">{variant.views}</TableCell>
                            <TableCell className="text-right">{variant.ctaClicks}</TableCell>
                            <TableCell className="text-right">{variant.signupClicks}</TableCell>
                            <TableCell className="text-right">
                              {formatRate(variant.viewRate)}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatRate(variant.clickRate)}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                      <TableRow className="font-medium">
                        <TableCell>Total</TableCell>
                        <TableCell />
                        <TableCell className="text-right">{results.totals.assigned}</TableCell>
                        <TableCell className="text-right">{results.totals.views}</TableCell>
                        <TableCell className="text-right">{results.totals.ctaClicks}</TableCell>
                        <TableCell className="text-right">{results.totals.signupClicks}</TableCell>
                        <TableCell />
                        <TableCell />
                      </TableRow>
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  )
}

/**
 * Inline editor for `draft` experiments — variants are only editable before
 * the experiment starts assigning. Saves via PATCH with name/variants/window.
 */
function DraftEditor({
  experiment,
  busy,
  onSaved,
}: {
  experiment: LandingAbExperimentRow
  busy: boolean
  onSaved: (experiment: LandingAbExperimentRow) => void
}) {
  const [editName, setEditName] = useState(experiment.name)
  const [editStart, setEditStart] = useState(isoToLocal(experiment.startAt))
  const [editEnd, setEditEnd] = useState(isoToLocal(experiment.endAt))
  const [editVariants, setEditVariants] = useState<VariantDraft[]>(() =>
    experiment.variants.map((variant) => variantToDraft(variant)),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const valid =
    editName.trim().length > 0 &&
    editVariants.length >= MIN_VARIANTS &&
    editVariants.every((variant) => {
      const weight = Number.parseInt(variant.weight, 10)
      return Number.isInteger(weight) && weight >= 1 && weight <= 1_000_000
    }) &&
    new Set(editVariants.map((variant) => variant.id.trim()).filter(Boolean)).size ===
      editVariants.filter((variant) => variant.id.trim()).length &&
    (editStart.trim() === "" || localToIso(editStart) !== undefined) &&
    (editEnd.trim() === "" || localToIso(editEnd) !== undefined) &&
    !(
      localToIso(editStart) &&
      localToIso(editEnd) &&
      localToIso(editStart)! >= localToIso(editEnd)!
    )

  const updateDraftVariant = (
    index: number,
    field: keyof VariantDraft,
    value: string | boolean,
  ) => {
    setEditVariants((current) =>
      current.map((variant, i) => (i === index ? { ...variant, [field]: value } : variant)),
    )
  }

  const save = useCallback(async () => {
    if (!valid || saving) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(`${API}/${experiment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          variants: editVariants.map(variantToPayload),
          startAt: localToIso(editStart) ?? null,
          endAt: localToIso(editEnd) ?? null,
        }),
      })
      const data = (await response.json()) as SingleResponse
      if (!response.ok || !data.ok || !data.experiment) {
        setError(data.message ?? "Could not save the experiment.")
        return
      }
      onSaved(data.experiment)
      setNotice("Draft saved.")
    } catch {
      setError("Could not save the experiment. Check your connection and try again.")
    } finally {
      setSaving(false)
    }
  }, [valid, saving, editName, editVariants, editStart, editEnd, experiment.id, onSaved])

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Edit draft</h3>
      <div className="grid gap-2 sm:grid-cols-3">
        <Input
          value={editName}
          onChange={(event) => setEditName(event.target.value)}
          placeholder="Name / surface"
          maxLength={NAME_MAX}
          aria-label="Experiment name"
        />
        <Input
          type="datetime-local"
          value={editStart}
          onChange={(event) => setEditStart(event.target.value)}
          aria-label="Starts at"
        />
        <Input
          type="datetime-local"
          value={editEnd}
          onChange={(event) => setEditEnd(event.target.value)}
          aria-label="Ends at"
        />
      </div>
      {editVariants.map((variant, index) => (
        <div key={variant.id || index} className="grid gap-2 sm:grid-cols-[6rem_1fr_1fr_auto]">
          <Input
            type="number"
            min={1}
            value={variant.weight}
            onChange={(event) => updateDraftVariant(index, "weight", event.target.value)}
            placeholder="Weight"
            aria-label={`Variant ${index + 1} weight`}
          />
          <Input
            value={variant.headline}
            onChange={(event) => updateDraftVariant(index, "headline", event.target.value)}
            placeholder="Headline override"
            maxLength={CONFIG_MAX}
            aria-label={`Variant ${index + 1} headline`}
          />
          <Input
            value={variant.ctaLabel}
            onChange={(event) => updateDraftVariant(index, "ctaLabel", event.target.value)}
            placeholder="CTA label override"
            maxLength={CONFIG_MAX}
            aria-label={`Variant ${index + 1} CTA label`}
          />
          <div className="flex items-center gap-2">
            <Switch
              checked={variant.showSocialProof}
              onCheckedChange={(checked) => updateDraftVariant(index, "showSocialProof", checked)}
              aria-label={`Variant ${index + 1} show social proof`}
            />
            {editVariants.length > MIN_VARIANTS ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Remove variant ${index + 1}`}
                onClick={() => setEditVariants((current) => current.filter((_, i) => i !== index))}
              >
                <Trash2 aria-hidden="true" className="size-4" />
              </Button>
            ) : null}
          </div>
        </div>
      ))}
      {editVariants.length < MAX_VARIANTS ? (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setEditVariants((current) => [...current, emptyVariant()])}
          >
            <Plus aria-hidden="true" className="size-4" />
            Add variant
          </Button>
        </div>
      ) : null}
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {notice ? <p className="text-muted-foreground text-sm">{notice}</p> : null}
      <div>
        <Button
          type="button"
          size="sm"
          disabled={saving || busy || !valid}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save draft"}
        </Button>
      </div>
    </div>
  )
}
