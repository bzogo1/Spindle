/**
 * CSP violation report parsing and analysis (issue: CSP reporting rollout).
 *
 * Two wire formats reach a collector:
 *
 * 1. `report-uri` (legacy): the browser POSTs a single JSON object
 *    `{"csp-report": {...}}` with `application/csp-report` content type.
 * 2. `report-to` / Reporting API: the browser POSTs `application/reports+json`,
 *    typically an array of report objects `{type: "csp-violation", url,
 *    user_agent, age, body: {...}}`. The violation fields live under `body`
 *    with camelCase names (`documentURL`, `blockedURL`, `violatedDirective`, …).
 *
 * Both are normalised into `CspViolation` so analysis code has one shape.
 * See docs/security/csp-reporting.md for the endpoint and triage workflow.
 */

export interface CspViolation {
  /** e.g. "script-src" — the directive that was violated. */
  directive: string
  /** The URI/resource that was blocked. */
  blockedUri: string
  /** The document/page that triggered the violation. */
  documentUri: string
  /** Reporting API name; "enforce" or "report". */
  disposition: string
  /** Source file/line when the browser provides it (inline violations). */
  sourceFile?: string
  lineNumber?: number
  columnNumber?: number
  /** Short inline sample of the violating code, when provided. */
  sample?: string
  referrer?: string
  /** Browser status code of the document, when provided. */
  statusCode?: number
  /** Which wire format produced this record. */
  format: "report-uri" | "report-to"
  /** When the report was generated (Reporting API `age` is seconds old). */
  reportedAt?: string
}

export interface CspViolationGroup {
  directive: string
  blockedUri: string
  count: number
  /** Distinct document URIs seen for this pair. */
  documentUris: string[]
  dispositions: string[]
  /** Up to 3 sample source locations for triage. */
  samples: string[]
}

export interface CspSummary {
  total: number
  byDirective: Record<string, number>
  groups: CspViolationGroup[]
}

const MAX_SAMPLES_PER_GROUP = 3
const MAX_DOCUMENT_URIS_PER_GROUP = 10
const MAX_STRING = 2048

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value.slice(0, MAX_STRING) : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/** Normalise one legacy `csp-report` body (snake_case fields). */
function fromLegacyCspReport(raw: Record<string, unknown>): CspViolation {
  return {
    directive: str(raw["effective-directive"]) ?? str(raw["violated-directive"]) ?? "unknown",
    blockedUri: str(raw["blocked-uri"]) ?? "",
    documentUri: str(raw["document-uri"]) ?? "",
    disposition: str(raw.disposition) ?? "report",
    sourceFile: str(raw["source-file"]),
    lineNumber: num(raw["line-number"]),
    columnNumber: num(raw["column-number"]),
    sample: str(raw["script-sample"]),
    referrer: str(raw.referrer),
    statusCode: num(raw["status-code"]),
    format: "report-uri",
  }
}

/** Normalise one Reporting API `body` (camelCase fields). */
function fromReportingApiBody(raw: Record<string, unknown>): CspViolation {
  return {
    directive: str(raw.effectiveDirective) ?? str(raw.violatedDirective) ?? "unknown",
    blockedUri: str(raw.blockedURL) ?? "",
    documentUri: str(raw.documentURL) ?? "",
    disposition: str(raw.disposition) ?? "report",
    sourceFile: str(raw.sourceFile),
    lineNumber: num(raw.lineNumber),
    columnNumber: num(raw.columnNumber),
    sample: str(raw.sample),
    referrer: str(raw.referrer),
    statusCode: num(raw.statusCode),
    format: "report-to",
  }
}

/**
 * Parse a request body into normalised violations.
 *
 * Accepts:
 * - `{"csp-report": {...}}` (legacy report-uri)
 * - `{...csp-report fields...}` (defensive: bare legacy object)
 * - `[{type:"csp-violation", body:{...}}, ...]` (Reporting API array)
 * - a single Reporting API report object
 * - an array of legacy `{"csp-report": ...}` objects
 *
 * Returns [] for anything unrecognised — callers still respond 204 so
 * browsers do not retry or surface errors.
 */
export function parseCspReports(body: unknown): CspViolation[] {
  const violations: CspViolation[] = []

  const push = (v: CspViolation | undefined) => {
    if (v) violations.push(v)
  }

  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    const record = asRecord(value)
    if (!record) return

    // Reporting API envelope.
    if (record.type === "csp-violation" || record.type === "csp") {
      const inner = asRecord(record.body)
      if (inner) {
        push({ ...fromReportingApiBody(inner), reportedAt: str(record.url) })
      }
      return
    }

    // Legacy report-uri envelope.
    const legacy = asRecord(record["csp-report"])
    if (legacy) {
      push(fromLegacyCspReport(legacy))
      return
    }

    // Bare legacy-shaped object (has the snake_case keys directly).
    if ("violated-directive" in record || "blocked-uri" in record) {
      push(fromLegacyCspReport(record))
      return
    }

    // Bare Reporting API body (camelCase keys directly).
    if ("violatedDirective" in record || "blockedURL" in record) {
      push(fromReportingApiBody(record))
    }
  }

  visit(body)
  return violations
}

/**
 * Group violations by (directive, blockedUri) for triage. Groups are sorted
 * by count descending so the loudest offenders surface first.
 */
export function summarizeCspViolations(violations: CspViolation[]): CspSummary {
  const byDirective: Record<string, number> = {}
  const groups = new Map<string, CspViolationGroup>()

  for (const v of violations) {
    byDirective[v.directive] = (byDirective[v.directive] ?? 0) + 1

    const key = `${v.directive}${v.blockedUri}`
    let group = groups.get(key)
    if (!group) {
      group = {
        directive: v.directive,
        blockedUri: v.blockedUri,
        count: 0,
        documentUris: [],
        dispositions: [],
        samples: [],
      }
      groups.set(key, group)
    }
    group.count += 1

    if (v.documentUri && group.documentUris.length < MAX_DOCUMENT_URIS_PER_GROUP) {
      if (!group.documentUris.includes(v.documentUri)) {
        group.documentUris.push(v.documentUri)
      }
    }
    if (v.disposition && !group.dispositions.includes(v.disposition)) {
      group.dispositions.push(v.disposition)
    }
    const sample = v.sample ?? (v.sourceFile ? `${v.sourceFile}:${v.lineNumber ?? "?"}` : undefined)
    if (sample && group.samples.length < MAX_SAMPLES_PER_GROUP && !group.samples.includes(sample)) {
      group.samples.push(sample)
    }
  }

  return {
    total: violations.length,
    byDirective,
    groups: [...groups.values()].sort((a, b) => b.count - a.count),
  }
}
