#!/usr/bin/env node
/**
 * Security headers audit (issue 064).
 *
 * Fetches the response headers of a running instance and checks them against
 * a declarative policy (policy.headers.json). The policy mirrors the header
 * contract implemented in src/lib/security-headers.ts — see
 * docs/security/security-headers-audit.md for the inventory and findings.
 *
 * Usage:
 *   node scripts/security/headers-audit.mjs [--url URL] [--profile P] \
 *     [--policy FILE] [--demo] [--json] [--ci] [--timeout MS]
 *
 *   --url URL      Target to audit. Default http://localhost:3000/
 *   --profile P    Policy profile: development | production (default: auto —
 *                  production when the URL is https or --production given)
 *   --policy FILE  Policy JSON path (default: policy.headers.json next to this file)
 *   --demo         Audit synthetic responses instead of fetching (no server needed)
 *   --json         Emit the machine-readable report only
 *   --ci           CI mode (see --help; live audits fail on errors regardless)
 *   --timeout MS   Fetch timeout (default 10000)
 *
 * Exit codes: 0 = no error-severity failures, 1 = audit failures,
 * 2 = usage/fetch/policy error.
 *
 * The audit functions are pure where possible so the vitest suite in
 * headers-audit.test.ts can exercise them without a server.
 */

import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const DEFAULT_URL = "http://localhost:3000/"
const DEFAULT_TIMEOUT_MS = 10_000
const SEVERITIES = new Set(["error", "warn"])

// ---------------------------------------------------------------------------
// Policy loading / validation
// ---------------------------------------------------------------------------

export function validatePolicy(policy) {
  if (!policy || typeof policy !== "object") throw new Error("Policy must be an object.")
  if (!policy.profiles || typeof policy.profiles !== "object") {
    throw new Error("Policy must define a `profiles` object.")
  }
  for (const [name, profile] of Object.entries(policy.profiles)) {
    if (!profile.requiredHeaders || !Array.isArray(profile.requiredHeaders)) {
      throw new Error(`Profile "${name}" must define requiredHeaders[]`)
    }
    for (const h of profile.requiredHeaders) {
      if (!h.name || !h.match || !SEVERITIES.has(h.severity)) {
        throw new Error(`Profile "${name}" has an invalid requiredHeaders entry.`)
      }
      if (!["equals", "contains", "regex"].includes(h.match.type)) {
        throw new Error(
          `Profile "${name}" header "${h.name}": unknown match type "${h.match.type}".`,
        )
      }
    }
    for (const h of profile.optionalHeaders ?? []) {
      if (!h.name || !h.match || !SEVERITIES.has(h.severity)) {
        throw new Error(`Profile "${name}" has an invalid optionalHeaders entry.`)
      }
    }
    const csp = profile.csp
    if (csp) {
      if (!["auto", "report-only", "enforced"].includes(csp.coverage)) {
        throw new Error(`Profile "${name}" csp.coverage must be auto|report-only|enforced.`)
      }
      if (!Array.isArray(csp.requireDirectives)) {
        throw new Error(`Profile "${name}" csp.requireDirectives must be an array.`)
      }
    }
  }
  return policy
}

export async function loadPolicy(path) {
  const raw = await readFile(path, "utf8")
  return validatePolicy(JSON.parse(raw))
}

// ---------------------------------------------------------------------------
// Header / CSP helpers
// ---------------------------------------------------------------------------

/** Normalize a fetch Headers object, a header array, or a plain object to {lowerName: value}. */
export function normalizeHeaders(input) {
  const out = {}
  if (!input) return out
  if (typeof input.forEach === "function" && !Array.isArray(input)) {
    // fetch Headers instance
    input.forEach((value, key) => {
      out[key.toLowerCase()] = value
    })
    return out
  }
  if (Array.isArray(input)) {
    for (const [key, value] of input) out[String(key).toLowerCase()] = String(value)
    return out
  }
  for (const [key, value] of Object.entries(input)) out[key.toLowerCase()] = String(value)
  return out
}

/** Parse a CSP header value into { directive: [sources...] } (directive names lowercased). */
export function parseCsp(value) {
  const directives = {}
  if (!value) return directives
  for (const part of String(value).split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean)
    if (tokens.length === 0) continue
    const name = tokens[0].toLowerCase()
    directives[name] = tokens.slice(1)
  }
  return directives
}

function headerValue(headers, name) {
  return headers[name.toLowerCase()]
}

