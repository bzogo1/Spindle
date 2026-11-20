"use client"

import { Fragment, useCallback, useEffect, useRef, useState } from "react"
import {
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Download,
  FileSearch,
  Plus,
  Scale,
} from "lucide-react"

import { EmptyState } from "@/components/app/states/empty-state"
import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

/**
 * Admin "Compliance" screen for `/app/admin/compliance`: the compliance case
 * queue plus program reporting, backed by `/api/admin/compliance/*`.
 *
 * Cases are opened against affiliates/partners/users, investigated through
 * the open → investigating → resolved|dismissed state machine, and carry an
 * append-only note log. The report section renders
 * `generateProgramComplianceReport` aggregates for a picked month and offers
 * the audit-trail CSV export.
 *
 * All state lives in the in-memory dev seam in `src/lib/compliance.ts`, so
 * cases do not survive restarts.
 */

const CASES_API = "/api/admin/compliance/cases"
const REPORT_API = "/api/admin/compliance/report"

type CaseType = "fraud_review" | "policy_violation" | "payout_hold" | "kyc" | "other"
type CaseStatus = "open" | "investigating" | "resolved" | "dismissed"
type CasePriority = "low" | "medium" | "high"
type SubjectType = "affiliate" | "partner" | "user"

interface CaseNote {
  id: string
  kind: "note" | "transition"
  actorId: string
  body: string
  at: string
}

interface ComplianceCaseRow {
  id: string
  type: CaseType
  subjectType: SubjectType
  subjectId: string
  status: CaseStatus
  priority: CasePriority
  notes: CaseNote[]
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
}

interface CasesResponse {
  ok: boolean
  cases?: ComplianceCaseRow[]
  total?: number
  message?: string
}

interface ReportResponse {
  ok: boolean
  report?: ProgramReport
  message?: string
}

interface ProgramReport {
  period: { start: string | null; end: string | null }
  affiliates: {
    total: number
    byStatus: Record<string, number>
    createdInPeriod: number
  }
  cases: {
    total: number
    createdInPeriod: number
    byStatus: Record<string, number>
    byType: Record<string, number>
    openByType: Record<string, number>
    openByPriority: Record<string, number>
  }
  fraudFlags: {
    total: number
    byStatus: Record<string, number>
    scannedInPeriod: number
  }
  commissions: {
    total: number
    createdInPeriod: number
    amountCentsByStatus: Record<string, number>
  }
  payouts: {
    runsTotal: number
    runsByStatus: Record<string, number>
    itemsTotal: number
    itemsAmountCentsByStatus: Record<string, number>
    runsInPeriod: number
  }
  taxForms: {
    total: number
    byStatus: Record<string, number>
    createdInPeriod: number
  }
}

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "investigating", label: "Investigating" },
  { value: "resolved", label: "Resolved" },
  { value: "dismissed", label: "Dismissed" },
]

const TYPE_OPTIONS = [
  { value: "", label: "All types" },
  { value: "fraud_review", label: "Fraud review" },
  { value: "policy_violation", label: "Policy violation" },
  { value: "payout_hold", label: "Payout hold" },
  { value: "kyc", label: "KYC" },
  { value: "other", label: "Other" },
]

const PRIORITY_OPTIONS = [
  { value: "", label: "All priorities" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
]

const SUBJECT_TYPE_OPTIONS = [
  { value: "affiliate", label: "Affiliate" },
  { value: "partner", label: "Partner" },
  { value: "user", label: "User" },
]

/** Legal next states per the compliance.ts state machine. */
const NEXT_TRANSITIONS: Record<CaseStatus, { to: CaseStatus; label: string }[]> = {
  open: [{ to: "investigating", label: "Start investigating" }],
  investigating: [
    { to: "resolved", label: "Resolve" },
    { to: "dismissed", label: "Dismiss" },
  ],
  resolved: [],
  dismissed: [],
}

function statusLabel(status: CaseStatus): string {
  if (status === "investigating") return "Investigating"
  return status[0].toUpperCase() + status.slice(1)
}

function statusVariant(status: CaseStatus): "destructive" | "secondary" | "outline" {
  if (status === "open") return "destructive"
  if (status === "investigating") return "secondary"
  return "outline"
}

function priorityVariant(priority: CasePriority): "destructive" | "secondary" | "outline" {
  if (priority === "high") return "destructive"
  if (priority === "medium") return "secondary"
  return "outline"
}

function typeLabel(type: CaseType): string {
  return TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(undefined, { dateStyle: "medium" })
}

function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

function formatCents(cents: number | undefined): string {
  return `$${((cents ?? 0) / 100).toFixed(2)}`
}

function countEntries(record: Record<string, number> | undefined): [string, number][] {
  return Object.entries(record ?? {}).sort((a, b) => b[1] - a[1])
}

function currentMonth(): string {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, "0")
  return `${now.getFullYear()}-${month}`
}

