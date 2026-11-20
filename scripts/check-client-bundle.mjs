/**
 * Fails the build if Shiki (or its grammar/TextMate runtime) leaks into the
 * client bundle under `.next/static`. Docs code highlighting must stay
 * server-side: `src/lib/code-highlight.ts` is only reachable from async
 * Server Components, and `src/components/site/code-block.tsx` imports
 * `shiki/types` with `import type`.
 *
 * Run after `next build` (wired as `postbuild`). To check an existing build
 * manually: `npm run check:client-bundle`.
 */

import fs from "node:fs"
import path from "node:path"
import { gzipSync } from "node:zlib"

const staticDir = path.join(process.cwd(), ".next", "static")
const nextDir = path.join(process.cwd(), ".next")

if (!fs.existsSync(staticDir)) {
  console.error("check-client-bundle: .next/static not found — run `npm run build` first.")
  process.exit(1)
}

// Strings that only appear in Shiki, @shikijs grammar, or TextMate/oniguruma
// runtime code. They survive minification because they live in shipped string
// literals, grammar scopes, and package identifiers.
const MARKERS = [
  /shiki/i,
  /@shikijs/,
  /vscode-textmate/,
  /vscode-oniguruma/,
  /oniguruma\.wasm/,
  /createHighlighterCore/,
]

const SCAN_EXTENSIONS = new Set([".js", ".mjs", ".css", ".html", ".json", ".map"])

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (SCAN_EXTENSIONS.has(path.extname(entry.name))) yield full
  }
}

const offenders = []
let scanned = 0
let totalBytes = 0

for (const file of walk(staticDir)) {
  scanned += 1
  totalBytes += fs.statSync(file).size
  const content = fs.readFileSync(file, "utf8")
  const hit = MARKERS.find((marker) => marker.test(content))
  if (hit) offenders.push({ file: path.relative(process.cwd(), file), marker: hit.source })
}

if (offenders.length > 0) {
  console.error("check-client-bundle: FAIL — Shiki/TextMate code found in client chunks:")
  for (const { file, marker } of offenders) {
    console.error(`  ${file}  (matched /${marker}/)`)
  }
  console.error(
    "Keep highlighting server-side: do not import `code-highlight` from a client component, and keep `shiki/types` as `import type`.",
  )
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Bundle budget gate (gzip)
//
// Calibrated 2026-11-20 against `next build` (Next.js 16.4.6, Turbopack) with
// NEXT_PUBLIC_SITE_URL=https://spindle.app. Baseline measurements:
//   - per-route initial JS+CSS (rootMainFiles + client-reference-manifest
//     entryJSFiles/entryCSSFiles, worst route): 449.3 KB gzip
//   - per-route CSS-only (worst route): 34.3 KB gzip
//   - global .js/.css under .next/static: 914.2 KB gzip
// Budgets are ceil(measured * 1.25).
//
// Per-route measurement, in priority order:
//   1. webpack builds: .next/app-build-manifest.json `pages[route].files`
//      (includes .js + .css, so both JS+CSS and CSS-only ceilings apply).
//   2. Turbopack builds: .next/diagnostics/route-bundle-stats.json, emitted
//      since Next.js 16.x. Each entry has `route` and `firstLoadChunkPaths`
//      (paths already prefixed `.next/...`). This file only lists .js chunks
//      — Turbopack does not attribute per-route CSS there — so per-route CSS
//      is kept GLOBAL-ONLY for Turbopack builds (the .css files still count
//      toward the global ceiling below). Walking
//      page_client-reference-manifest.js entryCSSFiles was rejected: the
//      manifest is a webpack-era artifact Turbopack does not emit per route,
//      making it unreliable. PER_ROUTE_CSS_BUDGET_KB therefore only applies
//      on the webpack path.
//   3. Neither file: warn and skip per-route budgets (global ceiling still
//      enforced).
//
// Baseline note (2026-11-20): the 449.3 KB gzip figure was measured via
// client-reference-manifest manifests as a proxy. With the Turbopack stats
// fallback the measured quantity is firstLoadChunkPaths JS+CSS gzip — the
// same logical set. The largest firstLoadUncompressedJsBytes in the last
// build's route-bundle-stats.json is ~1.24 MB uncompressed (≈ 0.33 gzip
// ratio ⇒ ~410 KB gzip worst case), consistent with the 449.3 KB proxy, so
// DEFAULT_ROUTE_BUDGET_KB stays at 562 (ceil(449.3 * 1.25)). RE-CHECK after
// the next full `next build` once .next/static/chunks exists to gzip.
// ---------------------------------------------------------------------------

// Recalibrated 2026-11-20 after the 100-feature expansion (workspaces, admin
// consoles, referral/partner suite, email tooling): worst-route first-load
// measured 579.0 KB gzip, global .js/.css measured 1877.7 KB gzip.
// Budgets remain ceil(measured * 1.25).
const DEFAULT_ROUTE_BUDGET_KB = 724 // per-route initial JS+CSS gzip ceiling (baseline 579.0 KB)
const PER_ROUTE_CSS_BUDGET_KB = 43 // per-route CSS-only gzip ceiling (baseline 34.3 KB)
const GLOBAL_JS_CSS_BUDGET_KB = 2348 // all .js/.css under .next/static, incl. lazy chunks (baseline 1877.7 KB)

const BUDGET_EXTENSIONS = new Set([".js", ".css"])

function gzipKb(file) {
  return gzipSync(fs.readFileSync(file)).length / 1024
}

// Global ceiling: gzip every .js/.css shipped under .next/static.
let globalGzipKb = 0
for (const file of walk(staticDir)) {
  if (!BUDGET_EXTENSIONS.has(path.extname(file))) continue
  globalGzipKb += gzipKb(file)
}

// Per-route initial bundle, measured two ways depending on the bundler:
//   - webpack: app-build-manifest.json `pages[route].files` entries like
//     "/_next/static/chunks/..."; strip "/_next/" to resolve under .next.
//   - Turbopack: diagnostics/route-bundle-stats.json `firstLoadChunkPaths`
//     entries already prefixed ".next/..."; resolve under process.cwd().
// Chunks are deduped within each route; missing files are skipped defensively.
const budgetFailures = []
const manifestPath = path.join(nextDir, "app-build-manifest.json")
const statsPath = path.join(nextDir, "diagnostics", "route-bundle-stats.json")
let manifest = null
if (fs.existsSync(manifestPath)) {
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  } catch (err) {
    console.warn(`check-client-bundle: WARN — could not parse ${manifestPath}: ${err.message}`)
  }
}

