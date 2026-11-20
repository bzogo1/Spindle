"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { FileText } from "lucide-react"

import { EmptyState } from "@/components/app/states/empty-state"
import { ErrorState } from "@/components/app/states/error-state"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
 * Admin "Tax forms" screen for `/app/admin/tax-forms`: tax form records
 * backed by `GET/POST /api/admin/tax-forms` plus the `?format=csv` annual
 * export. 1099-NEC generation is SIMULATED — no real IRS filing occurs.
 * See `src/lib/tax-forms.ts` for the status machine and upsert rules.
 */

const TAX_FORMS_API = "/api/admin/tax-forms"

export type TaxFormType = "w9" | "1099-nec"
export type TaxFormStatus = "draft" | "submitted" | "on_file"

export interface TaxFormRow {
  id: string
  affiliateId: string
  formType: TaxFormType
  year?: number
  status: TaxFormStatus
  createdAt: string
  updatedAt: string
}

interface TaxFormsResponse {
  ok: boolean
  forms?: TaxFormRow[]
  form?: TaxFormRow
  data?: { totalPaidCents: number }
  message?: string
}

const FORM_TYPE_OPTIONS = [
  { value: "all", label: "All form types" },
  { value: "w9", label: "W-9" },
  { value: "1099-nec", label: "1099-NEC" },
]

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "on_file", label: "On file" },
]

function statusBadgeVariant(status: TaxFormStatus) {
  switch (status) {
    case "submitted":
      return "secondary" as const
    case "draft":
      return "default" as const
    case "on_file":
      return "outline" as const
  }
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(undefined, { dateStyle: "medium" })
}

function formatFormType(formType: TaxFormType): string {
  return formType === "1099-nec" ? "1099-NEC" : "W-9"
}

