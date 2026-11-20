#!/usr/bin/env node
// Feature-flag cleanup automation.
//
// Scans the source tree for feature-flag usage, cross-references the flag
// registry discovered under src/lib/feature-flags (or --registry), and emits
// a cleanup report (Markdown + JSON) classifying flags as:
//
//   - fully-rolled-out : registry says 100%/enabled everywhere -> safe to
//                        remove the flag check and keep the "on" branch
//   - fully-off        : registry says 0%/disabled everywhere -> safe to
//                        remove the check and keep the "off" branch
//   - unused           : registered but never referenced in src/
//   - test-only        : referenced only from *.test.* / *.spec.* files
//   - stale-reference  : code calls a flag key that is not in the registry
//   - partial          : still rolling out — leave alone
//
// Usage:
//   node scripts/feature-flags/cleanup.mjs                 # report-only scan of src/
//   node scripts/feature-flags/cleanup.mjs --demo          # scan the bundled fixture
//   node scripts/feature-flags/cleanup.mjs --json out.json --markdown out.md
//   node scripts/feature-flags/cleanup.mjs --apply --dry-run   # print a diff plan
//
// --apply is deliberately two-step: it REQUIRES --dry-run and never edits
// application files. It produces a unified-diff plan (written to
// docs/feature-flags/cleanup-plan.diff) describing the safe mechanical
// rewrites for fully-rolled-out / fully-off flags. Anything ambiguous is
// listed under "manual review" instead of being rewritten.

import fs from "node:fs"
import path from "node:path"

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const ROOT = process.cwd()

function parseArgs(argv) {
  const args = {
    demo: false,
    apply: false,
    dryRun: false,
    json: null,
    markdown: null,
    scanDir: "src",
    registryDir: null,
    registryFile: null,
    outDir: null,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => argv[++i]
    switch (arg) {
      case "--demo":
        args.demo = true
        break
      case "--apply":
        args.apply = true
        break
      case "--dry-run":
        args.dryRun = true
        break
      case "--json":
        args.json = next()
        break
      case "--markdown":
        args.markdown = next()
        break
      case "--scan-dir":
        args.scanDir = next()
        break
      case "--registry-dir":
        args.registryDir = next()
        break
      case "--registry":
        args.registryFile = next()
        break
      case "--out-dir":
        args.outDir = next()
        break
      case "-h":
      case "--help":
        args.help = true
        break
      default:
        console.error(`cleanup: unknown argument ${arg}`)
        process.exit(2)
    }
  }
  if (args.apply && !args.dryRun) {
    console.error(
      "cleanup: --apply requires --dry-run.\n" +
        "  The apply mode never edits application files directly; it only emits a\n" +
        "  unified-diff plan. Run: node scripts/feature-flags/cleanup.mjs --apply --dry-run",
    )
    process.exit(2)
  }
  return args
}

const USAGE = `Feature-flag cleanup scanner.

Options:
  --demo                 Scan the bundled demo fixture instead of src/
  --scan-dir <dir>       Source root to scan (default: src)
  --registry-dir <dir>   Directory containing the flag registry
                         (default: <scan-dir>/lib/feature-flags)
  --registry <file>      Single registry file (skips directory discovery)
  --json <file>          Write the machine-readable report
  --markdown <file>      Write the Markdown report
  --out-dir <dir>        Output directory for default report paths
                         (default: docs/feature-flags, or docs/feature-flags/demo in --demo)
  --apply --dry-run      Emit a unified-diff cleanup plan (never edits src/)
  -h, --help             Show this help
`

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "coverage",
  "dist",
  "storybook-static",
  "test-results",
  "public",
  "legacy",
])

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs"])

function* walk(dir) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(full)
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      yield full
    }
  }
}

function readSource(file) {
  try {
    return fs.readFileSync(file, "utf8")
  } catch {
    return null
  }
}

function rel(file, base) {
  return path.relative(base, file).split(path.sep).join("/")
}

