import { NextResponse } from "next/server"

import { parseCspReports } from "@/lib/csp-report"
import { logger } from "@/lib/logger"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** CSP reports are small; anything larger is not a browser report. */
const MAX_BODY_BYTES = 256 * 1024
/** Cap how many violations we log per request to bound log volume. */
const MAX_LOGGED_PER_REQUEST = 50

/**
 * CSP violation collector (see docs/security/csp-reporting.md).
 *
 * Browsers POST here when the policy carries `report-uri` (legacy
 * `application/csp-report`, `{"csp-report": {...}}`) or `report-to`
 * (`application/reports+json`, array of `{type:"csp-violation", body:{…}}`).
 *
 * Violations are emitted as structured `csp.violation` log events — the log
 * pipeline (stdout → collector → JSONL/analysis) is the store; no DB writes.
 * Always answers 204 so browsers neither retry nor surface errors.
 */
export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? "0")
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return new Response(null, { status: 204 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return new Response(null, { status: 204 })
  }

  const violations = parseCspReports(body)
  const logged = violations.slice(0, MAX_LOGGED_PER_REQUEST)

  for (const v of logged) {
    logger.info(
      {
        event: "csp.violation",
        format: v.format,
        directive: v.directive,
        blockedUri: v.blockedUri,
        documentUri: v.documentUri,
        disposition: v.disposition,
        sourceFile: v.sourceFile,
        lineNumber: v.lineNumber,
        columnNumber: v.columnNumber,
        sample: v.sample,
        referrer: v.referrer,
        statusCode: v.statusCode,
      },
      "CSP violation reported",
    )
  }

  if (violations.length > MAX_LOGGED_PER_REQUEST) {
    logger.warn(
      { event: "csp.violation.truncated", received: violations.length, logged: logged.length },
      "CSP report batch exceeded per-request log cap",
    )
  }

  return new Response(null, { status: 204 })
}

// Report collectors must never be cached or prerendered.
export async function GET() {
  return NextResponse.json({ error: "method not allowed" }, { status: 405 })
}
