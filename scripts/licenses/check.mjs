#!/usr/bin/env node
/**
 * Dependency-free license compliance check for this repository.
 *
 * Reads a package-lock.json (npm lockfileVersion 2/3 `packages` map, or an
 * `npm ls --json` dependency tree via --input) and classifies every dependency
 * license against a policy file:
 *
 *   - allowed SPDX ids          -> "allowed"
 *   - denied  SPDX ids          -> "denied"   (fails the check, exit 1)
 *   - review  SPDX ids          -> "review"   (exit 2 unless --allow-review)
 *   - missing / unrecognised    -> "review"   (treated as unknown)
 *
 * SPDX expressions such as "Apache-2.0 AND LGPL-3.0-or-later" are evaluated
 * conservatively: every SPDX id mentioned in the expression is classified and
 * the package takes the worst status found (denied > review > allowed). This
 * means an OR-expression containing a denied id is flagged even if another
 * branch is permissive; tighten or annotate the policy when that happens.
 *
 * Exit codes:
 *   0  no denied packages (and no review items, or --allow-review / review ok)
 *   1  at least one denied license found
 *   2  no denied, but review/missing licenses found
 *   3  usage or I/O error
 *
 * Usage:
 *   node scripts/licenses/check.mjs [--input <file>] [--policy <file>]
 *                                   [--demo] [--json] [--allow-review]
 */

import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, "..", "..")

const DEFAULT_INPUT = resolve(REPO_ROOT, "package-lock.json")
const DEFAULT_POLICY = resolve(HERE, "licenses.policy.json")

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    input: DEFAULT_INPUT,
    policy: DEFAULT_POLICY,
    demo: false,
    json: false,
    allowReview: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--input") {
      opts.input = resolve(process.cwd(), argv[++i] ?? "")
    } else if (arg === "--policy") {
      opts.policy = resolve(process.cwd(), argv[++i] ?? "")
    } else if (arg === "--demo") {
      opts.demo = true
    } else if (arg === "--json") {
      opts.json = true
    } else if (arg === "--allow-review") {
      opts.allowReview = true
    } else if (arg === "--help" || arg === "-h") {
      opts.help = true
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return opts
}

const HELP = `License compliance check (dependency-free)

Options:
  --input <file>     Lockfile to audit (default: package-lock.json).
                     Accepts npm lockfileVersion 2/3 or 'npm ls --json' output.
  --policy <file>    Policy JSON (default: scripts/licenses/licenses.policy.json)
  --demo             Run against a built-in sample dataset instead of a file
  --json             Emit the full report as JSON on stdout
  --allow-review     Exit 0 even when review/missing licenses are present
  -h, --help         Show this help

Exit codes: 0 clean, 1 denied license found, 2 review items found,
            3 usage/I/O error.
`

// ---------------------------------------------------------------------------
// SPDX helpers
// ---------------------------------------------------------------------------

// SPDX ids look like MIT, Apache-2.0, LGPL-3.0-or-later, (MIT OR CC0-1.0).
// Operators are whole whitespace-separated tokens; ids may themselves
// contain hyphens (e.g. "LGPL-3.0-or-later"), so never rewrite inside them.
const SPDX_OPERATORS = new Set(["AND", "OR", "WITH"])
// Commas and slashes act as license separators in the wild ("MIT, ISC",
// "MIT/X11"); parens delimit SPDX expressions. None of these characters can
// appear inside a valid SPDX id, so they are all safe split points.
const SPDX_SEPARATORS = /[(),/]/g

/**
 * Extract SPDX license identifiers from a license string or expression.
 * Returns an array of unique ids. Tokens that are neither operators nor
 * valid SPDX ids are returned verbatim so classify() flags them as
 * unknown -> review instead of silently dropping them (a dropped token
 * could hide a denied license, e.g. "GPL-3.0-only, MIT").
 */
export function extractSpdxIds(license) {
  if (typeof license !== "string" || license.trim() === "") return []
  const ids = new Set()
  for (const token of license.replace(SPDX_SEPARATORS, " ").split(/\s+/)) {
    const t = token.trim().replace(/\+$/, "") // legacy "GPL-2.0+" suffix
    if (!t || SPDX_OPERATORS.has(t.toUpperCase())) continue
    // Valid ids are kept canonical; anything else is kept raw so it is
    // classified as unknown/review rather than silently ignored.
    ids.add(t)
  }
  return [...ids]
}

