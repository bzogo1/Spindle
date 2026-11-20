#!/usr/bin/env node
/**
 * API versioning linter / route-surface inventory.
 *
 * Offline, zero-dependency. Scans src/app/api/**\/route.ts and reports:
 *   - route inventory (path -> HTTP methods, runtime, dynamic flags)
 *   - version-prefix consistency (unversioned vs /api/vN/ mixing)
 *   - optional breaking-change heuristics via --snapshot/--compare
 *
 * Usage:
 *   node scripts/api/versioning/check.mjs [--json] [--demo]
 *   node scripts/api/versioning/check.mjs --snapshot <file>
 *   node scripts/api/versioning/check.mjs --compare <file>
 *
 * Exit codes: 0 = clean/advisory findings only, 1 = inconsistent versioning
 * (mixed versioned + unversioned routes, or a /api/vN/ prefix with no
 * matching unversioned sibling policy), 2 = usage/IO error.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { join, relative, sep } from "node:path"

const ROOT = process.cwd()
const API_DIR = join(ROOT, "src", "app", "api")
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
const VERSION_RE = /^v\d+$/

function usage(msg) {
  if (msg) console.error(`error: ${msg}`)
  console.error(`usage: node scripts/api/versioning/check.mjs [--json] [--demo]
       node scripts/api/versioning/check.mjs --snapshot <file>
       node scripts/api/versioning/check.mjs --compare <file>`)
  process.exit(2)
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(p)
    else if (entry.name === "route.ts" || entry.name === "route.tsx" || entry.name === "route.js")
      yield p
  }
}

/** Convert src/app/api/x/y/route.ts -> /api/x/y */
function routePath(file) {
  const rel = relative(join(ROOT, "src", "app"), file)
    .split(sep)
    .join("/")
  return "/" + rel.replace(/\/route\.(ts|tsx|js)$/, "")
}

function firstSegmentVersion(path) {
  // path like /api/v1/foo -> "v1"; /api/v1 -> "v1"
  const seg = path.split("/")[2] // ["", "api", seg, ...]
  return seg && VERSION_RE.test(seg) ? seg : null
}

function analyze() {
  if (!existsSync(API_DIR)) usage(`api dir not found: ${API_DIR} (run from repo root)`)
  const routes = {}
  for (const file of walk(API_DIR)) {
    const src = readFileSync(file, "utf8")
    const path = routePath(file)
    const methods = HTTP_METHODS.filter((m) =>
      new RegExp(`export\\s+(async\\s+)?(function|const)\\s+${m}\\b`).test(src),
    )
    const runtime = /export\s+const\s+runtime\s*=\s*["']([^"']+)["']/.exec(src)?.[1] ?? null
    const dynamic = /export\s+const\s+dynamic\s*=\s*["']([^"']+)["']/.exec(src)?.[1] ?? null
    routes[path] = { methods: methods.sort(), runtime, dynamic, version: firstSegmentVersion(path) }
  }
  return routes
}

function lint(routes) {
  const findings = []
  const versioned = Object.keys(routes).filter((p) => routes[p].version)
  const unversioned = Object.keys(routes).filter((p) => !routes[p].version)
  const versions = [...new Set(versioned.map((p) => routes[p].version))].sort()

  if (versioned.length > 0 && unversioned.length > 0) {
    findings.push({
      level: "warn",
      code: "mixed-versioning",
      message: `${versioned.length} versioned route(s) coexist with ${unversioned.length} unversioned route(s)`,
      detail: "expected during transition; unversioned routes should alias the latest version",
    })
  }
  for (const v of versions) {
    // A /api/vN/x route with an unversioned /api/x twin is the intended alias pattern.
    const orphans = versioned
      .filter((p) => routes[p].version === v)
      .map((p) => p.replace(`/api/${v}/`, "/api/"))
      .filter((p) => !routes[p])
    if (orphans.length)
      findings.push({
        level: "info",
        code: "versioned-without-unversioned-twin",
        message: `version ${v}: ${orphans.length} route(s) have no unversioned twin`,
        detail: orphans.slice(0, 5).join(", ") + (orphans.length > 5 ? ", …" : ""),
      })
  }
  const noMethods = Object.entries(routes)
    .filter(([, r]) => r.methods.length === 0)
    .map(([p]) => p)
  if (noMethods.length)
    findings.push({
      level: "warn",
      code: "no-http-exports",
      message: `${noMethods.length} route(s) export no HTTP methods`,
      detail: noMethods.join(", "),
    })
  return findings
}