function matchValue(actual, match) {
  if (actual === undefined) return { pass: false, reason: "header is missing" }
  switch (match.type) {
    case "equals":
      return actual === match.value
        ? { pass: true }
        : { pass: false, reason: `expected exactly "${match.value}", got "${actual}"` }
    case "contains":
      return actual.includes(match.value)
        ? { pass: true }
        : { pass: false, reason: `expected to contain "${match.value}", got "${actual}"` }
    case "regex": {
      const re = new RegExp(match.value)
      return re.test(actual)
        ? { pass: true }
        : { pass: false, reason: `expected to match /${match.value}/, got "${actual}"` }
    }
    default:
      return { pass: false, reason: `unknown match type "${match.type}"` }
  }
}

// ---------------------------------------------------------------------------
// Audit core (pure)
// ---------------------------------------------------------------------------

/**
 * Audit a normalized header map against a policy profile.
 * Returns { url, profile, status, checks, summary }.
 */
export function auditHeaders({ url, status, headers, profile, profileName }) {
  const checks = []
  const add = (id, severity, pass, message, actual) =>
    checks.push({
      id,
      severity,
      status: pass ? "pass" : "fail",
      message,
      ...(actual ? { actual } : {}),
    })

  const norm = normalizeHeaders(headers)

  for (const rule of profile.requiredHeaders ?? []) {
    const actual = headerValue(norm, rule.name)
    const { pass, reason } = matchValue(actual, rule.match)
    add(
      `header:${rule.name}`,
      rule.severity,
      pass,
      pass ? `${rule.name} satisfies policy` : `${rule.name}: ${reason ?? "does not match policy"}`,
      actual,
    )
  }

  for (const rule of profile.optionalHeaders ?? []) {
    const actual = headerValue(norm, rule.name)
    if (actual === undefined) continue // optional: absence is fine
    const { pass, reason } = matchValue(actual, rule.match)
    add(
      `optional:${rule.name}`,
      rule.severity,
      pass,
      pass
        ? `${rule.name} present and well-formed`
        : `${rule.name} present but unexpected/mis-shaped: ${reason}`,
      actual,
    )
  }

  if (profile.csp) {
    checks.push(...auditCsp(norm, profile.csp))
  }

  if (typeof status === "number" && (status < 200 || status >= 400)) {
    add(
      "http:status",
      "warn",
      false,
      `Audited URL returned HTTP ${status}; headers may belong to an error page.`,
      String(status),
    )
  }

  const failed = checks.filter((c) => c.status === "fail" && c.severity === "error")
  const warned = checks.filter((c) => c.status === "fail" && c.severity === "warn")
  return {
    url,
    profile: profileName,
    status: status ?? null,
    checks,
    summary: {
      total: checks.length,
      passed: checks.filter((c) => c.status === "pass").length,
      failed: failed.length,
      warnings: warned.length,
    },
    ok: failed.length === 0,
  }
}

