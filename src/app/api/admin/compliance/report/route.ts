import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/admin-guard"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { fail, ok } from "@/lib/auth/http"
import {
  ComplianceError,
  generateAuditTrailCsv,
  generateProgramComplianceReport,
  type CompliancePeriod,
} from "@/lib/compliance"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * /api/admin/compliance/report
 *
 * GET — program compliance reporting.
 *   `?period=` selects the reporting window: `all` (default), `YYYY`,
 *   `YYYY-MM`, or `YYYY-MM-DD` (UTC bounds; start inclusive, end exclusive).
 *   `?format=json` (default) returns the aggregated
 *   `generateProgramComplianceReport` payload; `?format=csv` returns a
 *   `text/csv` attachment of the case audit trail
 *   (`generateAuditTrailCsv`) for the same period.
 *
 * Admin-only via `requireAdmin`, rate limited (publicRead tier — GETs only).
 * All data comes from the in-memory dev seams described in
 * `src/lib/compliance.ts`.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

function parsePeriod(raw: string | null): CompliancePeriod | undefined | null {
  const value = raw?.trim() ?? ""
  if (!value || value === "all") return undefined

  let match = /^(\d{4})$/.exec(value)
  if (match) {
    const year = Number(match[1])
    return {
      start: new Date(Date.UTC(year, 0, 1)).toISOString(),
      end: new Date(Date.UTC(year + 1, 0, 1)).toISOString(),
    }
  }
  match = /^(\d{4})-(\d{2})$/.exec(value)
  if (match) {
    const year = Number(match[1])
    const month = Number(match[2])
    if (month < 1 || month > 12) return null
    return {
      start: new Date(Date.UTC(year, month - 1, 1)).toISOString(),
      end: new Date(Date.UTC(year, month, 1)).toISOString(),
    }
  }
  match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (match) {
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
    const start = Date.UTC(year, month - 1, day)
    const probe = new Date(start)
    // Reject rolled-over dates like 2025-02-31.
    if (
      probe.getUTCFullYear() !== year ||
      probe.getUTCMonth() !== month - 1 ||
      probe.getUTCDate() !== day
    ) {
      return null
    }
    return {
      start: new Date(start).toISOString(),
      end: new Date(start + 24 * 60 * 60 * 1000).toISOString(),
    }
  }
  return null
}

export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const params = new URL(request.url).searchParams
  const period = parsePeriod(params.get("period"))
  if (period === null) {
    return fail(400, "invalid_request", "period must be one of: all, YYYY, YYYY-MM, or YYYY-MM-DD.")
  }

  const format = params.get("format")?.trim() ?? "json"
  if (format !== "json" && format !== "csv") {
    return fail(400, "invalid_request", "format must be one of: json, csv.")
  }

  try {
    if (format === "csv") {
      const csv = generateAuditTrailCsv({ period })
      const label = params.get("period")?.trim() || "all"
      return new NextResponse(csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="compliance-audit-${label}.csv"`,
        },
      })
    }
    const report = generateProgramComplianceReport({ period })
    return ok({ report })
  } catch (error) {
    if (error instanceof ComplianceError) {
      return fail(400, "invalid_request", error.message)
    }
    return fail(500, "internal", "Could not generate the compliance report.")
  }
}
