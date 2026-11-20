#!/usr/bin/env node
/**
 * API deprecation checker.
 *
 * Enforces the deprecation policy in docs/api/deprecation.md:
 *  - every entry in the deprecations registry (deprecations.json) points at a
 *    real route handler and satisfies the minimum notice period;
 *  - routes registered as deprecated actually emit `Deprecation` / `Sunset`
 *    response headers (directly or via a one-level-deep local import, e.g. a
 *    shared `deprecationHeaders()` helper);
 *  - no route handler carries a deprecation marker (`@deprecated` docblock or
 *    a `Deprecation` response header) without a matching registry entry.
 *
 * Usage:
 *   node scripts/api/deprecation/check.mjs [--json] [--demo]
 *   node docs/api/deprecation-check.mjs   (thin alias, same flags)
 *
 * Flags:
 *   --json               machine-readable report on stdout
 *   --demo               run against a throwaway fixture tree (exercises both
 *                        the pass and fail paths without touching the repo)
 *   --root <dir>         repo root to scan (default: cwd / script location)
 *   --registry <path>    registry file (default: ./deprecations.json next to
 *                        this script)
 *   --min-notice-days N  override the policy minimum notice period (default 90)
 *
 * Exit codes: 0 = clean, 1 = violations found, 2 = usage/config error.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_REGISTRY = path.join(SCRIPT_DIR, "deprecations.json")
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Matches a deprecation marker in route source: a `@deprecated` JSDoc tag or a
// literal `Deprecation` response-header key. Used both to verify registered
// routes and to catch unregistered deprecations.
const MARKER_RES = [/@deprecated\b/, /\b["'`]?Deprecation["'`]?\s*:/, /\bdeprecationHeaders\s*\(/]
const HEADER_KEY_RES = {
  deprecation: /\b["'`]?Deprecation["'`]?\s*:|\bdeprecationHeaders\s*\(/,
  sunset: /\b["'`]?Sunset["'`]?\s*:|\bsunsetHeaders\s*\(/,
}

function parseArgs(argv) {
  const opts = { json: false, demo: false, root: null, registry: null, minNoticeDays: 90 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--json") opts.json = true
    else if (a === "--demo") opts.demo = true
    else if (a === "--root") opts.root = argv[++i]
    else if (a === "--registry") opts.registry = argv[++i]
    else if (a === "--min-notice-days") opts.minNoticeDays = Number(argv[++i])
    else if (a === "-h" || a === "--help") {
      console.log(
        "Usage: check.mjs [--json] [--demo] [--root dir] [--registry file] [--min-notice-days N]",
      )
      process.exit(0)
    } else {
      console.error(`check.mjs: unknown argument ${a}`)
      process.exit(2)
    }
  }
  if (!Number.isFinite(opts.minNoticeDays) || opts.minNoticeDays < 0) {
    console.error("check.mjs: --min-notice-days must be a non-negative number")
    process.exit(2)
  }
  return opts
}

function findRepoRoot(start) {
  let dir = path.resolve(start)
  for (let i = 0; i < 10; i++) {
    if (
      fs.existsSync(path.join(dir, "src/app/api")) &&
      fs.existsSync(path.join(dir, "package.json"))
    ) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return path.resolve(start)
}

function* walkRoutes(dir) {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walkRoutes(p)
    else if (entry.name === "route.ts" || entry.name === "route.tsx" || entry.name === "route.js")
      yield p
  }
}

/** URL-ish route path (`/api/...`) for a route file, e.g. src/app/api/x/route.ts -> /api/x */
function routePathFor(file, apiDir) {
  const rel = path.relative(apiDir, path.dirname(file)).split(path.sep).join("/")
  return "/api" + (rel ? `/${rel}` : "")
}