export function TaxFormsScreen() {
  const [formTypeFilter, setFormTypeFilter] = useState<TaxFormType | "all">("all")
  const [statusFilter, setStatusFilter] = useState<TaxFormStatus | "all">("all")
  const [affiliateFilter, setAffiliateFilter] = useState("")
  const [yearFilter, setYearFilter] = useState("")
  const [rows, setRows] = useState<TaxFormRow[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const seq = useRef(0)

  // Generate-1099 form state.
  const [genAffiliateId, setGenAffiliateId] = useState("")
  const [genYear, setGenYear] = useState(String(new Date().getFullYear()))
  const [generating, setGenerating] = useState(false)
  const [csvYear, setCsvYear] = useState(String(new Date().getFullYear()))
  const [exporting, setExporting] = useState(false)

  const load = useCallback(async () => {
    const current = ++seq.current
    setRows(null)
    setListError(null)
    try {
      const params = new URLSearchParams()
      if (formTypeFilter !== "all") params.set("formType", formTypeFilter)
      if (statusFilter !== "all") params.set("status", statusFilter)
      const affiliateId = affiliateFilter.trim()
      if (affiliateId) params.set("affiliateId", affiliateId)
      const year = yearFilter.trim()
      if (year) params.set("year", year)
      const query = params.size > 0 ? `?${params.toString()}` : ""
      const response = await fetch(`${TAX_FORMS_API}${query}`, { cache: "no-store" })
      const data = (await response.json()) as TaxFormsResponse
      if (current !== seq.current) return
      if (!response.ok || !data.ok) {
        setListError(data.message ?? "Could not load tax forms.")
        return
      }
      setRows(data.forms ?? [])
    } catch {
      if (current === seq.current) setListError("Could not load tax forms.")
    }
  }, [formTypeFilter, statusFilter, affiliateFilter, yearFilter])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  const generate1099 = async () => {
    setGenerating(true)
    setActionError(null)
    setNotice(null)
    try {
      const response = await fetch(TAX_FORMS_API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          affiliateId: genAffiliateId.trim(),
          year: Number(genYear),
        }),
      })
      const data = (await response.json()) as TaxFormsResponse
      if (!response.ok || !data.ok) {
        setActionError(data.message ?? "Could not generate the 1099-NEC.")
        return
      }
      const cents = data.data?.totalPaidCents ?? 0
      setNotice(
        `Simulated 1099-NEC generated for ${genYear} — total paid $${(cents / 100).toFixed(2)}. No IRS filing occurs.`,
      )
      setReloadKey((key) => key + 1)
    } catch {
      setActionError("Could not generate the 1099-NEC.")
    } finally {
      setGenerating(false)
    }
  }

  const exportCsv = async () => {
    setExporting(true)
    setActionError(null)
    try {
      const response = await fetch(
        `${TAX_FORMS_API}?format=csv&year=${encodeURIComponent(csvYear.trim())}`,
        { cache: "no-store" },
      )
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as TaxFormsResponse | null
        setActionError(data?.message ?? "Could not export the CSV.")
        return
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = `tax-summary-${csvYear.trim()}.csv`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch {
      setActionError("Could not export the CSV.")
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 rounded-xl border p-4 sm:grid-cols-[1fr_7rem_auto] sm:items-end">
        <div className="grid gap-1.5">
          <Label htmlFor="tax-gen-affiliate">Generate 1099-NEC — affiliate id</Label>
          <Input
            id="tax-gen-affiliate"
            placeholder="aff_…"
            value={genAffiliateId}
            onChange={(event) => setGenAffiliateId(event.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="tax-gen-year">Tax year</Label>
          <Input
            id="tax-gen-year"
            inputMode="numeric"
            value={genYear}
            onChange={(event) => setGenYear(event.target.value)}
          />
        </div>
        <Button
          type="button"
          disabled={generating || !genAffiliateId.trim() || !genYear.trim()}
          onClick={() => void generate1099()}
        >
          {generating ? "Generating…" : "Generate 1099"}
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-36">
            <Select
              aria-label="Filter by form type"
              options={FORM_TYPE_OPTIONS}
              value={formTypeFilter}
              onChange={(value) => setFormTypeFilter((value as TaxFormType | "all") ?? "all")}
            />
          </div>
          <div className="w-36">
            <Select
              aria-label="Filter by status"
              options={STATUS_OPTIONS}
              value={statusFilter}
              onChange={(value) => setStatusFilter((value as TaxFormStatus | "all") ?? "all")}
            />
          </div>
          <div className="w-64">
            <Input
              aria-label="Filter by affiliate id"
              placeholder="Affiliate id (aff_…)"
              value={affiliateFilter}
              onChange={(event) => setAffiliateFilter(event.target.value)}
            />
          </div>
          <div className="w-28">
            <Input
              aria-label="Filter by tax year"
              placeholder="Year"
              inputMode="numeric"
              value={yearFilter}
              onChange={(event) => setYearFilter(event.target.value)}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-24">
            <Input
              aria-label="CSV export year"
              inputMode="numeric"
              value={csvYear}
              onChange={(event) => setCsvYear(event.target.value)}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={exporting || !csvYear.trim()}
            onClick={() => void exportCsv()}
          >
            {exporting ? "Exporting…" : "Export CSV"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setReloadKey((key) => key + 1)}
          >
            Refresh
          </Button>
        </div>
      </div>

      {notice ? <p className="text-muted-foreground text-sm">{notice}</p> : null}
      {actionError ? <ErrorState title="Action failed" message={actionError} /> : null}

      {rows === null && !listError ? (
        <LoadingPanel label="Loading tax forms" className="min-h-48">
          <div className="bg-muted h-64 animate-pulse rounded-xl" />
        </LoadingPanel>
      ) : null}

      {listError ? (
        <ErrorState
          title="Tax forms unavailable"
          message={listError}
          onRetry={() => setReloadKey((key) => key + 1)}
        />
      ) : null}

      {rows !== null && rows.length === 0 && !listError ? (
        <EmptyState
          icon={<FileText className="size-5" aria-hidden="true" />}
          title="No tax forms here"
          body="W-9 submissions and generated 1099-NEC records will appear here."
        />
      ) : null}

      {rows !== null && rows.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Affiliate</TableHead>
              <TableHead>Form</TableHead>
              <TableHead>Year</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
                    {row.affiliateId}
                  </code>
                </TableCell>
                <TableCell>{formatFormType(row.formType)}</TableCell>
                <TableCell>{row.year ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={statusBadgeVariant(row.status)} className="capitalize">
                    {row.status.replace("_", " ")}
                  </Badge>
                </TableCell>
                <TableCell>{formatDate(row.createdAt)}</TableCell>
                <TableCell>{formatDate(row.updatedAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </div>
  )
}
