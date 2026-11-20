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
import { Select } from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"

/**
 * Admin "Email A/B" screen for `/app/admin/email-ab`: experiment list,
 * creation form, and per-experiment status controls backed by
 * `GET|POST /api/admin/email-ab` and `GET|PATCH /api/admin/email-ab/[id]`.
 *
 * Assignment is deterministic (`pickVariant` in `src/lib/email-ab.ts`) but
 * nothing is wired into send paths yet, and opens/clicks are NOT tracked —
 * the results section says so honestly. The store behind the API is the
 * in-memory dev seam described in `src/lib/email-ab.ts`.
 */

const API = "/api/admin/email-ab"
const MIN_VARIANTS = 2
const MAX_VARIANTS = 4
const NAME_MAX = 120
const KEY_MAX = 120
const SUBJECT_MAX = 200
const BODY_MAX = 50_000

export type EmailAbStatus = "draft" | "running" | "paused" | "concluded"

export interface EmailAbVariantRow {
  key: string
  subject: string
  bodyPreview?: string
}

export interface EmailAbExperimentRow {
  id: string
  name: string
  emailKey: string
  variants: EmailAbVariantRow[]
  status: EmailAbStatus
  winnerKey?: string
  createdAt: string
  concludedAt?: string
}

interface ListResponse {
  ok: boolean
  experiments?: EmailAbExperimentRow[]
  message?: string
}

interface SingleResponse {
  ok: boolean
  experiment?: EmailAbExperimentRow
  message?: string
}

interface VariantDraft {
  key: string
  subject: string
  body: string
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(undefined, { dateStyle: "medium" })
}

function statusBadgeVariant(status: EmailAbStatus) {
  if (status === "running") return "secondary" as const
  if (status === "concluded") return "outline" as const
  if (status === "paused") return "destructive" as const
  return "outline" as const
}

function emptyVariant(index: number): VariantDraft {
  return { key: index === 0 ? "control" : `variant-${index + 1}`, subject: "", body: "" }
}