/**
 * Build a matcher for a policy list. Entries ending in "*" match by prefix,
 * everything else matches exactly (case-sensitive, SPDX ids are canonical).
 */
function buildMatcher(entries) {
  const exact = new Set()
  const prefixes = []
  for (const entry of entries ?? []) {
    if (typeof entry !== "string") continue
    if (entry.endsWith("*")) prefixes.push(entry.slice(0, -1))
    else exact.add(entry)
  }
  return (id) => exact.has(id) || prefixes.some((p) => id.startsWith(p))
}

/**
 * Classify one dependency.
 * Returns { status: "allowed"|"denied"|"review", license, reason, ids }.
 */
export function classify(licenseField, policy) {
  const isDenied = buildMatcher(policy.denied)
  const isReview = buildMatcher(policy.review)
  const isAllowed = buildMatcher(policy.allowed)

  const raw =
    typeof licenseField === "string"
      ? licenseField
      : licenseField && typeof licenseField === "object" && licenseField.type
        ? licenseField.type
        : null

  if (!raw) {
    return { status: "review", license: null, reason: "missing-license", ids: [] }
  }

  const ids = extractSpdxIds(raw)
  if (ids.length === 0) {
    return { status: "review", license: raw, reason: "unparseable-license", ids }
  }

  // Worst status wins: denied > review > allowed.
  let worst = "allowed"
  const reasons = []
  for (const id of ids) {
    let status
    if (isDenied(id)) {
      status = "denied"
      reasons.push(`denied id: ${id}`)
    } else if (isReview(id)) {
      status = "review"
      reasons.push(`review id: ${id}`)
    } else if (isAllowed(id)) {
      status = "allowed"
    } else {
      status = "review"
      reasons.push(`unknown id (not in policy): ${id}`)
    }
    if (status === "denied") worst = "denied"
    else if (status === "review" && worst !== "denied") worst = "review"
  }
  return { status: worst, license: raw, reason: reasons.join("; ") || "ok", ids }
}

// ---------------------------------------------------------------------------
// Lockfile parsing
// ---------------------------------------------------------------------------

/**
 * Normalise parsed lockfile/npm-ls JSON into [{name, version, license, dev}].
 */
export function extractDependencies(lock) {
  const deps = []

  // npm lockfileVersion 2/3: `packages` map keyed by install path.
  if (lock && typeof lock === "object" && lock.packages && typeof lock.packages === "object") {
    for (const [path, meta] of Object.entries(lock.packages)) {
      if (!path) continue // root project entry
      if (!meta || typeof meta !== "object") continue
      const idx = path.lastIndexOf("node_modules/")
      const name = idx >= 0 ? path.slice(idx + "node_modules/".length) : path
      deps.push({
        name,
        version: meta.version ?? null,
        license: meta.license ?? null,
        dev: Boolean(meta.dev),
        path,
      })
    }
    return deps
  }

  // `npm ls --json` output: nested `dependencies` tree keyed by package name.
  function walk(name, node, dev) {
    if (!node || typeof node !== "object") return
    if (node.version) {
      deps.push({
        name: name ?? node.name ?? null,
        version: node.version,
        license: node.license ?? null,
        dev: dev || Boolean(node.dev),
      })
    }
    if (node.dependencies && typeof node.dependencies === "object") {
      for (const [childName, child] of Object.entries(node.dependencies)) {
        walk(childName, child, dev || Boolean(node.dev))
      }
    }
  }
  // The top-level node of `npm ls --json` is the project itself, not a dep.
  if (lock.dependencies && typeof lock.dependencies === "object") {
    for (const [childName, child] of Object.entries(lock.dependencies)) {
      walk(childName, child, false)
    }
  } else {
    walk(lock.name, lock, false)
  }
  return deps
}

// ---------------------------------------------------------------------------
// Demo dataset
// ---------------------------------------------------------------------------

