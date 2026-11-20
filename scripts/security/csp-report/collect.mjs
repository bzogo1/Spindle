#!/usr/bin/env node
/**
 * CSP violation report collector + analyser.
 *
 * Standalone, dependency-free counterpart of src/app/api/csp-report/route.ts
 * for self-hosted / log-shipping setups, or for replaying JSONL offline.
 * The parsing logic mirrors src/lib/csp-report.ts — keep them in sync.
 *
 * Usage:
 *   # Run a collector HTTP endpoint (POST JSONL sink).
 *   node scripts/security/csp-report/collect.mjs --port 8787 --out csp-reports.jsonl
 *
 *   # Analyse a JSONL file produced by the collector or `journalctl`/log ship.
 *   node scripts/security/csp-report/collect.mjs --analyze csp-reports.jsonl
 *
 *   # Print sample reports and their analysis (no files needed).
 *   node scripts/security/csp-report/collect.mjs --demo
 *
 * Accepted POST bodies (same shapes as the in-app endpoint):
 *   - {"csp-report": {...}}                    legacy report-uri
 *   - [{type:"csp-violation", body:{...}}]     Reporting API report-to
 *   - bare objects in either field naming
 * Every accepted report is appended as one JSON object per line to --out.
 */

import { Buffer } from "node:buffer"
import { createServer } from "node:http"
import { appendFileSync, createReadStream, existsSync } from "node:fs"
import { createInterface } from "node:readline"
import { resolve } from "node:path"

const MAX_STRING = 2048
const MAX_BODY_BYTES = 256 * 1024

function str(v) {
  return typeof v === "string" && v.length > 0 ? v.slice(0, MAX_STRING) : undefined
}
function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined
}
function rec(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? v : undefined
}

function fromLegacy(raw) {
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
    receivedAt: new Date().toISOString(),
  }
}

function fromApiBody(raw) {
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
    receivedAt: new Date().toISOString(),
  }
}

export function parseReports(body) {
  const out = []
  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit)
    const r = rec(value)
    if (!r) return
    if (r.type === "csp-violation" || r.type === "csp") {
      const inner = rec(r.body)
      if (inner) out.push({ ...fromApiBody(inner), reportUrl: str(r.url) })
      return
    }
    const legacy = rec(r["csp-report"])
    if (legacy) return out.push(fromLegacy(legacy))
    if ("violated-directive" in r || "blocked-uri" in r) return out.push(fromLegacy(r))
    if ("violatedDirective" in r || "blockedURL" in r) out.push(fromApiBody(r))
  }
  visit(body)
  return out
}

export function summarize(violations) {
  const byDirective = {}
  const groups = new Map()
  for (const v of violations) {
    byDirective[v.directive] = (byDirective[v.directive] ?? 0) + 1
    const key = `${v.directive} ${v.blockedUri}`
    let g = groups.get(key)
    if (!g) {
      g = {
        directive: v.directive,
        blockedUri: v.blockedUri,
        count: 0,
        documentUris: [],
        dispositions: [],
        samples: [],
      }
      groups.set(key, g)
    }
    g.count += 1
    if (v.documentUri && g.documentUris.length < 10 && !g.documentUris.includes(v.documentUri)) {
      g.documentUris.push(v.documentUri)
    }
    if (v.disposition && !g.dispositions.includes(v.disposition)) g.dispositions.push(v.disposition)
    const sample = v.sample ?? (v.sourceFile ? `${v.sourceFile}:${v.lineNumber ?? "?"}` : undefined)
    if (sample && g.samples.length < 3 && !g.samples.includes(sample)) g.samples.push(sample)
  }
  return {
    total: violations.length,
    byDirective,
    groups: [...groups.values()].sort((a, b) => b.count - a.count),
  }
}