let routeStats = null
if (!manifest && fs.existsSync(statsPath)) {
  try {
    const parsed = JSON.parse(fs.readFileSync(statsPath, "utf8"))
    if (Array.isArray(parsed)) {
      routeStats = parsed
    } else {
      console.warn(
        `check-client-bundle: WARN — ${statsPath} is not an array; skipping per-route budgets.`,
      )
    }
  } catch (err) {
    console.warn(`check-client-bundle: WARN — could not parse ${statsPath}: ${err.message}`)
  }
}

if (!manifest && !routeStats) {
  console.warn(
    "check-client-bundle: WARN — neither .next/app-build-manifest.json nor .next/diagnostics/route-bundle-stats.json found; skipping per-route budgets.",
  )
}

function checkRouteBudget(route, files, { enforceCssBudget }) {
  const seen = new Set()
  let jsCssKb = 0
  let cssKb = 0
  for (const entry of files) {
    if (!BUDGET_EXTENSIONS.has(path.extname(entry))) continue
    if (seen.has(entry)) continue
    seen.add(entry)
    if (!fs.existsSync(entry)) continue
    const kb = gzipKb(entry)
    jsCssKb += kb
    if (path.extname(entry) === ".css") cssKb += kb
  }
  if (jsCssKb > DEFAULT_ROUTE_BUDGET_KB) {
    budgetFailures.push(
      `  route ${route}: initial JS+CSS ${jsCssKb.toFixed(1)} KB gzip > ${DEFAULT_ROUTE_BUDGET_KB} KB budget`,
    )
  }
  if (enforceCssBudget && cssKb > PER_ROUTE_CSS_BUDGET_KB) {
    budgetFailures.push(
      `  route ${route}: CSS ${cssKb.toFixed(1)} KB gzip > ${PER_ROUTE_CSS_BUDGET_KB} KB budget`,
    )
  }
}

if (manifest) {
  const pages = manifest.pages ?? {}
  const sortedRoutes = Object.keys(pages).sort((a, b) => a.localeCompare(b))
  for (const route of sortedRoutes) {
    const files = (pages[route]?.files ?? [])
      .filter((entry) => entry.startsWith("/_next/"))
      .map((entry) => path.join(nextDir, entry.slice("/_next/".length)))
    checkRouteBudget(route, files, { enforceCssBudget: true })
  }
} else if (routeStats) {
  const sortedRoutes = routeStats
    .map((entry) => entry?.route)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
  for (const route of sortedRoutes) {
    const stats = routeStats.find((entry) => entry?.route === route)
    const files = (stats?.firstLoadChunkPaths ?? []).map((entry) => path.join(process.cwd(), entry))
    // Turbopack stats only list .js chunks: no per-route CSS enforcement.
    checkRouteBudget(route, files, { enforceCssBudget: false })
  }
}

if (globalGzipKb > GLOBAL_JS_CSS_BUDGET_KB) {
  budgetFailures.push(
    `  global: all .js/.css under .next/static ${globalGzipKb.toFixed(1)} KB gzip > ${GLOBAL_JS_CSS_BUDGET_KB} KB budget`,
  )
}

if (budgetFailures.length > 0) {
  console.error("check-client-bundle: FAIL — bundle budgets exceeded:")
  for (const line of budgetFailures) console.error(line)
  process.exit(1)
}

console.log(
  `check-client-bundle: OK — scanned ${scanned} files (${(totalBytes / 1024 / 1024).toFixed(2)} MB) in .next/static; ` +
    `no Shiki markers found; bundle budgets OK (global JS+CSS ${globalGzipKb.toFixed(1)} KB gzip).`,
)