export function EmailAbScreen() {
  const [experiments, setExperiments] = useState<EmailAbExperimentRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [winners, setWinners] = useState<Record<string, string>>({})
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [name, setName] = useState("")
  const [emailKey, setEmailKey] = useState("")
  const [variants, setVariants] = useState<VariantDraft[]>([emptyVariant(0), emptyVariant(1)])
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

  const createExperiment = useCallback(async () => {
    setCreating(true)
    setCreateError(null)
    setCreateNotice(null)
    try {
      const response = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          emailKey: emailKey.trim(),
          variants: variants.map((variant) => ({
            key: variant.key.trim(),
            subject: variant.subject.trim(),
            ...(variant.body.trim() ? { body: variant.body.trim() } : {}),
          })),
        }),
      })
      const data = (await response.json()) as SingleResponse
      if (!response.ok || !data.ok) {
        setCreateError(data.message ?? "Could not create the experiment.")
        return
      }
      setName("")
      setEmailKey("")
      setVariants([emptyVariant(0), emptyVariant(1)])
      setCreateNotice("Draft experiment saved. Start it to begin assigning variants.")
      setReloadKey((key) => key + 1)
    } catch {
      setCreateError("Could not create the experiment. Check your connection and try again.")
    } finally {
      setCreating(false)
    }
  }, [name, emailKey, variants])

  const patchExperiment = useCallback(
    async (id: string, payload: { status?: EmailAbStatus; winnerKey?: string }) => {
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
          (current ?? []).map((experiment) =>
            experiment.id === id ? data.experiment! : experiment,
          ),
        )
      } catch {
        setActionError("Could not update the experiment. Check your connection and try again.")
      } finally {
        setBusyId(null)
      }
    },
    [],
  )

  const updateVariant = useCallback((index: number, field: keyof VariantDraft, value: string) => {
    setVariants((current) =>
      current.map((variant, i) => (i === index ? { ...variant, [field]: value } : variant)),
    )
  }, [])

  const formValid =
    name.trim().length > 0 &&
    emailKey.trim().length > 0 &&
    variants.length >= MIN_VARIANTS &&
    variants.every(
      (variant) => variant.key.trim().length > 0 && variant.subject.trim().length > 0,
    ) &&
    new Set(variants.map((variant) => variant.key.trim())).size === variants.length

  const loading = experiments === null && error === null

  return (
    <div className="flex flex-col gap-6">
      <section className="app-panel" aria-labelledby="admin-email-ab-list-heading">
        <div className="app-panel-head">
          <div>
            <h2 id="admin-email-ab-list-heading">Experiments</h2>
            <p>
              A/B tests for email sends. Assignment is deterministic per recipient; results
              (opens/clicks) are not tracked yet.
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
            body="Create an experiment below to start assigning email variants."
          />
        ) : error ? null : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email key</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Variants</TableHead>
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
                    winner={
                      winners[experiment.id] ??
                      experiment.winnerKey ??
                      experiment.variants[0]?.key ??
                      ""
                    }
                    busy={busyId === experiment.id}
                    onToggle={() => setExpandedId(expanded ? null : experiment.id)}
                    onWinnerChange={(key) =>
                      setWinners((current) => ({ ...current, [experiment.id]: key }))
                    }
                    onAction={(payload) => void patchExperiment(experiment.id, payload)}
                  />
                )
              })}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="app-panel" aria-labelledby="admin-email-ab-create-heading">
        <div className="app-panel-head">
          <div>
            <h2 id="admin-email-ab-create-heading">New experiment</h2>
            <p>
              Drafts start in <code>draft</code> status — start one to begin deterministic variant
              assignment for its <code>emailKey</code>.
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
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="ab-name" className="text-muted-foreground text-xs">
                Name
              </label>
              <Input
                id="ab-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Welcome subject test"
                maxLength={NAME_MAX}
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="ab-email-key" className="text-muted-foreground text-xs">
                Email key
              </label>
              <Input
                id="ab-email-key"
                value={emailKey}
                onChange={(event) => setEmailKey(event.target.value)}
                placeholder="welcome-day-0"
                maxLength={KEY_MAX}
                required
              />
            </div>
          </div>
          <p className="text-muted-foreground text-xs">
            The email key identifies which template/campaign the experiment applies to (e.g. a
            series step or campaign id). It is matched by the send-path wiring — see
            <code> src/lib/email-ab.ts</code>.
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
                  <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
                    <Input
                      value={variant.key}
                      onChange={(event) => updateVariant(index, "key", event.target.value)}
                      placeholder="key (e.g. control)"
                      maxLength={60}
                      aria-label={`Variant ${index + 1} key`}
                      required
                    />
                    <Input
                      value={variant.subject}
                      onChange={(event) => updateVariant(index, "subject", event.target.value)}
                      placeholder="Subject line"
                      maxLength={SUBJECT_MAX}
                      aria-label={`Variant ${index + 1} subject`}
                      required
                    />
                  </div>
                  <Textarea
                    value={variant.body}
                    onChange={(event) => updateVariant(index, "body", event.target.value)}
                    placeholder="Body (optional — a preview is stored)"
                    rows={2}
                    maxLength={BODY_MAX}
                    showCount
                    aria-label={`Variant ${index + 1} body`}
                  />
                </CardContent>
              </Card>
            ))}
            {variants.length < MAX_VARIANTS ? (
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setVariants((current) => [...current, emptyVariant(current.length)])
                  }
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
  winner,
  busy,
  onToggle,
  onWinnerChange,
  onAction,
}: {
  experiment: EmailAbExperimentRow
  expanded: boolean
  winner: string
  busy: boolean
  onToggle: () => void
  onWinnerChange: (key: string) => void
  onAction: (payload: { status?: EmailAbStatus; winnerKey?: string }) => void
}) {
  const canStart = experiment.status === "draft"
  const canPause = experiment.status === "running"
  const canResume = experiment.status === "paused"
  const canConclude = experiment.status === "running" || experiment.status === "paused"
  const concluded = experiment.status === "concluded"

  return (
    <>
      <TableRow>
        <TableCell className="font-medium">{experiment.name}</TableCell>
        <TableCell className="font-mono text-xs">{experiment.emailKey}</TableCell>
        <TableCell>
          <Badge variant={statusBadgeVariant(experiment.status)}>{experiment.status}</Badge>
        </TableCell>
        <TableCell className="text-right">{experiment.variants.length}</TableCell>
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
              <div>
                <h3 className="text-sm font-medium">Variants</h3>
                <ul className="mt-1 flex flex-col gap-1 text-sm">
                  {experiment.variants.map((variant) => (
                    <li key={variant.key}>
                      <span className="font-medium">{variant.key}</span>
                      {concluded && experiment.winnerKey === variant.key ? (
                        <Badge variant="secondary" className="ml-2">
                          winner
                        </Badge>
                      ) : null}
                      <span className="text-muted-foreground"> — {variant.subject}</span>
                      {variant.bodyPreview ? (
                        <span className="text-muted-foreground block text-xs">
                          {variant.bodyPreview}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>

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
                        value: variant.key,
                        label: `${variant.key} — ${variant.subject}`,
                      }))}
                      value={winner}
                      onChange={(value) => onWinnerChange(typeof value === "string" ? value : "")}
                      className="w-64"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy || !winner}
                      onClick={() => onAction({ status: "concluded", winnerKey: winner })}
                    >
                      Conclude
                    </Button>
                  </>
                ) : null}
              </div>

              <div className="text-muted-foreground rounded-md border border-dashed p-3 text-sm">
                <p className="text-foreground font-medium">Results</p>
                <p>
                  Assignment only — opens and clicks are not tracked yet. Variant metrics wiring is
                  a follow-up task; this experiment currently records which variant each recipient
                  is deterministically assigned to.
                </p>
              </div>
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  )
}