function printSummary(summary) {
  console.log(`\nCSP violations: ${summary.total}`)
  console.log("By directive:")
  for (const [d, n] of Object.entries(summary.byDirective).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(6)}  ${d}`)
  }
  console.log("\nTop groups (directive + blocked URI):")
  for (const g of summary.groups.slice(0, 20)) {
    console.log(
      `  ${String(g.count).padStart(6)}  ${g.directive}  <-  ${g.blockedUri || "(inline)"}`,
    )
    if (g.dispositions.length) console.log(`         disposition: ${g.dispositions.join(", ")}`)
    for (const s of g.samples) console.log(`         sample: ${s}`)
    for (const d of g.documentUris.slice(0, 3)) console.log(`         page: ${d}`)
  }
  if (summary.groups.length > 20) console.log(`  … and ${summary.groups.length - 20} more groups`)
}

async function analyseFile(path) {
  if (!existsSync(path)) {
    console.error(`No such file: ${path}`)
    process.exit(1)
  }
  const violations = []
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity })
  for await (const line of rl) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      violations.push(JSON.parse(trimmed))
    } catch {
      // Lines may be raw log envelopes; try to find a nested violation.
      try {
        const env = JSON.parse(trimmed)
        if (env && typeof env === "object") violations.push(env)
      } catch {
        /* skip unparseable line */
      }
    }
  }
  printSummary(summarize(violations))
}

const DEMO_REPORTS = [
  {
    "csp-report": {
      "document-uri": "https://app.example.com/dashboard",
      referrer: "https://app.example.com/",
      "violated-directive": "script-src",
      "effective-directive": "script-src",
      disposition: "report",
      "blocked-uri": "https://cdn.thirdparty.example.com/widget.js",
      "status-code": 200,
      "script-sample": "",
    },
  },
  {
    "csp-report": {
      "document-uri": "https://app.example.com/dashboard",
      "violated-directive": "script-src",
      "effective-directive": "script-src",
      disposition: "report",
      "blocked-uri": "https://cdn.thirdparty.example.com/widget.js",
      "status-code": 200,
    },
  },
  {
    type: "csp-violation",
    age: 4,
    url: "https://app.example.com/docs",
    user_agent: "Mozilla/5.0",
    body: {
      documentURL: "https://app.example.com/docs",
      blockedURL: "inline",
      effectiveDirective: "script-src-elem",
      violatedDirective: "script-src-elem",
      disposition: "report",
      sourceFile: "https://app.example.com/docs",
      lineNumber: 128,
      columnNumber: 11,
      sample: "window.__INLINE_BOOTSTRAP__()",
      statusCode: 200,
    },
  },
  {
    type: "csp-violation",
    age: 90,
    url: "https://app.example.com/",
    body: {
      documentURL: "https://app.example.com/",
      blockedURL: "https://tracker.example.com/p.gif",
      effectiveDirective: "img-src",
      violatedDirective: "img-src",
      disposition: "report",
      statusCode: 200,
    },
  },
]

function serve({ port, outPath, routePath }) {
  const server = createServer((req, res) => {
    if (req.method !== "POST" || new URL(req.url, "http://x").pathname !== routePath) {
      res.writeHead(404).end()
      return
    }
    const chunks = []
    let size = 0
    req.on("data", (c) => {
      size += c.length
      if (size <= MAX_BODY_BYTES) chunks.push(c)
    })
    req.on("end", () => {
      let body
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
      } catch {
        res.writeHead(204).end()
        return
      }
      const violations = parseReports(body)
      if (violations.length) {
        appendFileSync(outPath, violations.map((v) => JSON.stringify(v)).join("\n") + "\n")
        console.log(
          `${new Date().toISOString()} stored ${violations.length} report(s) -> ${outPath}`,
        )
      }
      res.writeHead(204).end()
    })
  })
  server.listen(port, () => {
    console.log(`CSP report collector listening on http://0.0.0.0:${port}${routePath}`)
    console.log(`Writing JSONL to ${resolve(outPath)}`)
    console.log(`Point report-uri at http://<host>:${port}${routePath}`)
  })
}

function args() {
  const a = { port: 8787, out: "csp-reports.jsonl", path: "/csp-report" }
  for (let i = 2; i < process.argv.length; i++) {
    const [k, v] = process.argv[i].split("=", 2)
    if (k === "--port") a.port = Number(v ?? process.argv[++i])
    else if (k === "--out") a.out = v ?? process.argv[++i]
    else if (k === "--path") a.path = v ?? process.argv[++i]
    else if (k === "--analyze") a.analyze = v ?? process.argv[++i]
    else if (k === "--demo") a.demo = true
  }
  return a
}

const a = args()
if (a.demo) {
  console.log("Demo input (what browsers POST):")
  console.log(JSON.stringify(DEMO_REPORTS, null, 2))
  const flat = DEMO_REPORTS.flatMap((r) => parseReports(r))
  printSummary(summarize(flat))
} else if (a.analyze) {
  await analyseFile(a.analyze)
} else {
  serve({ port: a.port, outPath: a.out, routePath: a.path })
}
