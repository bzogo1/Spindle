"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { FileText } from "lucide-react"

import { ErrorState } from "@/components/app/states/error-state"
import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"

/**
 * Partner "Tax forms" section, mountable inside the partner portal (task
 * 96) or standalone at `/app/partner/tax`. Backed by
 * `GET/POST /api/partner/tax-forms`.
 *
 * The W-9 form collects ONLY non-sensitive fields — name, business name,
 * tax classification, and a `tinProvided` boolean. There is deliberately
 * no input for a TIN/SSN/EIN: the API schema is strict and the library
 * has no field that could store one. The partner completes the real W-9
 * through the official IRS form; this scaffolding only tracks status.
 * 1099-NEC records are admin-generated simulations — partners cannot
 * create them.
 */

const TAX_FORMS_API = "/api/partner/tax-forms"

export type PartnerTaxFormType = "w9" | "1099-nec"
export type PartnerTaxFormStatus = "draft" | "submitted" | "on_file"
export type W9TaxClassification =
  "individual" | "llc" | "s_corp" | "c_corp" | "partnership" | "other"

export interface PartnerTaxFormRow {
  id: string
  formType: PartnerTaxFormType
  year?: number
  status: PartnerTaxFormStatus
  createdAt: string
  updatedAt: string
}

export interface PartnerW9Draft {
  affiliateId: string
  name: string
  businessName?: string
  taxClassification: W9TaxClassification
  tinProvided: boolean
}

interface TaxFormsResponse {
  ok: boolean
  forms?: PartnerTaxFormRow[]
  w9?: PartnerW9Draft
  message?: string
}

const CLASSIFICATION_OPTIONS = [
  { value: "individual", label: "Individual" },
  { value: "llc", label: "LLC" },
  { value: "s_corp", label: "S corporation" },
  { value: "c_corp", label: "C corporation" },
  { value: "partnership", label: "Partnership" },
  { value: "other", label: "Other" },
]

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(undefined, { dateStyle: "medium" })
}

function formTypeLabel(formType: PartnerTaxFormType): string {
  return formType === "1099-nec" ? "1099-NEC" : "W-9"
}

export function PartnerTaxFormsSection() {
  const [forms, setForms] = useState<PartnerTaxFormRow[] | null>(null)
  const [w9, setW9] = useState<PartnerW9Draft | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const seq = useRef(0)

  // W-9 draft form state.
  const [name, setName] = useState("")
  const [businessName, setBusinessName] = useState("")
  const [classification, setClassification] = useState<W9TaxClassification>("individual")
  const [tinProvided, setTinProvided] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitNotice, setSubmitNotice] = useState<string | null>(null)
  const [draftLoaded, setDraftLoaded] = useState(false)

  const load = useCallback(async () => {
    const current = ++seq.current
    setForms(null)
    setLoadError(null)
    try {
      const response = await fetch(TAX_FORMS_API, { cache: "no-store" })
      const data = (await response.json()) as TaxFormsResponse
      if (current !== seq.current) return
      if (!response.ok || !data.ok) {
        setLoadError(data.message ?? "Could not load tax forms.")
        return
      }
      setForms(data.forms ?? [])
      if (data.w9) {
        setW9(data.w9)
        if (!draftLoaded) {
          setName(data.w9.name)
          setBusinessName(data.w9.businessName ?? "")
          setClassification(data.w9.taxClassification)
          setTinProvided(data.w9.tinProvided)
          setDraftLoaded(true)
        }
      }
    } catch {
      if (current === seq.current) setLoadError("Could not load tax forms.")
    }
  }, [draftLoaded])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  const submitW9 = async () => {
    setSubmitting(true)
    setSubmitError(null)
    setSubmitNotice(null)
    try {
      const response = await fetch(TAX_FORMS_API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || undefined,
          businessName: businessName.trim() || undefined,
          taxClassification: classification,
          tinProvided,
        }),
      })
      const data = (await response.json()) as TaxFormsResponse
      if (!response.ok || !data.ok) {
        setSubmitError(data.message ?? "Could not submit the W-9.")
        return
      }
      if (data.w9) setW9(data.w9)
      setSubmitNotice(
        "W-9 details saved. Complete the official form with your TIN — it is never collected here.",
      )
      setReloadKey((key) => key + 1)
    } catch {
      setSubmitError("Could not submit the W-9.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="size-4" aria-hidden="true" />
            W-9 details
          </CardTitle>
          <CardDescription>
            Non-sensitive tax classification details only. Your TIN/SSN/EIN is never collected or
            stored — complete the official IRS W-9 form separately.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {w9 ? (
            <p className="text-muted-foreground text-sm">
              Status:{" "}
              <Badge variant="secondary" className="capitalize">
                {w9.tinProvided ? "TIN indicated on file" : "TIN not indicated"}
              </Badge>
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="w9-name">Legal name</Label>
              <Input
                id="w9-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="As it appears on your tax return"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="w9-business">Business name (optional)</Label>
              <Input
                id="w9-business"
                value={businessName}
                onChange={(event) => setBusinessName(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="w9-classification">Tax classification</Label>
              <Select
                aria-label="Tax classification"
                options={CLASSIFICATION_OPTIONS}
                value={classification}
                onChange={(value) =>
                  setClassification((value as W9TaxClassification) ?? "individual")
                }
              />
            </div>
            <div className="flex items-end gap-2 pb-1">
              <input
                id="w9-tin-provided"
                type="checkbox"
                className="size-4"
                checked={tinProvided}
                onChange={(event) => setTinProvided(event.target.checked)}
              />
              <Label htmlFor="w9-tin-provided" className="font-normal">
                I have a TIN on file with the partner program
              </Label>
            </div>
          </div>
          {submitError ? <InlineError message={submitError} /> : null}
          {submitNotice ? <p className="text-muted-foreground text-sm">{submitNotice}</p> : null}
          <div>
            <Button type="button" size="sm" disabled={submitting} onClick={() => void submitW9()}>
              {submitting ? "Saving…" : "Save W-9 details"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tax form records</CardTitle>
          <CardDescription>
            W-9 submissions and 1099-NEC records generated by the partner team.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {forms === null && !loadError ? (
            <LoadingPanel label="Loading tax forms" className="min-h-24">
              <div className="bg-muted h-16 animate-pulse rounded-lg" />
            </LoadingPanel>
          ) : null}
          {loadError ? (
            <ErrorState
              title="Tax forms unavailable"
              message={loadError}
              onRetry={() => setReloadKey((key) => key + 1)}
            />
          ) : null}
          {forms !== null && forms.length === 0 && !loadError ? (
            <p className="text-muted-foreground text-sm">
              No tax forms yet — submit your W-9 details above.
            </p>
          ) : null}
          {forms !== null && forms.length > 0 ? (
            <ul className="divide-y">
              {forms.map((form) => (
                <li key={form.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div>
                    <span className="font-medium">{formTypeLabel(form.formType)}</span>
                    {form.year ? (
                      <span className="text-muted-foreground text-sm"> · {form.year}</span>
                    ) : null}
                    <span className="text-muted-foreground block text-xs">
                      Updated {formatDate(form.updatedAt)}
                    </span>
                  </div>
                  <Badge variant="outline" className="capitalize">
                    {form.status.replace("_", " ")}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