function auditCsp(headers, csp) {
  const checks = []
  const add = (id, severity, pass, message, actual) =>
    checks.push({
      id,
      severity,
      status: pass ? "pass" : "fail",
      message,
      ...(actual ? { actual } : {}),
    })

  const enforcedRaw = headerValue(headers, csp.enforcedHeader)
  const reportOnlyRaw = csp.reportOnlyHeader
    ? headerValue(headers, csp.reportOnlyHeader)
    : undefined

  const enforced = parseCsp(enforcedRaw)
  const reportOnly = parseCsp(reportOnlyRaw)

  // Pick the header whose directive set the policy cares about.
  let coverageName
  let coverage
  if (csp.coverage === "report-only") {
    coverageName = csp.reportOnlyHeader ?? "report-only"
    coverage = reportOnly
  } else if (csp.coverage === "enforced") {
    coverageName = csp.enforcedHeader
    coverage = enforced
  } else {
    // auto: prefer report-only (full policy while safe subset is enforced),
    // fall back to the enforced header (CSP_ENFORCE=1 mode).
    if (reportOnlyRaw !== undefined) {
      coverageName = csp.reportOnlyHeader
      coverage = reportOnly
    } else {
      coverageName = csp.enforcedHeader
      coverage = enforced
    }
  }

  const missing = (csp.requireDirectives ?? []).filter((d) => !(d in coverage))
  add(
    `csp:directives:${coverageName}`,
    "error",
    missing.length === 0,
    missing.length === 0
      ? `CSP (${coverageName}) covers all ${csp.requireDirectives.length} required directives`
      : `CSP (${coverageName}) missing directives: ${missing.join(", ")}`,
    coverageName,
  )

  // Forbidden sources are checked in every CSP header that is present —
  // 'unsafe-eval' must never appear in either enforced or report-only.
  for (const forbidden of csp.forbidSources ?? []) {
    for (const [label, parsed] of [
      [csp.enforcedHeader, enforced],
      [csp.reportOnlyHeader, reportOnly],
    ]) {
      if (!label || Object.keys(parsed).length === 0) continue
      const hits = Object.entries(parsed).filter(([, sources]) => sources.includes(forbidden))
      add(
        `csp:forbidden:${forbidden}:${label}`,
        "error",
        hits.length === 0,
        hits.length === 0
          ? `No CSP directive allows ${forbidden}`
          : `${forbidden} found in ${label} directive(s): ${hits.map(([d]) => d).join(", ")}`,
        hits.map(([d]) => d).join(", ") || undefined,
      )
    }
  }

  if (csp.frameAncestors) {
    const expected = csp.frameAncestors
    const actual = coverage["frame-ancestors"]?.join(" ")
    add(
      "csp:frame-ancestors",
      "error",
      actual === expected,
      actual === expected
        ? `frame-ancestors is ${expected}`
        : `frame-ancestors expected "${expected}", got "${actual ?? "(missing)"}" in ${coverageName}`,
      actual,
    )

    // Cross-check X-Frame-Options consistency when both are present.
    const xfo = headerValue(headers, "x-frame-options")
    if (xfo && expected === "'self'") {
      const consistent = xfo.toUpperCase() === "SAMEORIGIN"
      add(
        "csp:xfo-consistency",
        "warn",
        consistent,
        consistent
          ? "X-Frame-Options SAMEORIGIN is consistent with frame-ancestors 'self'"
          : `X-Frame-Options "${xfo}" may conflict with frame-ancestors ${expected}`,
        xfo,
      )
    }
  }

  return checks
}

// ---------------------------------------------------------------------------
// Fetch + reporting + CLI
// ---------------------------------------------------------------------------

export async function fetchHeaders(url, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const res = await fetch(url, {
    method: "GET",
    redirect: "follow",
    // globalThis.* keeps eslint's no-undef happy (AbortSignal is a Node
    // global but not in the shared browser-globals list).
    signal: globalThis.AbortSignal.timeout(timeoutMs),
    headers: { "user-agent": "spindle-headers-audit/1.0" },
  })
  // We only need headers; release the body without buffering it.
  await res.body?.cancel().catch(() => {})
  return { status: res.status, headers: res.headers, finalUrl: res.url }
}

export function formatReport(report, { json = false } = {}) {
  if (json) return JSON.stringify(report, null, 2)
  const lines = []
  lines.push(`Security headers audit — ${report.url}`)
  lines.push(`Profile: ${report.profile} | HTTP ${report.status ?? "?"}`)
  lines.push(
    `Result: ${report.summary.failed} error(s), ${report.summary.warnings} warning(s) ` +
      `(${report.summary.passed}/${report.summary.total} checks passed)`,
  )
  for (const c of report.checks) {
    const mark = c.status === "pass" ? "PASS" : c.severity === "error" ? "FAIL" : "WARN"
    lines.push(`  [${mark}] ${c.id} — ${c.message}`)
  }
  return lines.join("\n")
}

function parseArgs(argv) {
  const args = {
    url: DEFAULT_URL,
    profile: undefined,
    policy: undefined,
    demo: false,
    json: false,
    ci: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    production: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`Missing value for ${a}`)
      return v
    }
    switch (a) {
      case "--url":
        args.url = next()
        break
      case "--profile":
        args.profile = next()
        break
      case "--policy":
        args.policy = next()
        break
      case "--demo":
        args.demo = true
        break
      case "--json":
        args.json = true
        break
      case "--ci":
        args.ci = true
        break
      case "--production":
        args.production = true
        break
      case "--timeout":
        args.timeoutMs = Number(next())
        if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) {
          throw new Error("--timeout must be a positive number of milliseconds")
        }
        break
      case "--help":
      case "-h":
        args.help = true
        break
      default:
        throw new Error(`Unknown argument: ${a}`)
    }
  }
  return args
}