// ---------------------------------------------------------------------------
// Registry discovery
// ---------------------------------------------------------------------------
//
// The flag registry format is owned by the feature-flag module (see
// src/lib/feature-flags). Rather than hard-coding one schema, we recognise
// the common shapes:
//
//   export const FLAG_REGISTRY = [
//     { key: "new-ui", percent: 100, enabled: true },
//     { flag: "beta-export", status: "off" },
//   ]
//
//   export const FLAGS = {
//     "new-ui": { percent: 100 },
//     dark_mode: { enabled: false },
//   }
//
//   export const flagDefinitions = new Map([
//     ["new-ui", { rollout: 1.0 }],
//   ])
//
// For each candidate key we also capture rollout attributes that appear
// within a short window after the key (percent/percentage/rollout numbers,
// enabled/disabled booleans, status strings, default values).

// `name:` is a weak key indicator — real registries also use it as a field
// *inside* each entry, so it must not act as an entry boundary.
const KEY_FIELD_RE =
  /(?:^|[{,\s])(?:key|flagKey|featureKey|flag|flagName)\s*:\s*["'`]([A-Za-z0-9][\w.-]{1,127})["'`]/g

const WEAK_NAME_RE = /(?:^|[{,\s])name\s*:\s*["'`]([A-Za-z0-9][\w.-]{1,127})["'`]/g

const OBJECT_KEY_RE =
  /(?:^|[{,\s])(?:["'`]([A-Za-z0-9][\w.-]{1,127})["'`]|([A-Za-z_$][\w$]*))\s*:\s*\{/g

const MAP_KEY_RE = /\[\s*["'`]([A-Za-z0-9][\w.-]{1,127})["'`]\s*\]\s*:/g

// Matches the real registry shape: `defaults: { fallback: false,
// production: { percentage: 25 }, ... }` inside a flag definition.
const DEFAULTS_RE = /\bdefaults\s*:\s*\{/g

/** Extracts the balanced `{...}` block starting at `openIndex`. */
function extractBlock(source, openIndex) {
  let depth = 0
  let inString = null
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i]
    if (inString) {
      if (ch === "\\") i++
      else if (ch === inString) inString = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") inString = ch
    else if (ch === "{") depth++
    else if (ch === "}") {
      depth--
      if (depth === 0) return source.slice(openIndex, i + 1)
    }
  }
  return source.slice(openIndex)
}

/**
 * Parses a `defaults` object literal into per-environment targets.
 * Values may be `true`, `false`, or `{ percentage: N }`.
 */
function parseDefaultsTargets(block) {
  const targets = {}
  const inner = block.replace(/^\{/, "").replace(/\}$/, "")
  const pairRe = /([A-Za-z_][\w-]*)\s*:\s*(true|false|\{\s*percentage\s*:\s*(\d+(?:\.\d+)?)\s*\})/g
  for (const match of inner.matchAll(pairRe)) {
    const [, env, raw, pct] = match
    if (raw === "true") targets[env] = true
    else if (raw === "false") targets[env] = false
    else targets[env] = { percentage: parseFloat(pct) }
  }
  return targets
}

function targetOn(target) {
  if (target === true) return true
  if (target === false) return false
  if (target && typeof target === "object") return target.percentage >= 100
  return null
}

function targetOff(target) {
  if (target === true) return false
  if (target === false) return true
  if (target && typeof target === "object") return target.percentage <= 0
  return null
}

/**
 * Classifies a flag from its `defaults` map. `fallback` applies to every
 * environment without an explicit entry, so:
 *   - on      : fallback === true (covers every env)
 *   - off     : fallback === false AND every explicit env target is off
 *   - partial : anything else (env-dependent)
 * Runtime FEATURE_FLAG_* overrides can still flip any flag — callers get a
 * caveat in the report.
 */
function classifyDefaults(targets) {
  const entries = Object.entries(targets)
  if (entries.length === 0) return null
  const fallback = targets.fallback
  const explicit = entries.filter(([env]) => env !== "fallback")

  const fallbackOn = targetOn(fallback)
  const fallbackOff = targetOff(fallback)

  if (fallbackOn === true) {
    // fallback on; flag is fully on unless an explicit env disables it
    const anyOff = explicit.some(([, t]) => targetOff(t) === true)
    return anyOff ? "partial" : "on"
  }
  if (fallbackOff === true) {
    const anyOn = explicit.some(([, t]) => targetOn(t) === true)
    return anyOn ? "partial" : "off"
  }
  // fallback missing or a partial percentage
  if (fallback && typeof fallback === "object") {
    const pct = fallback.percentage
    if (pct >= 100) return "on"
    if (pct <= 0) return "off"
    return "partial"
  }
  return "partial"
}

function* attributeMatches(window) {
  // yields { kind, value } for recognised rollout attributes
  const patterns = [
    { kind: "percent", re: /\b(?:percent|percentage|rolloutPercent)\s*:\s*(\d+(?:\.\d+)?)\s*%?/g },
    {
      kind: "rollout",
      re: /\b(?:rollout|rolloutFraction)\s*:\s*(\d+(?:\.\d+)?)\s*(?:\/\s*100|%|\b)/g,
    },
    { kind: "enabled", re: /\benabled\s*:\s*(true|false)\b/g },
    { kind: "disabled", re: /\bdisabled\s*:\s*(true|false)\b/g },
    { kind: "status", re: /\bstatus\s*:\s*["'`]([A-Za-z_-]+)["'`]/g },
    { kind: "default", re: /\bdefault(?:Value)?\s*:\s*(true|false)\b/g },
  ]
  for (const { kind, re } of patterns) {
    for (const match of window.matchAll(re)) {
      yield { kind, value: match[1] }
    }
  }
}

function classifyEntry(key, attrs) {
  let percent = null
  let enabled = null
  let status = null
  let defaultValue = null
  for (const { kind, value } of attrs) {
    if (kind === "percent") percent = Math.min(100, parseFloat(value))
    else if (kind === "rollout") {
      const n = parseFloat(value)
      // heuristic: <=1 treated as a fraction, >1 as a percentage
      percent = percent ?? (n <= 1 ? n * 100 : Math.min(100, n))
    } else if (kind === "enabled") enabled = value === "true"
    else if (kind === "disabled") enabled = value === "false" ? false : true
    else if (kind === "status") status = value.toLowerCase()
    else if (kind === "default") defaultValue = value === "true"
  }

  const ON_STATUSES = new Set([
    "on",
    "enabled",
    "active",
    "ga",
    "rolled-out",
    "rolled_out",
    "released",
    "stable",
  ])
  const OFF_STATUSES = new Set([
    "off",
    "disabled",
    "inactive",
    "killed",
    "deprecated",
    "removed",
    "internal",
  ])

  let state = "unknown"
  if (percent !== null) {
    if (percent >= 100) state = "on"
    else if (percent <= 0) state = "off"
    else state = "partial"
  } else if (status !== null && ON_STATUSES.has(status)) state = "on"
  else if (status !== null && OFF_STATUSES.has(status)) state = "off"
  else if (enabled !== null) state = enabled ? "on" : "off"
  else if (defaultValue !== null) state = defaultValue ? "on" : "off"

  return { key, percent, enabled, status, defaultValue, state }
}

function extractRegistryEntries(source, file) {
  const entries = new Map()

  // Parses rollout state out of an entry's source text: prefers a `defaults`
  // map (the real registry shape), falls back to loose attribute matching.
  const classifyText = (key, text) => {
    for (const m of text.matchAll(DEFAULTS_RE)) {
      const braceIndex = m.index + m[0].length - 1
      const block = extractBlock(text, braceIndex)
      const targets = parseDefaultsTargets(block)
      const state = classifyDefaults(targets)
      if (state !== null) {
        return {
          key,
          state,
          targets,
          percent: null,
          enabled: null,
          status: null,
          defaultValue: null,
        }
      }
    }
    return classifyEntry(key, [...attributeMatches(text)])
  }

  // Object-literal entries (`"flag-name": { ... }`) get a precise
  // brace-matched block so nested fields can't be mistaken for siblings.
  for (const match of source.matchAll(OBJECT_KEY_RE)) {
    const key = match[1] ?? match[2]
    if (!key || entries.has(key)) continue
    if (!/[a-z][A-Z]/.test(key) && !/[-_]/.test(key) && key !== key.toUpperCase()) continue
    const braceIndex = match.index + match[0].length - 1
    const block = extractBlock(source, braceIndex)
    entries.set(key, classifyText(key, block))
  }

  // Field-style and Map-style entries use a bounded window: entry starts are
  // strong key fields plus every object/map key position.
  const boundaries = []
  for (const re of [KEY_FIELD_RE, OBJECT_KEY_RE, MAP_KEY_RE]) {
    for (const match of source.matchAll(re)) boundaries.push(match.index)
  }
  boundaries.sort((a, b) => a - b)

  const addWindowed = (key, index) => {
    if (!key || entries.has(key)) return
    const next = boundaries.find((b) => b > index)
    const end = Math.min(index + 600, next ?? index + 600)
    entries.set(key, classifyText(key, source.slice(index, end)))
  }

  for (const match of source.matchAll(KEY_FIELD_RE)) {
    addWindowed(match[1], match.index)
  }
  for (const match of source.matchAll(MAP_KEY_RE)) {
    addWindowed(match[1], match.index)
  }
  // Weak `name:` fields only count when the value looks flag-ish.
  for (const match of source.matchAll(WEAK_NAME_RE)) {
    const key = match[1]
    if (key && (/[a-z][A-Z]/.test(key) || /[-_]/.test(key))) {
      addWindowed(key, match.index)
    }
  }
  return { file, entries }
}

function collectRegistryFiles(registryDir, registryFile) {
  if (registryFile) {
    const abs = path.resolve(ROOT, registryFile)
    return fs.existsSync(abs) ? [abs] : []
  }
  if (!registryDir || !fs.existsSync(registryDir)) return []
  return [...walk(registryDir)].filter(
    (f) =>
      !f.includes(`${path.sep}analytics${path.sep}`) &&
      !/\.(test|spec|stories)\.[tj]sx?$/.test(f) &&
      !f.includes(`${path.sep}__tests__${path.sep}`),
  )
}

function discoverRegistry({ registryDir, registryFile }) {
  const files = collectRegistryFiles(registryDir, registryFile)
  const all = new Map()
  const sources = []
  const definitionFiles = new Set()
  for (const file of files) {
    const source = readSource(file)
    if (source === null) continue
    sources.push({ file, source })
    const { entries } = extractRegistryEntries(source, file)
    if (entries.size > 0) definitionFiles.add(file)
    for (const [key, entry] of entries) {
      if (!all.has(key)) all.set(key, { ...entry, definedIn: rel(file, ROOT) })
    }
  }
  return { files: sources.map((s) => s.file), entries: all, sources, definitionFiles }
}

// ---------------------------------------------------------------------------
// Usage scanning
// ---------------------------------------------------------------------------

// Common evaluation APIs across flag systems. Extend as the real API lands.
const CALL_RE =
  /\b(?:useFeatureFlag|useFeatureFlags|useFlag|useFlags|featureFlag|evaluateFlag|evaluateFlagByName|isFeatureEnabled|isFlagEnabled|flagEnabled|checkFlag|getFlag|getFeatureFlag|getFeatureFlags|getFlagDefinition|hasFeature)\s*\(\s*["'`]([A-Za-z0-9][\w.-]{0,127})["'`]/g

// Member access is restricted to the known registry object names — a generic
// `flags.`/`flag.` would match unrelated config objects (e.g. `flags.csp`).
const CONDITIONAL_RE =
  /\b(?:featureFlags|flagRegistry|featureFlagRegistry)\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*["'`]([A-Za-z0-9][\w.-]{0,127})["'`]\s*\])/g

const IMPORT_RE = /(?:import|export)[^"'`]*?from\s*["'`]([^"'`]*(?:flag|flags)[^"'`]*)["'`]/g

function isTestFile(file) {
  return (
    /\.(test|spec|stories)\.[tj]sx?$/.test(file) || file.includes(`${path.sep}__tests__${path.sep}`)
  )
}

function scanUsages(scanDir, registryKeys, definitionFiles = new Set()) {
  const usages = new Map() // key -> usage[]
  const unknownCalls = [] // calls referencing keys not in the registry
  const flagModuleImports = new Map() // file -> module specifier
  const filesScanned = []

  const addUsage = (key, file, line, kind) => {
    if (!usages.has(key)) usages.set(key, [])
    const list = usages.get(key)
    if (!list.some((u) => u.file === file && u.line === line)) {
      list.push({ file, line, kind, test: isTestFile(file) })
    }
  }

  for (const file of walk(scanDir)) {
    const abs = path.isAbsolute(file) ? file : path.join(ROOT, file)
    // Registry definition files declare flags; their string literals are
    // definitions, not usages.
    if (definitionFiles.has(abs)) continue
    const source = readSource(abs)
    if (source === null) continue
    filesScanned.push(abs)
    const relFile = rel(abs, ROOT)

    for (const match of source.matchAll(IMPORT_RE)) {
      if (!flagModuleImports.has(relFile)) flagModuleImports.set(relFile, new Set())
      flagModuleImports.get(relFile).add(match[1])
    }

    const lineOf = (index) => {
      let line = 1
      for (let i = 0; i < index && i < source.length; i++) if (source[i] === "\n") line++
      return line
    }

    for (const match of source.matchAll(CALL_RE)) {
      const key = match[1]
      const line = lineOf(match.index)
      if (registryKeys.has(key)) addUsage(key, relFile, line, "call")
      else unknownCalls.push({ key, file: relFile, line, kind: "call" })
    }

    for (const match of source.matchAll(CONDITIONAL_RE)) {
      const key = match[1] ?? match[2]
      if (!key) continue
      const line = lineOf(match.index)
      if (registryKeys.has(key)) addUsage(key, relFile, line, "member-access")
      else unknownCalls.push({ key, file: relFile, line, kind: "member-access" })
    }

    // Literal mentions of registered keys catch indirect references
    // (constants, config objects) that the call patterns miss. Skip lines
    // already recorded as call/member-access for this file.
    for (const key of registryKeys) {
      const literalRe = new RegExp(`["'\`]${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`]`, "g")
      for (const match of source.matchAll(literalRe)) {
        const line = lineOf(match.index)
        const existing = usages.get(key) ?? []
        if (!existing.some((u) => u.file === relFile && u.line === line)) {
          addUsage(key, relFile, line, "reference")
        }
      }
    }
  }

  return { usages, unknownCalls, flagModuleImports, filesScanned }
}

// ---------------------------------------------------------------------------
// Classification & report
// ---------------------------------------------------------------------------

function buildReport({
  registry,
  usages,
  unknownCalls,
  flagModuleImports,
  filesScanned,
  scanDir,
  registryDir,
}) {
  const flags = []
  for (const [key, entry] of registry.entries) {
    const flagUsages = usages.get(key) ?? []
    const prodUsages = flagUsages.filter((u) => !u.test)
    const testUsages = flagUsages.filter((u) => u.test)
    let category
    if (prodUsages.length === 0 && testUsages.length === 0) category = "unused"
    else if (prodUsages.length === 0) category = "test-only"
    else if (entry.state === "on") category = "fully-rolled-out"
    else if (entry.state === "off") category = "fully-off"
    else if (entry.state === "unknown") category = "unresolved"
    else category = "partial"

    flags.push({
      key,
      state: entry.state,
      percent: entry.percent,
      status: entry.status,
      targets: entry.targets ?? null,
      definedIn: entry.definedIn,
      category,
      usageCount: flagUsages.length,
      prodUsageCount: prodUsages.length,
      testUsageCount: testUsages.length,
      usages: flagUsages.slice(0, 50), // cap detail; counts stay accurate
    })
  }

  // unknownCalls: dedupe by key+file+line. References from inside the flag
  // module itself are usually intentional (tests of unknown-name handling)
  // and are excluded from the stale list.
  const registryPrefix = registryDir && registryDir !== "(none)" ? `${registryDir}/` : null
  const stale = [
    ...new Map(
      unknownCalls
        .filter((u) => !(registryPrefix && u.file.startsWith(registryPrefix)))
        .map((u) => [`${u.file}:${u.line}:${u.key}`, u]),
    ).values(),
  ]

  return {
    generatedAt: new Date().toISOString(),
    scanDir,
    registryDir,
    registryFileCount: registry.files.length,
    filesScanned: filesScanned.length,
    flags,
    staleReferences: stale,
    flagModuleImports: Object.fromEntries(
      [...flagModuleImports].map(([file, mods]) => [file, [...mods]]),
    ),
    summary: {
      total: flags.length,
      fullyRolledOut: flags.filter((f) => f.category === "fully-rolled-out").length,
      fullyOff: flags.filter((f) => f.category === "fully-off").length,
      unused: flags.filter((f) => f.category === "unused").length,
      testOnly: flags.filter((f) => f.category === "test-only").length,
      partial: flags.filter((f) => f.category === "partial").length,
      unresolved: flags.filter((f) => f.category === "unresolved").length,
      staleReferences: stale.length,
    },
  }
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

function usageLine(u) {
  return `    - \`${u.file}:${u.line}\` (${u.kind}${u.test ? ", test" : ""})`
}

function renderMarkdown(report, { demo }) {
  const out = []
  out.push(`# Feature-flag cleanup report${demo ? " (demo)" : ""}`)
  out.push("")
  out.push(`- Generated: ${report.generatedAt}`)
  out.push(`- Scan root: \`${report.scanDir}\``)
  out.push(`- Registry files: ${report.registryFileCount}`)
  out.push(`- Source files scanned: ${report.filesScanned}`)
  out.push("")
  const s = report.summary
  out.push("## Summary")
  out.push("")
  out.push(`| Category | Count |`)
  out.push(`| --- | --- |`)
  out.push(`| Fully rolled out (remove check, keep on-branch) | ${s.fullyRolledOut} |`)
  out.push(`| Fully off (remove check, keep off-branch) | ${s.fullyOff} |`)
  out.push(`| Unused (delete registry entry) | ${s.unused} |`)
  out.push(`| Test-only references | ${s.testOnly} |`)
  out.push(`| Still rolling out (leave alone) | ${s.partial} |`)
  out.push(`| Unresolved state | ${s.unresolved} |`)
  out.push(`| Stale references (not in registry) | ${s.staleReferences} |`)
  out.push("")

  out.push(
    "> Note: runtime `FEATURE_FLAG_*` environment overrides can flip any flag regardless of registry defaults. Verify overrides (see `src/lib/feature-flags/env.ts`) before deleting a flag.",
  )
  out.push("")

  const section = (title, predicate, note) => {
    const items = report.flags.filter(predicate)
    if (items.length === 0) return
    out.push(`## ${title}`)
    out.push("")
    if (note) {
      out.push(note)
      out.push("")
    }
    for (const flag of items) {
      out.push(`### \`${flag.key}\``)
      out.push("")
      out.push(
        `- State: \`${flag.state}\`${flag.percent !== null ? `, percent: ${flag.percent}` : ""}${flag.status ? `, status: ${flag.status}` : ""}`,
      )
      if (flag.targets) {
        const envs = Object.entries(flag.targets)
          .map(([env, t]) => `${env}=${typeof t === "object" ? `${t.percentage}%` : t}`)
          .join(", ")
        out.push(`- Defaults: ${envs}`)
      }
      if (flag.definedIn) out.push(`- Defined in: \`${flag.definedIn}\``)
      out.push(
        `- Usages: ${flag.usageCount} (${flag.prodUsageCount} prod, ${flag.testUsageCount} test)`,
      )
      for (const u of flag.usages.slice(0, 10)) out.push(usageLine(u))
      if (flag.usageCount > 10) out.push(`    - … ${flag.usageCount - 10} more`)
      out.push("")
    }
  }

  section(
    "Fully rolled-out flags",
    (f) => f.category === "fully-rolled-out",
    "Registry reports these as enabled for 100% of subjects. Removing the check and keeping the enabled branch is behaviour-preserving. Use `--apply --dry-run` to generate a diff plan.",
  )
  section(
    "Fully-off flags",
    (f) => f.category === "fully-off",
    "Registry reports these as disabled for everyone. Removing the check and keeping the disabled branch is behaviour-preserving.",
  )
  section(
    "Unused flags",
    (f) => f.category === "unused",
    "Registered but never referenced in scanned sources. Candidates for deletion from the registry.",
  )
  section(
    "Test-only flags",
    (f) => f.category === "test-only",
    "Referenced only from test/story files. Confirm whether the flag is still needed before removing.",
  )
  section("Still rolling out", (f) => f.category === "partial", "Partial rollout — do not touch.")
  section(
    "Unresolved flags",
    (f) => f.category === "unresolved",
    "Registry entry found but rollout state could not be determined. Inspect manually or extend the attribute parser in cleanup.mjs.",
  )

  if (report.staleReferences.length > 0) {
    out.push("## Stale references")
    out.push("")
    out.push("Code references flag keys that are not present in the registry:")
    out.push("")
    const byKey = new Map()
    for (const u of report.staleReferences) {
      if (!byKey.has(u.key)) byKey.set(u.key, [])
      byKey.get(u.key).push(u)
    }
    for (const [key, list] of byKey) {
      out.push(`### \`${key}\``)
      out.push("")
      for (const u of list.slice(0, 10)) out.push(usageLine(u))
      if (list.length > 10) out.push(`    - … ${list.length - 10} more`)
      out.push("")
    }
  }

  if (report.flags.length === 0 && report.staleReferences.length === 0) {
    out.push("## Notes")
    out.push("")
    out.push(
      "No flags discovered. The registry may not exist yet, or uses a format the heuristic parser does not recognise. Point `--registry` at the registry file, or extend `extractRegistryEntries()` in `scripts/feature-flags/cleanup.mjs`.",
    )
    out.push("")
  }

  return out.join("\n")
}

// ---------------------------------------------------------------------------
// --apply --dry-run: unified-diff plan (never writes to src/)
// ---------------------------------------------------------------------------

// Whitelist: only plain call-site expressions are rewritten mechanically.
// JSX branches, member access, and anything multi-line go to manual review.
const SAFE_CALL_RE =
  /\b(useFeatureFlag|useFeatureFlags|useFlag|useFlags|featureFlag|evaluateFlag|evaluateFlagByName|isFeatureEnabled|isFlagEnabled|flagEnabled|checkFlag|getFlag|getFeatureFlag|getFeatureFlags|getFlagDefinition|hasFeature)\s*\(\s*["'`]([A-Za-z0-9][\w.-]{0,127})["'`]\s*\)/g

function buildApplyPlan(report) {
  const removable = new Map() // file -> Map(line -> replacement)
  const manual = []

  const candidates = report.flags.filter(
    (f) => (f.category === "fully-rolled-out" || f.category === "fully-off") && f.usageCount > 0,
  )

  for (const flag of candidates) {
    const replacement = flag.category === "fully-rolled-out" ? "true" : "false"
    for (const usage of flag.usages) {
      if (usage.kind !== "call" && usage.kind !== "reference") {
        manual.push({ flag: flag.key, ...usage, reason: "non-call usage — review manually" })
        continue
      }
      const abs = path.join(ROOT, usage.file)
      const source = readSource(abs)
      if (source === null) continue
      const lines = source.split("\n")
      const target = lines[usage.line - 1]
      if (target === undefined) continue

      // Verify the line really is a simple safe call before planning a rewrite.
      const re = new RegExp(SAFE_CALL_RE.source, "g")
      let safe = false
      for (const m of target.matchAll(re)) {
        if (m[2] === flag.key) safe = true
      }
      if (!safe) {
        manual.push({
          flag: flag.key,
          ...usage,
          reason: "call not on a single line — review manually",
        })
        continue
      }
      if (!removable.has(usage.file)) removable.set(usage.file, new Map())
      removable.get(usage.file).set(usage.line, {
        before: target,
        after: target.replace(
          new RegExp(
            `(\\b(?:useFeatureFlag|useFeatureFlags|useFlag|useFlags|featureFlag|evaluateFlag|evaluateFlagByName|isFeatureEnabled|isFlagEnabled|flagEnabled|checkFlag|getFlag|getFeatureFlag|getFeatureFlags|getFlagDefinition|hasFeature)\\s*\\(\\s*["'\`]${flag.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`]\\s*\\))`,
            "g",
          ),
          `${replacement} /* flag "${flag.key}" ${flag.category === "fully-rolled-out" ? "fully rolled out" : "fully off"} — cleanup */`,
        ),
      })
    }
  }

  // Unused flags: plan registry-entry deletion is left to humans (format
  // unknown), so list them as manual review items.
  for (const flag of report.flags.filter((f) => f.category === "unused")) {
    manual.push({
      flag: flag.key,
      file: flag.definedIn ?? "(registry)",
      line: 0,
      kind: "registry",
      reason: "delete registry entry",
    })
  }

  // Produce a minimal unified diff per file.
  const diffs = []
  for (const [file, lineMap] of removable) {
    const abs = path.join(ROOT, file)
    const source = readSource(abs)
    if (source === null) continue
    const lines = source.split("\n")
    const hunks = []
    const sorted = [...lineMap.entries()].sort((a, b) => a[0] - b[0])
    let i = 0
    while (i < sorted.length) {
      const [start] = sorted[i]
      const end = start
      const hunkLines = []
      const ctxStart = Math.max(1, start - 3)
      const ctxEnd = Math.min(lines.length, end + 3)
      for (let n = ctxStart; n <= ctxEnd; n++) {
        const change = lineMap.get(n)
        if (change) {
          hunkLines.push(`-${change.before}`)
          hunkLines.push(`+${change.after}`)
        } else {
          hunkLines.push(` ${lines[n - 1]}`)
        }
      }
      hunks.push({ start: ctxStart, lines: hunkLines })
      i++
    }
    diffs.push(
      [
        `--- a/${file}`,
        `+++ b/${file}`,
        ...hunks.map(
          (h) =>
            `@@ -${h.start},${h.lines.filter((l) => !l.startsWith("+")).length} +${h.start},${h.lines.filter((l) => !l.startsWith("-")).length} @@\n${h.lines.join("\n")}`,
        ),
      ].join("\n"),
    )
  }

  return { diffs, manual, removableCount: [...removable.values()].reduce((n, m) => n + m.size, 0) }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(USAGE)
    return
  }

  const fixtureDir = path.join(ROOT, "scripts", "feature-flags", "demo-fixture")
  const demo = args.demo

  const scanDir = demo ? path.join(fixtureDir, "src") : path.resolve(ROOT, args.scanDir)
  const registryDir = demo
    ? path.join(fixtureDir, "src", "lib", "feature-flags")
    : args.registryDir
      ? path.resolve(ROOT, args.registryDir)
      : path.join(scanDir, "lib", "feature-flags")
  const registryFile = args.registryFile ? path.resolve(ROOT, args.registryFile) : null

  const registry = discoverRegistry({ registryDir, registryFile })
  const scan = scanUsages(scanDir, new Set(registry.entries.keys()), registry.definitionFiles)
  const report = buildReport({
    registry,
    usages: scan.usages,
    unknownCalls: scan.unknownCalls,
    flagModuleImports: scan.flagModuleImports,
    filesScanned: scan.filesScanned,
    scanDir: rel(scanDir, ROOT) || ".",
    registryDir: rel(registryDir, ROOT) || "(none)",
  })

  const outDir = args.outDir
    ? path.resolve(ROOT, args.outDir)
    : path.join(ROOT, "docs", "feature-flags", demo ? "demo" : "")
  fs.mkdirSync(outDir, { recursive: true })

  const jsonPath = args.json
    ? path.resolve(ROOT, args.json)
    : path.join(outDir, demo ? "cleanup-report-demo.json" : "cleanup-report.json")
  const mdPath = args.markdown
    ? path.resolve(ROOT, args.markdown)
    : path.join(outDir, demo ? "cleanup-report-demo.md" : "cleanup-report.md")

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n")
  const markdown = renderMarkdown(report, { demo })
  fs.writeFileSync(mdPath, markdown + "\n")

  if (args.apply) {
    const plan = buildApplyPlan(report)
    const planPath = path.join(outDir, "cleanup-plan.diff")
    const planMd = [
      "# Feature-flag cleanup plan (dry run)",
      "",
      `Generated: ${new Date().toISOString()}`,
      `Planned rewrites: ${plan.removableCount} call site(s) across ${plan.diffs.length} file(s)`,
      `Manual-review items: ${plan.manual.length}`,
      "",
      "This plan was generated with `--apply --dry-run`. No application files",
      "were modified. Review the diff, then apply manually or extend the",
      "script once the flag API stabilises.",
      "",
      "## Diff",
      "",
      "```diff",
      plan.diffs.join("\n\n") || "(no safe rewrites)",
      "```",
      "",
      "## Manual review",
      "",
      ...(plan.manual.length
        ? plan.manual.map(
            (m) => `- \`${m.flag}\` — \`${m.file}${m.line ? `:${m.line}` : ""}\`: ${m.reason}`,
          )
        : ["- (none)"]),
      "",
    ].join("\n")
    fs.writeFileSync(planPath, planMd)
    console.log(`cleanup: wrote diff plan -> ${rel(planPath, ROOT)}`)
  }

  const s = report.summary
  console.log(
    `cleanup${demo ? " (demo)" : ""}: scanned ${report.filesScanned} file(s), ` +
      `${report.registryFileCount} registry file(s), ${s.total} flag(s) ` +
      `(${s.fullyRolledOut} rolled-out, ${s.fullyOff} off, ${s.unused} unused, ` +
      `${s.staleReferences} stale refs)`,
  )
  console.log(`cleanup: report -> ${rel(mdPath, ROOT)}`)
  console.log(`cleanup: json   -> ${rel(jsonPath, ROOT)}`)
}

main()