/** Resolve `@/x` -> `<root>/src/x`, relative -> sibling of importer. Returns absolute path or null. */
function resolveImport(spec, importer, root) {
  let base
  if (spec.startsWith("@/")) base = path.join(root, "src", spec.slice(2))
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(importer), spec)
  else return null // bare package imports are not followed
  for (const cand of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.mjs`,
    path.join(base, "index.ts"),
  ]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand
  }
  return null
}

const IMPORT_RE = /(?:import|export)[^'"]*from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']/g

/** Source of a route file plus its local imports, one level deep. */
function collectSources(routeFile, root) {
  const sources = []
  const seen = new Set()
  const read = (file) => {
    if (seen.has(file)) return
    seen.add(file)
    let src
    try {
      src = fs.readFileSync(file, "utf8")
    } catch {
      return
    }
    sources.push({ file, src })
    if (file !== routeFile) return // only expand imports of the route file itself
    IMPORT_RE.lastIndex = 0
    let m
    while ((m = IMPORT_RE.exec(src))) {
      const spec = m[1] || m[2]
      const resolved = spec && resolveImport(spec, file, root)
      if (resolved) read(resolved)
    }
  }
  read(routeFile)
  return sources
}

function hasMarker(src) {
  return MARKER_RES.some((re) => re.test(src))
}

function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000)
}

function isValidDate(s) {
  if (!DATE_RE.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

function buildDemoTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spindle-deprecation-demo-"))
  const api = path.join(dir, "src/app/api")
  fs.mkdirSync(path.join(api, "legacy"), { recursive: true })
  fs.mkdirSync(path.join(api, "undocumented"), { recursive: true })
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "demo" }))
  fs.writeFileSync(
    path.join(api, "legacy/route.ts"),
    [
      'import { deprecationHeaders } from "@/lib/http"',
      "export async function GET() {",
      '  return Response.json({ ok: true }, { headers: deprecationHeaders("2026-01-01", "2026-06-01") })',
      "}",
    ].join("\n"),
  )
  fs.mkdirSync(path.join(dir, "src/lib"), { recursive: true })
  fs.writeFileSync(
    path.join(dir, "src/lib/http.ts"),
    "export function deprecationHeaders(d: string, s: string) {\n  return { Deprecation: d, Sunset: s }\n}\n",
  )
  fs.writeFileSync(
    path.join(api, "undocumented/route.ts"),
    [
      "/**",
      " * @deprecated use /api/legacy instead",
      " */",
      "export async function GET() {",
      "  return Response.json({ ok: true })",
      "}",
    ].join("\n"),
  )
  const registry = {
    version: 1,
    policy: "docs/api/deprecation.md",
    deprecations: [
      {
        id: "demo-good",
        route: "/api/legacy",
        methods: ["GET"],
        deprecatedAt: "2026-01-01",
        sunset: "2026-06-01",
        replacement: "/api/legacy",
        status: "active",
        requireHeaders: true,
      },
      {
        id: "demo-bad-notice",
        route: "/api/legacy",
        methods: ["GET"],
        deprecatedAt: "2026-01-01",
        sunset: "2026-02-01",
        status: "active",
        requireHeaders: false,
        notes: "sunset only 31 days after deprecation — below the 90-day minimum",
      },
      {
        id: "demo-missing-route",
        route: "/api/does-not-exist",
        methods: ["GET"],
        deprecatedAt: "2026-01-01",
        sunset: "2026-12-01",
        status: "active",
        requireHeaders: false,
      },
    ],
  }
  const registryPath = path.join(dir, "deprecations.json")
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2))
  return { root: dir, registryPath }
}

export function runCheck(opts) {
  const violations = []
  const warnings = []
  const fail = (code, message, extra = {}) => violations.push({ code, message, ...extra })
  const warn = (code, message, extra = {}) => warnings.push({ code, message, ...extra })

  let root = opts.root ? path.resolve(opts.root) : findRepoRoot(process.cwd())
  let registryPath = opts.registry ? path.resolve(opts.registry) : DEFAULT_REGISTRY
  if (opts.demo) {
    const demo = buildDemoTree()
    root = demo.root
    registryPath = demo.registryPath
  }

  const apiDir = path.join(root, "src/app/api")
  const stats = { routes: 0, registryEntries: 0, activeDeprecations: 0 }

  // --- Load registry ---
  let registry
  try {
    registry = JSON.parse(fs.readFileSync(registryPath, "utf8"))
  } catch (err) {
    return {
      ok: false,
      fatal: `cannot read registry ${registryPath}: ${err.message}`,
      violations,
      warnings,
      stats,
      root,
      registryPath,
    }
  }
  const entries = Array.isArray(registry.deprecations) ? registry.deprecations : []
  stats.registryEntries = entries.length

  // --- Index route files ---
  const routeFiles = new Map() // "/api/x" -> file path
  for (const file of walkRoutes(apiDir)) {
    stats.routes++
    routeFiles.set(routePathFor(file, apiDir), file)
  }

  const seenIds = new Set()
  const coveredRoutes = new Set()

  for (const [i, entry] of entries.entries()) {
    const label = entry?.id || `#${i}`
    const where = { registryId: label, route: entry?.route }

    if (!entry || typeof entry !== "object") {
      fail("registry.invalid_entry", `deprecations[${i}] is not an object`, where)
      continue
    }
    if (seenIds.has(entry.id))
      fail("registry.duplicate_id", `duplicate deprecation id "${entry.id}"`, where)
    seenIds.add(entry.id)

    for (const field of ["id", "route", "methods", "deprecatedAt", "sunset", "status"]) {
      if (entry[field] === undefined || entry[field] === null || entry[field] === "") {
        fail(
          "registry.missing_field",
          `deprecation "${label}" is missing required field "${field}"`,
          where,
        )
      }
    }

    if (entry.route && !String(entry.route).startsWith("/api/")) {
      fail(
        "registry.bad_route",
        `deprecation "${label}" route "${entry.route}" must start with /api/`,
        where,
      )
    }
    if (Array.isArray(entry.methods)) {
      for (const m of entry.methods) {
        if (!HTTP_METHODS.has(String(m).toUpperCase())) {
          fail("registry.bad_method", `deprecation "${label}" has invalid method "${m}"`, where)
        }
      }
    }
    if (entry.deprecatedAt && !isValidDate(entry.deprecatedAt)) {
      fail(
        "registry.bad_date",
        `deprecation "${label}" deprecatedAt "${entry.deprecatedAt}" is not a valid YYYY-MM-DD date`,
        where,
      )
    }
    if (entry.sunset && !isValidDate(entry.sunset)) {
      fail(
        "registry.bad_date",
        `deprecation "${label}" sunset "${entry.sunset}" is not a valid YYYY-MM-DD date`,
        where,
      )
    }
    if (
      isValidDate(entry.deprecatedAt) &&
      isValidDate(entry.sunset) &&
      entry.sunset <= entry.deprecatedAt
    ) {
      fail(
        "registry.sunset_not_after_deprecation",
        `deprecation "${label}" sunset ${entry.sunset} is not after deprecatedAt ${entry.deprecatedAt}`,
        where,
      )
    }
    if (!["announced", "active", "removed"].includes(entry.status)) {
      fail(
        "registry.bad_status",
        `deprecation "${label}" status "${entry.status}" must be announced|active|removed`,
        where,
      )
    }

    // Route must exist for anything not yet removed.
    const routeFile = entry.route ? routeFiles.get(entry.route) : undefined
    if (entry.status !== "removed" && entry.route && !routeFile) {
      fail(
        "registry.route_missing",
        `deprecation "${label}" references ${entry.route} but no route.ts exists there`,
        where,
      )
      continue
    }
    if (routeFile) coveredRoutes.add(entry.route)

    // Notice period applies to announced/active entries.
    if (
      ["announced", "active"].includes(entry.status) &&
      isValidDate(entry.deprecatedAt) &&
      isValidDate(entry.sunset)
    ) {
      stats.activeDeprecations++
      const notice = daysBetween(entry.deprecatedAt, entry.sunset)
      if (notice < opts.minNoticeDays) {
        fail(
          "registry.notice_period",
          `deprecation "${label}" (${entry.route}) has ${notice} days notice (${entry.deprecatedAt} -> ${entry.sunset}); policy minimum is ${opts.minNoticeDays} days`,
          where,
        )
      }
    }

    // Announcement doc, if referenced, must exist.
    if (entry.announcement) {
      const p = path.join(root, entry.announcement)
      if (!fs.existsSync(p)) {
        warn(
          "registry.announcement_missing",
          `deprecation "${label}" announcement path "${entry.announcement}" does not exist`,
          where,
        )
      }
    }

    // Header verification.
    if (routeFile && entry.requireHeaders !== false && entry.status !== "removed") {
      const sources = collectSources(routeFile, root)
      const found = { deprecation: false, sunset: false, files: [] }
      for (const { file, src } of sources) {
        const d = HEADER_KEY_RES.deprecation.test(src)
        const s = HEADER_KEY_RES.sunset.test(src)
        if (d || s) found.files.push(path.relative(root, file))
        found.deprecation ||= d
        found.sunset ||= s
      }
      if (!found.deprecation) {
        fail(
          "headers.missing_deprecation",
          `deprecation "${label}" route ${entry.route} does not emit a Deprecation header (checked ${path.relative(root, routeFile)} + local imports)`,
          where,
        )
      }
      if (!found.sunset) {
        fail(
          "headers.missing_sunset",
          `deprecation "${label}" route ${entry.route} does not emit a Sunset header (checked ${path.relative(root, routeFile)} + local imports)`,
          where,
        )
      }
      // RFC 8594 Sunset may be an HTTP-date; we only flag if the route builds
      // headers dynamically without any literal — presence of the key is enough.
    }
  }

  // --- Reverse scan: deprecation markers in routes with no registry entry ---
  const markedRoutes = []
  for (const [routePath, file] of routeFiles) {
    const src = fs.readFileSync(file, "utf8")
    if (hasMarker(src)) markedRoutes.push({ routePath, file })
  }
  for (const { routePath, file } of markedRoutes) {
    if (!coveredRoutes.has(routePath)) {
      fail(
        "registry.unregistered_deprecation",
        `${routePath} carries a deprecation marker (@deprecated or Deprecation header) but has no entry in deprecations.json`,
        { route: routePath, file: path.relative(root, file) },
      )
    }
  }

  // --- Policy-doc cross reference ---
  const policyPath = path.join(root, "docs/api/deprecation.md")
  if (!fs.existsSync(policyPath)) {
    warn(
      "policy.missing_doc",
      "docs/api/deprecation.md not found — deprecation policy document is missing",
    )
  }

  return { ok: violations.length === 0, violations, warnings, stats, root, registryPath }
}

export function printText(result) {
  const { violations, warnings, stats, root, registryPath } = result
  if (result.fatal) {
    console.error(`FAIL ${result.fatal}`)
    return
  }
  console.log(`API deprecation check — root: ${root}`)
  console.log(`Registry: ${registryPath}`)
  console.log(
    `Scanned ${stats.routes} route handlers, ${stats.registryEntries} registry entries (${stats.activeDeprecations} announced/active).`,
  )
  for (const v of violations) {
    console.log(`FAIL [${v.code}] ${v.message}`)
  }
  for (const w of warnings) {
    console.log(`WARN [${w.code}] ${w.message}`)
  }
  if (violations.length === 0 && warnings.length === 0) {
    console.log("PASS — no deprecation violations.")
  } else {
    console.log(`${violations.length} violation(s), ${warnings.length} warning(s).`)
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const opts = parseArgs(process.argv.slice(2))
  const result = runCheck(opts)
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    if (opts.demo) console.log("=== DEMO MODE (fixture tree in tmpdir) ===")
    printText(result)
    if (opts.demo) console.log(`Demo root: ${result.root}`)
  }
  process.exit(result.fatal ? 2 : result.ok ? 0 : 1)
}