function pickProfile(policy, args) {
  if (args.profile) {
    if (!policy.profiles[args.profile]) {
      throw new Error(
        `Unknown profile "${args.profile}". Available: ${Object.keys(policy.profiles).join(", ")}`,
      )
    }
    return args.profile
  }
  if (args.production) return "production"
  try {
    return new URL(args.url).protocol === "https:" ? "production" : "development"
  } catch {
    return "development"
  }
}

/** Synthetic responses used by --demo and exercised by the unit tests. */
export function demoResponses() {
  const fullCsp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: data: https:",
    "connect-src 'self' https://*.ingest.sentry.io",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-src 'self' https:",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ")
  const compliant = {
    name: "compliant (mirrors src/lib/security-headers.ts, dev mode)",
    status: 200,
    headers: {
      "content-security-policy": "frame-ancestors 'self'; base-uri 'self'; object-src 'none'",
      "content-security-policy-report-only": fullCsp,
      "strict-transport-security": "max-age=63072000; includeSubDomains",
      "x-content-type-options": "nosniff",
      "x-frame-options": "SAMEORIGIN",
      "referrer-policy": "strict-origin-when-cross-origin",
      "permissions-policy": "camera=(), microphone=(), geolocation=(), browsing-topics=()",
    },
  }
  const nonCompliant = {
    name: "non-compliant (missing headers, unsafe-eval, no frame-ancestors)",
    status: 200,
    headers: {
      "content-security-policy": "default-src *; script-src 'unsafe-eval' 'unsafe-inline'",
      "x-frame-options": "ALLOWALL",
    },
  }
  return [compliant, nonCompliant]
}

export async function runAudit(args, { fetchImpl = fetchHeaders } = {}) {
  const policyPath =
    args.policy ?? resolve(dirname(fileURLToPath(import.meta.url)), "policy.headers.json")
  const policy = await loadPolicy(policyPath)
  const profileName = pickProfile(policy, args)
  const profile = policy.profiles[profileName]

  if (args.demo) {
    const reports = []
    for (const fixture of demoResponses()) {
      reports.push(
        auditHeaders({
          url: `demo://${fixture.name}`,
          status: fixture.status,
          headers: fixture.headers,
          profile,
          profileName,
        }),
      )
    }
    return { policy, profileName, reports, demo: true }
  }

  const { status, headers, finalUrl } = await fetchImpl(args.url, {
    timeoutMs: args.timeoutMs,
  })
  const report = auditHeaders({
    url: finalUrl ?? args.url,
    status,
    headers,
    profile,
    profileName,
  })
  return { policy, profileName, reports: [report], demo: false }
}

function printHelp() {
  console.log(`Usage: node scripts/security/headers-audit.mjs [options]

Options:
  --url URL        Target URL (default: ${DEFAULT_URL})
  --profile P      Policy profile: development | production (default: auto from URL scheme / --production)
  --policy FILE    Policy JSON (default: policy.headers.json next to this script)
  --demo           Audit synthetic responses; no server needed
  --json           Print the machine-readable report only
  --ci             CI mode: live audits already exit 1 on error-severity
                   failures; with --demo it additionally fails if the
                   non-compliant fixture unexpectedly passes
  --production     Force the production profile
  --timeout MS     Fetch timeout in ms (default: ${DEFAULT_TIMEOUT_MS})
  -h, --help       Show this help`)
}

async function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(`headers-audit: ${err.message}`)
    process.exitCode = 2
    return
  }
  if (args.help) {
    printHelp()
    return
  }
  try {
    const { reports, profileName, demo } = await runAudit(args)
    if (args.json) {
      console.log(JSON.stringify({ profile: profileName, demo, reports }, null, 2))
    } else {
      for (const report of reports) {
        console.log(formatReport(report))
        console.log("")
      }
    }
    if (demo) {
      // The compliant fixture must pass; the non-compliant one must fail.
      // --ci additionally turns a broken auditor (bad fixture passing) into
      // a failure; without --ci demo always exits 0 so it can be used as a
      // smoke check that prints both outcomes.
      const [good, bad] = reports
      if (!good.ok) {
        console.error("headers-audit: demo compliant fixture failed — auditor or policy broken")
        process.exitCode = 1
      } else if (args.ci && bad && bad.ok) {
        console.error("headers-audit: demo non-compliant fixture unexpectedly passed")
        process.exitCode = 1
      }
    } else if (reports.some((r) => !r.ok)) {
      process.exitCode = 1
    }
  } catch (err) {
    console.error(`headers-audit: ${err.message}`)
    process.exitCode = 2
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isMain) {
  await main()
}