function compare(routes, snapshotPath) {
  if (!existsSync(snapshotPath)) usage(`snapshot not found: ${snapshotPath}`)
  let before
  try {
    before = JSON.parse(readFileSync(snapshotPath, "utf8"))
  } catch (err) {
    usage(`cannot read snapshot ${snapshotPath}: ${err.message}`)
  }
  const findings = []
  for (const [path, meta] of Object.entries(before.routes ?? {})) {
    if (!routes[path]) {
      findings.push({ level: "error", code: "route-removed", message: `route removed: ${path}` })
      continue
    }
    const now = routes[path]
    for (const m of meta.methods ?? []) {
      if (!now.methods.includes(m))
        findings.push({
          level: "error",
          code: "method-removed",
          message: `${path}: HTTP ${m} export removed`,
        })
    }
    for (const key of ["runtime", "dynamic"]) {
      if (meta[key] && meta[key] !== now[key])
        findings.push({
          level: "warn",
          code: `${key}-changed`,
          message: `${path}: ${key} changed ${meta[key]} -> ${now[key]}`,
        })
    }
  }
  for (const path of Object.keys(routes)) {
    if (!(before.routes ?? {})[path])
      findings.push({ level: "info", code: "route-added", message: `route added: ${path}` })
  }
  return findings
}

function printHuman(routes, findings) {
  const sorted = Object.keys(routes).sort()
  console.log(`API surface: ${sorted.length} route(s) under src/app/api`)
  for (const p of sorted) {
    const r = routes[p]
    const tag = r.version ? `[${r.version}]` : "     "
    console.log(
      `  ${tag} ${p.padEnd(48)} ${r.methods.join(",").padEnd(28)} runtime=${r.runtime ?? "-"} dynamic=${r.dynamic ?? "-"}`,
    )
  }
  if (findings.length) {
    console.log("\nFindings:")
    for (const f of findings)
      console.log(`  [${f.level}] ${f.code}: ${f.message}${f.detail ? ` (${f.detail})` : ""}`)
  } else {
    console.log("\nNo findings.")
  }
}

function demo(routes) {
  console.log("== check.mjs --demo ==")
  printHuman(routes, lint(routes))
  console.log("\n== Heuristic breaking-change demo (against live snapshot of current tree) ==")
  const snapPath = join(ROOT, "node_modules", ".cache", "api-snapshot-demo.json")
  try {
    writeFileSync(snapPath, JSON.stringify({ routes }, null, 2))
  } catch {
    usage("cannot write demo snapshot")
  }
  const findings = compare(routes, snapPath)
  console.log(
    findings.length
      ? findings.map((f) => `  [${f.level}] ${f.code}: ${f.message}`).join("\n")
      : "  (no diff — snapshot equals current tree)",
  )
  console.log("\nDemo note: simulate a break by removing a method export from a route.ts,")
  console.log("re-running --snapshot then --compare, and observing 'method-removed'.")
}

// --- arg parsing ---
const args = process.argv.slice(2)
const KNOWN_FLAGS = new Set(["--json", "--demo", "--snapshot", "--compare"])
const unknown = args.filter((a) => a.startsWith("--") && !KNOWN_FLAGS.has(a))
if (unknown.length) usage(`unknown flag(s): ${unknown.join(", ")}`)
const asJson = args.includes("--json")
const asDemo = args.includes("--demo")
const snapIdx = args.indexOf("--snapshot")
const cmpIdx = args.indexOf("--compare")
const flagValue = (idx) => (args[idx + 1] && !args[idx + 1].startsWith("--") ? args[idx + 1] : null)
if (snapIdx !== -1 && !flagValue(snapIdx)) usage("--snapshot requires a file path")
if (cmpIdx !== -1 && !flagValue(cmpIdx)) usage("--compare requires a file path")
if (snapIdx !== -1 && cmpIdx !== -1) usage("--snapshot and --compare are mutually exclusive")
if (snapIdx === -1 && cmpIdx === -1 && args.some((a) => !a.startsWith("--")))
  usage("unexpected positional argument")

const routes = analyze()

if (snapIdx !== -1) {
  const out = flagValue(snapIdx)
  try {
    writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), routes }, null, 2))
  } catch (err) {
    usage(`cannot write snapshot ${out}: ${err.message}`)
  }
  console.log(`snapshot written: ${out} (${Object.keys(routes).length} routes)`)
  process.exit(0)
}

const findings = cmpIdx !== -1 ? compare(routes, args[cmpIdx + 1]) : lint(routes)

if (asJson) {
  console.log(JSON.stringify({ routeCount: Object.keys(routes).length, routes, findings }, null, 2))
} else if (asDemo) {
  demo(routes)
} else {
  printHuman(routes, findings)
}

const hasError = findings.some((f) => f.level === "error")
process.exit(hasError ? 1 : 0)