const DEMO_LOCK = {
  name: "demo-project",
  lockfileVersion: 3,
  packages: {
    "": { name: "demo-project", version: "0.0.0" },
    "node_modules/react": { version: "19.0.0", license: "MIT" },
    "node_modules/lodash": { version: "4.17.21", license: "MIT" },
    "node_modules/@img/sharp-libvips-linux-x64": {
      version: "1.0.0",
      license: "LGPL-3.0-or-later",
    },
    "node_modules/caniuse-lite": { version: "1.0.0", license: "CC-BY-4.0" },
    "node_modules/some-gpl-tool": { version: "1.0.0", license: "GPL-3.0-only" },
    "node_modules/no-license-pkg": { version: "1.0.0" },
    "node_modules/weird-pkg": { version: "1.0.0", license: "SEE LICENSE IN README" },
  },
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function summarise(results) {
  const byStatus = { allowed: [], denied: [], review: [] }
  const byLicense = new Map()
  for (const r of results) {
    byStatus[r.status].push(r)
    const key = r.license ?? "(missing)"
    if (!byLicense.has(key)) byLicense.set(key, { license: key, count: 0 })
    byLicense.get(key).count += 1
  }
  return { byStatus, byLicense: [...byLicense.values()].sort((a, b) => b.count - a.count) }
}

function printHuman(results, summary) {
  const { byStatus, byLicense } = summary
  console.log("License compliance report")
  console.log("=".repeat(60))
  console.log(
    `Total packages: ${results.length}  ` +
      `allowed: ${byStatus.allowed.length}  ` +
      `denied: ${byStatus.denied.length}  ` +
      `review: ${byStatus.review.length}`,
  )
  console.log("")
  console.log("License distribution:")
  for (const { license, count } of byLicense) {
    console.log(`  ${String(count).padStart(4)}  ${license}`)
  }
  for (const status of ["denied", "review"]) {
    if (byStatus[status].length === 0) continue
    console.log("")
    console.log(`${status.toUpperCase()} (${byStatus[status].length}):`)
    for (const r of byStatus[status]) {
      console.log(`  ${r.name}@${r.version ?? "?"}  license=${r.license ?? "(missing)"}`)
      if (r.reason) console.log(`      ${r.reason}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(`error: ${err.message}`)
    console.error(HELP)
    process.exit(3)
  }
  if (opts.help) {
    console.log(HELP)
    process.exit(0)
  }

  let policy
  try {
    policy = JSON.parse(readFileSync(opts.policy, "utf8"))
  } catch (err) {
    console.error(`error: cannot read policy ${opts.policy}: ${err.message}`)
    process.exit(3)
  }
  for (const key of ["allowed", "denied", "review"]) {
    if (!Array.isArray(policy[key])) {
      console.error(`error: policy ${opts.policy} missing array "${key}"`)
      process.exit(3)
    }
  }

  let lock
  if (opts.demo) {
    lock = DEMO_LOCK
  } else {
    try {
      lock = JSON.parse(readFileSync(opts.input, "utf8"))
    } catch (err) {
      console.error(`error: cannot read input ${opts.input}: ${err.message}`)
      process.exit(3)
    }
  }

  const deps = extractDependencies(lock)
  if (deps.length === 0) {
    console.error(`error: no dependencies found in ${opts.demo ? "demo data" : opts.input}`)
    process.exit(3)
  }

  const results = deps.map((d) => ({ ...d, ...classify(d.license, policy) }))
  const summary = summarise(results)

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          input: opts.demo ? "<demo>" : opts.input,
          policy: opts.policy,
          totals: {
            packages: results.length,
            allowed: summary.byStatus.allowed.length,
            denied: summary.byStatus.denied.length,
            review: summary.byStatus.review.length,
          },
          licenseDistribution: summary.byLicense,
          packages: results.map((r) => ({
            name: r.name,
            version: r.version,
            license: r.license,
            status: r.status,
            reason: r.reason === "ok" ? undefined : r.reason,
            dev: r.dev || undefined,
          })),
        },
        null,
        2,
      ),
    )
  } else {
    printHuman(results, summary)
    if (opts.demo) console.log("\n(demo mode — built-in sample data)")
  }

  const denied = summary.byStatus.denied.length
  const review = summary.byStatus.review.length
  if (denied > 0) process.exit(1)
  if (review > 0 && !opts.allowReview) process.exit(2)
  process.exit(0)
}

// Only run when invoked directly, not when imported (e.g. by tests).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
