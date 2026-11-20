import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAdmin } from "@/lib/admin-guard"
import { listAffiliates } from "@/lib/affiliate"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import {
  TAX_FORM_STATUSES,
  TAX_FORM_TYPES,
  TAX_YEAR_MAX,
  TAX_YEAR_MIN,
  TaxFormNotFoundError,
  TaxFormValidationError,
  exportTaxSummaryCsv,
  generate1099ForAffiliate,
  listTaxForms,
  type TaxFormStatus,
  type TaxFormType,
} from "@/lib/tax-forms"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * /api/admin/tax-forms
 *
 * GET  — tax form records, newest first. Filters: `?affiliateId=`,
 *        `?formType=w9|1099-nec`, `?year=`, `?status=draft|submitted|
 *        on_file`. With `?format=csv&year=YYYY` returns a `text/csv`
 *        attachment of every affiliate's simulated annual totals (admin
 *        export).
 * POST — generate (or regenerate) the SIMULATED 1099-NEC for an
 *        affiliate+year: `{ affiliateId, year }`. Upserts the single
 *        `1099-nec` record for that pair (status `draft`, or stays
 *        `on_file`). NO real IRS filing/e-file occurs.
 *
 * Admin-only via `requireAdmin`, same-origin enforced on POST, rate
 * limited. The store is the in-memory dev seam in `src/lib/tax-forms.ts`.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const postSchema = z.object({
  affiliateId: z.string().trim().min(1, "affiliateId is required."),
  year: z
    .number()
    .int("year must be an integer.")
    .min(TAX_YEAR_MIN, `year must be at least ${TAX_YEAR_MIN}.`)
    .max(TAX_YEAR_MAX, `year must be at most ${TAX_YEAR_MAX}.`),
})

function isTaxFormType(value: string | null): value is TaxFormType {
  return value !== null && (TAX_FORM_TYPES as readonly string[]).includes(value)
}

function isTaxFormStatus(value: string | null): value is TaxFormStatus {
  return value !== null && (TAX_FORM_STATUSES as readonly string[]).includes(value)
}

export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const params = new URL(request.url).searchParams

  if (params.get("format") === "csv") {
    const yearParam = params.get("year")
    const year = yearParam === null ? NaN : Number(yearParam)
    try {
      const csv = exportTaxSummaryCsv(year)
      return new NextResponse(csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="tax-summary-${year}.csv"`,
          "cache-control": "no-store",
        },
      })
    } catch (error) {
      if (error instanceof TaxFormValidationError) {
        return fail(400, "invalid_request", error.message)
      }
      throw error
    }
  }

  const formTypeParam = params.get("formType")
  const statusParam = params.get("status")
  const formType = isTaxFormType(formTypeParam) ? formTypeParam : undefined
  const status = isTaxFormStatus(statusParam) ? statusParam : undefined
  const yearParam = params.get("year")
  const year = yearParam !== null && /^\d{4}$/.test(yearParam) ? Number(yearParam) : undefined
  const affiliateId = params.get("affiliateId")?.trim() || undefined

  return ok({ forms: listTaxForms({ affiliateId, formType, year, status }) })
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Request body must be JSON.")
  }

  const parsed = postSchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request."
    return fail(400, "invalid_request", message)
  }

  const { affiliateId, year } = parsed.data

  // The affiliate store has no get-by-id; it is bounded (500 accounts), so a
  // linear scan is cheap and keeps tax-forms.ts decoupled from internals.
  const affiliateExists = listAffiliates().some((account) => account.id === affiliateId)
  if (!affiliateExists) {
    return fail(400, "invalid_request", "affiliateId does not match an affiliate account.")
  }

  try {
    const result = generate1099ForAffiliate(affiliateId, year)
    return ok({ form: result.record, data: result.data })
  } catch (error) {
    if (error instanceof TaxFormValidationError || error instanceof TaxFormNotFoundError) {
      return fail(400, "invalid_request", error.message)
    }
    throw error
  }
}