function selectValue(value: string | string[] | null): string {
  return typeof value === "string" ? value : ""
}

export function ComplianceScreen() {
  // ---- Cases state ----
  const [cases, setCases] = useState<ComplianceCaseRow[] | null>(null)
  const [casesTotal, setCasesTotal] = useState(0)
  const [statusFilter, setStatusFilter] = useState("")
  const [typeFilter, setTypeFilter] = useState("")
  const [priorityFilter, setPriorityFilter] = useState("")
  const [casesError, setCasesError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const expandedIdRef = useRef<string | null>(null)
  const [detail, setDetail] = useState<ComplianceCaseRow | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [noteDraft, setNoteDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({
    type: "fraud_review" as CaseType,
    subjectType: "affiliate" as SubjectType,
    subjectId: "",
    priority: "medium" as CasePriority,
    note: "",
  })
  const requestSeq = useRef(0)

  // ---- Report state ----
  const [period, setPeriod] = useState(currentMonth)
  const [report, setReport] = useState<ProgramReport | null>(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError, setReportError] = useState<string | null>(null)

  const loadCases = useCallback(async () => {
    const seq = ++requestSeq.current
    setCases(null)
    setCasesError(null)
    try {
      const params = new URLSearchParams()
      if (statusFilter) params.set("status", statusFilter)
      if (typeFilter) params.set("type", typeFilter)
      if (priorityFilter) params.set("priority", priorityFilter)
      const query = params.toString()
      const response = await fetch(`${CASES_API}${query ? `?${query}` : ""}`, {
        cache: "no-store",
      })
      const data = (await response.json()) as CasesResponse
      if (seq !== requestSeq.current) return
      if (!response.ok || !data.ok) {
        setCasesError(data.message ?? "Could not load compliance cases.")
        setCases([])
        return
      }
      setCases(data.cases ?? [])
      setCasesTotal(data.total ?? 0)
    } catch {
      if (seq !== requestSeq.current) return
      setCasesError("Could not load compliance cases. Check your connection and try again.")
      setCases([])
    }
  }, [statusFilter, typeFilter, priorityFilter])

  useEffect(() => {
    void loadCases()
  }, [loadCases])

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true)
    try {
      const response = await fetch(`${CASES_API}/${encodeURIComponent(id)}`, {
        cache: "no-store",
      })
      const data = (await response.json()) as {
        ok: boolean
        case?: ComplianceCaseRow
        message?: string
      }
      // Ignore stale responses when the user has since expanded another case.
      if (expandedIdRef.current !== id) return
      if (!response.ok || !data.ok || !data.case) {
        setCasesError(data.message ?? "Could not load the case.")
        return
      }
      setDetail(data.case)
    } catch {
      setCasesError("Could not load the case. Check your connection and try again.")
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const toggleExpand = useCallback(
    (record: ComplianceCaseRow) => {
      if (expandedId === record.id) {
        expandedIdRef.current = null
        setExpandedId(null)
        setDetail(null)
        setNoteDraft("")
        return
      }
      expandedIdRef.current = record.id
      setExpandedId(record.id)
      setDetail(record) // show list-row data immediately; refresh with notes below
      void loadDetail(record.id)
      setNoteDraft("")
    },
    [expandedId, loadDetail],
  )

  const patchCase = useCallback(
    async (id: string, payload: Record<string, unknown>) => {
      setBusy(true)
      setCasesError(null)
      try {
        const response = await fetch(`${CASES_API}/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        })
        const data = (await response.json()) as {
          ok: boolean
          case?: ComplianceCaseRow
          message?: string
        }
        if (!response.ok || !data.ok || !data.case) {
          setCasesError(data.message ?? "Could not update the case.")
          return false
        }
        setDetail(data.case)
        // Refresh the list so status filters stay accurate.
        await loadCases()
        return true
      } catch {
        setCasesError("Could not update the case. Check your connection and try again.")
        return false
      } finally {
        setBusy(false)
      }
    },
    [loadCases],
  )

  const addNote = useCallback(async () => {
    if (!detail || !noteDraft.trim()) return
    const okResult = await patchCase(detail.id, { action: "add_note", body: noteDraft.trim() })
    if (okResult) setNoteDraft("")
  }, [detail, noteDraft, patchCase])

  const transition = useCallback(
    async (to: CaseStatus) => {
      if (!detail) return
      await patchCase(detail.id, { action: "transition", to })
    },
    [detail, patchCase],
  )

  const createCase = useCallback(async () => {
    setBusy(true)
    setCasesError(null)
    try {
      const response = await fetch(CASES_API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: createForm.type,
          subjectType: createForm.subjectType,
          subjectId: createForm.subjectId.trim(),
          priority: createForm.priority,
          ...(createForm.note.trim() ? { note: createForm.note.trim() } : {}),
        }),
      })
      const data = (await response.json()) as {
        ok: boolean
        case?: ComplianceCaseRow
        message?: string
      }
      if (!response.ok || !data.ok) {
        setCasesError(data.message ?? "Could not create the case.")
        return
      }
      setShowCreate(false)
      setCreateForm({
        type: "fraud_review",
        subjectType: "affiliate",
        subjectId: "",
        priority: "medium",
        note: "",
      })
      await loadCases()
    } catch {
      setCasesError("Could not create the case. Check your connection and try again.")
    } finally {
      setBusy(false)
    }
  }, [createForm, loadCases])

  const loadReport = useCallback(async () => {
    setReportLoading(true)
    setReportError(null)
    try {
      const response = await fetch(`${REPORT_API}?period=${encodeURIComponent(period)}`, {
        cache: "no-store",
      })
      const data = (await response.json()) as ReportResponse
      if (!response.ok || !data.ok || !data.report) {
        setReportError(data.message ?? "Could not load the compliance report.")
        setReport(null)
        return
      }
      setReport(data.report)
    } catch {
      setReportError("Could not load the compliance report. Check your connection and try again.")
      setReport(null)
    } finally {
      setReportLoading(false)
    }
  }, [period])

  // Load once on mount; the period picker requires an explicit reload click.
  useEffect(() => {
    void loadReport()
  }, [])

  const csvHref = `${REPORT_API}?period=${encodeURIComponent(period)}&format=csv`
  const casesLoading = cases === null && casesError === null

  return (
    <div className="space-y-6">
      {/* ---------------- Cases ---------------- */}
      <section className="app-panel" aria-labelledby="admin-compliance-cases-heading">
        <div className="app-panel-head">
          <div>
            <h2 id="admin-compliance-cases-heading">Compliance cases</h2>
            <p>
              Investigations opened against affiliates, partners, and users. Cases move open →
              investigating → resolved or dismissed; notes are append-only.
            </p>
          </div>
          <div className="app-panel-head-actions">
            <Button
              type="button"
              size="sm"
              variant={showCreate ? "outline" : "default"}
              onClick={() => setShowCreate((v) => !v)}
            >
              <Plus aria-hidden="true" className="size-4" />
              New case
            </Button>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="w-44">
            <Label htmlFor="compliance-filter-status" className="text-xs">
              Status
            </Label>
            <Select
              id="compliance-filter-status"
              aria-label="Filter by status"
              options={STATUS_OPTIONS}
              value={statusFilter}
              onChange={(v) => setStatusFilter(selectValue(v))}
            />
          </div>
          <div className="w-48">
            <Label htmlFor="compliance-filter-type" className="text-xs">
              Type
            </Label>
            <Select
              id="compliance-filter-type"
              aria-label="Filter by type"
              options={TYPE_OPTIONS}
              value={typeFilter}
              onChange={(v) => setTypeFilter(selectValue(v))}
            />
          </div>
          <div className="w-40">
            <Label htmlFor="compliance-filter-priority" className="text-xs">
              Priority
            </Label>
            <Select
              id="compliance-filter-priority"
              aria-label="Filter by priority"
              options={PRIORITY_OPTIONS}
              value={priorityFilter}
              onChange={(v) => setPriorityFilter(selectValue(v))}
            />
          </div>
        </div>

        {showCreate ? (
          <div className="mb-4 rounded-md border p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <Label htmlFor="compliance-new-type" className="text-xs">
                  Type
                </Label>
                <Select
                  id="compliance-new-type"
                  aria-label="Case type"
                  options={TYPE_OPTIONS.filter((o) => o.value !== "")}
                  value={createForm.type}
                  onChange={(v) =>
                    setCreateForm((f) => ({ ...f, type: selectValue(v) as CaseType }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="compliance-new-subject-type" className="text-xs">
                  Subject type
                </Label>
                <Select
                  id="compliance-new-subject-type"
                  aria-label="Subject type"
                  options={SUBJECT_TYPE_OPTIONS}
                  value={createForm.subjectType}
                  onChange={(v) =>
                    setCreateForm((f) => ({ ...f, subjectType: selectValue(v) as SubjectType }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="compliance-new-subject-id" className="text-xs">
                  Subject ID
                </Label>
                <Input
                  id="compliance-new-subject-id"
                  value={createForm.subjectId}
                  onChange={(e) => setCreateForm((f) => ({ ...f, subjectId: e.target.value }))}
                  placeholder="aff_… / user_… / partner id"
                />
              </div>
              <div>
                <Label htmlFor="compliance-new-priority" className="text-xs">
                  Priority
                </Label>
                <Select
                  id="compliance-new-priority"
                  aria-label="Priority"
                  options={PRIORITY_OPTIONS.filter((o) => o.value !== "")}
                  value={createForm.priority}
                  onChange={(v) =>
                    setCreateForm((f) => ({ ...f, priority: selectValue(v) as CasePriority }))
                  }
                />
              </div>
            </div>
            <div className="mt-3">
              <Label htmlFor="compliance-new-note" className="text-xs">
                Initial note (optional)
              </Label>
              <Textarea
                id="compliance-new-note"
                value={createForm.note}
                onChange={(e) => setCreateForm((f) => ({ ...f, note: e.target.value }))}
                rows={2}
              />
            </div>
            <div className="mt-3 flex justify-end">
              <Button
                type="button"
                size="sm"
                disabled={busy || !createForm.subjectId.trim()}
                onClick={() => void createCase()}
              >
                Create case
              </Button>
            </div>
          </div>
        ) : null}

        {casesError ? (
          <InlineError
            title="Compliance cases unavailable"
            message={
              <span className="flex flex-wrap items-center gap-2">
                <span>{casesError}</span>
                <Button type="button" variant="outline" size="sm" onClick={() => void loadCases()}>
                  Retry
                </Button>
              </span>
            }
          />
        ) : null}

        {casesLoading ? (
          <LoadingPanel label="Loading compliance cases" variant="table" />
        ) : cases !== null && cases.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Case</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cases.map((record) => {
                const expanded = expandedId === record.id
                const shown = expanded && detail?.id === record.id ? detail : record
                const next = NEXT_TRANSITIONS[shown.status]
                return (
                  <Fragment key={record.id}>
                    <TableRow>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-expanded={expanded}
                          aria-label={expanded ? "Collapse case" : "Expand case"}
                          onClick={() => toggleExpand(record)}
                        >
                          {expanded ? (
                            <ChevronDown aria-hidden="true" className="size-4" />
                          ) : (
                            <ChevronRight aria-hidden="true" className="size-4" />
                          )}
                        </Button>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{typeLabel(record.type)}</div>
                        <div className="text-muted-foreground text-xs">{record.id}</div>
                      </TableCell>
                      <TableCell>
                        <div>{record.subjectId}</div>
                        <div className="text-muted-foreground text-xs">{record.subjectType}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={priorityVariant(record.priority)}>{record.priority}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(record.status)}>
                          {statusLabel(record.status)}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatDate(record.updatedAt)}</TableCell>
                    </TableRow>
                    {expanded ? (
                      <TableRow>
                        <TableCell colSpan={6} className="bg-muted/30">
                          {detailLoading && !detail ? (
                            <LoadingPanel label="Loading case detail" variant="table" />
                          ) : detail ? (
                            <div className="space-y-4 py-2">
                              <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
                                <span>Opened {formatDateTime(detail.createdAt)}</span>
                                {detail.resolvedAt ? (
                                  <span>· resolved {formatDateTime(detail.resolvedAt)}</span>
                                ) : null}
                                <span>
                                  · {detail.notes.length} note{detail.notes.length === 1 ? "" : "s"}
                                </span>
                              </div>

                              <ul className="space-y-2">
                                {detail.notes.map((note) => (
                                  <li
                                    key={note.id}
                                    className="bg-background rounded-md border p-3 text-sm"
                                  >
                                    <div className="text-muted-foreground mb-1 flex flex-wrap items-center gap-2 text-xs">
                                      <Badge
                                        variant={
                                          note.kind === "transition" ? "secondary" : "outline"
                                        }
                                      >
                                        {note.kind === "transition" ? "transition" : "note"}
                                      </Badge>
                                      <span className="text-foreground font-medium">
                                        {note.actorId}
                                      </span>
                                      <span>{formatDateTime(note.at)}</span>
                                    </div>
                                    <p className="whitespace-pre-wrap">{note.body}</p>
                                  </li>
                                ))}
                                {detail.notes.length === 0 ? (
                                  <li className="text-muted-foreground text-sm">No notes yet.</li>
                                ) : null}
                              </ul>

                              <div className="flex flex-col gap-2 sm:flex-row">
                                <Textarea
                                  aria-label="Add a note"
                                  placeholder="Add a note…"
                                  value={noteDraft}
                                  onChange={(e) => setNoteDraft(e.target.value)}
                                  rows={2}
                                  className="flex-1"
                                />
                                <div className="flex items-end gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={busy || !noteDraft.trim()}
                                    onClick={() => void addNote()}
                                  >
                                    Add note
                                  </Button>
                                  {next.map((transitionOption) => (
                                    <Button
                                      key={transitionOption.to}
                                      type="button"
                                      size="sm"
                                      variant={
                                        transitionOption.to === "resolved"
                                          ? "default"
                                          : transitionOption.to === "dismissed"
                                            ? "destructive"
                                            : "outline"
                                      }
                                      disabled={busy}
                                      onClick={() => void transition(transitionOption.to)}
                                    >
                                      {transitionOption.label}
                                    </Button>
                                  ))}
                                </div>
                              </div>
                            </div>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        ) : casesError ? null : (
          <EmptyState
            icon={<Scale aria-hidden="true" />}
            title="No compliance cases"
            body="Open a case to investigate an affiliate, partner, or user."
          />
        )}
        {cases !== null ? (
          <p className="text-muted-foreground mt-3 text-xs">
            {casesTotal} case{casesTotal === 1 ? "" : "s"} in this view.
          </p>
        ) : null}
      </section>

      {/* ---------------- Report ---------------- */}
      <section className="app-panel" aria-labelledby="admin-compliance-report-heading">
        <div className="app-panel-head">
          <div>
            <h2 id="admin-compliance-report-heading">Program compliance report</h2>
            <p>
              Aggregates across affiliates, cases, fraud flags, commissions, payouts, and tax forms
              for the selected period.
            </p>
          </div>
          <div className="app-panel-head-actions">
            <div className="flex items-end gap-2">
              <div>
                <Label htmlFor="compliance-report-period" className="text-xs">
                  Month
                </Label>
                <Input
                  id="compliance-report-period"
                  type="month"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                  className="w-40"
                />
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={reportLoading}
                onClick={() => void loadReport()}
              >
                <FileSearch aria-hidden="true" className="size-4" />
                {reportLoading ? "Loading…" : "Load report"}
              </Button>
              <Button type="button" size="sm" variant="outline" asChild>
                <a href={csvHref} download>
                  <Download aria-hidden="true" className="size-4" />
                  Audit CSV
                </a>
              </Button>
            </div>
          </div>
        </div>

        {reportError ? (
          <InlineError
            title="Report unavailable"
            message={
              <span className="flex flex-wrap items-center gap-2">
                <span>{reportError}</span>
                <Button type="button" variant="outline" size="sm" onClick={() => void loadReport()}>
                  Retry
                </Button>
              </span>
            }
          />
        ) : null}

        {reportLoading && !report ? (
          <LoadingPanel label="Loading compliance report" variant="table" />
        ) : report ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ReportCard
              title="Affiliates"
              icon={<ClipboardList aria-hidden="true" className="size-4" />}
            >
              <StatLine label="Total" value={String(report.affiliates.total)} />
              {countEntries(report.affiliates.byStatus).map(([key, value]) => (
                <StatLine key={key} label={key} value={String(value)} />
              ))}
              <StatLine
                label="Created in period"
                value={String(report.affiliates.createdInPeriod)}
              />
            </ReportCard>

            <ReportCard
              title="Compliance cases"
              icon={<Scale aria-hidden="true" className="size-4" />}
            >
              <StatLine label="Total" value={String(report.cases.total)} />
              {countEntries(report.cases.byStatus).map(([key, value]) => (
                <StatLine key={key} label={key} value={String(value)} />
              ))}
              <StatLine label="Open by type" value={JSON.stringify(report.cases.openByType)} />
              <StatLine
                label="Open by priority"
                value={JSON.stringify(report.cases.openByPriority)}
              />
            </ReportCard>

            <ReportCard title="Fraud flags" icon={<Scale aria-hidden="true" className="size-4" />}>
              <StatLine label="Total" value={String(report.fraudFlags.total)} />
              {countEntries(report.fraudFlags.byStatus).map(([key, value]) => (
                <StatLine key={key} label={key} value={String(value)} />
              ))}
              <StatLine
                label="Scanned in period"
                value={String(report.fraudFlags.scannedInPeriod)}
              />
            </ReportCard>

            <ReportCard title="Commissions" icon={<Scale aria-hidden="true" className="size-4" />}>
              <StatLine label="Records" value={String(report.commissions.total)} />
              {countEntries(report.commissions.amountCentsByStatus).map(([key, value]) => (
                <StatLine key={key} label={key} value={formatCents(value)} />
              ))}
            </ReportCard>

            <ReportCard
              title="Payouts (simulated)"
              icon={<Scale aria-hidden="true" className="size-4" />}
            >
              <StatLine label="Runs" value={String(report.payouts.runsTotal)} />
              {countEntries(report.payouts.runsByStatus).map(([key, value]) => (
                <StatLine key={key} label={`run: ${key}`} value={String(value)} />
              ))}
              <StatLine label="Items" value={String(report.payouts.itemsTotal)} />
              {countEntries(report.payouts.itemsAmountCentsByStatus).map(([key, value]) => (
                <StatLine key={key} label={`item: ${key}`} value={formatCents(value)} />
              ))}
            </ReportCard>

            <ReportCard title="Tax forms" icon={<Scale aria-hidden="true" className="size-4" />}>
              <StatLine label="Records" value={String(report.taxForms.total)} />
              {countEntries(report.taxForms.byStatus).map(([key, value]) => (
                <StatLine key={key} label={key} value={String(value)} />
              ))}
            </ReportCard>
          </div>
        ) : null}
      </section>
    </div>
  )
}

function ReportCard({
  title,
  icon,
  children,
}: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="rounded-md border p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
      </div>
      <dl className="space-y-1 text-sm">{children}</dl>
    </div>
  )
}

function StatLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground capitalize">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}
