#!/usr/bin/env node
// Error budget calculator for Spindle SLOs.
//
//   node scripts/sre/errorbudget/budget.mjs [options]
//
// Reads performance samples (JSONL: one { "ts", "ok" } or { "ts", "value" }
// object per line) and computes, per SLO window:
//
//   - error budget consumed / remaining (%)
//   - burn rate (consumed % per elapsed % of the window)
//   - projected exhaustion date
//   - per-window policy action (freeze / approval / incident review)
//
// `--record` persists per-window aggregates to a state JSON and appends one
// snapshot line to an append-only JSONL log for trend tracking across runs.
//
// `--demo` is fully offline: it generates deterministic synthetic samples
// (seeded PRNG, no network, no clock dependence for content) and never
// touches real state unless --record is also passed.
//
// Exit codes: 0 success, 2 usage/config error.

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "../..")
const DEFAULT_CONFIG = join(HERE, "budget.config.json")
const DEFAULT_STATE = join(HERE, ".state", "budget-state.json")
const DEFAULT_LOG = join(HERE, ".state", "budget.log.jsonl")

// ---------------------------------------------------------------------------
// Policy — thresholds on budget REMAINING (%) and burn rate. Mirrored in
// docs/sre/error-budget.md; keep both in sync.
// ---------------------------------------------------------------------------

const POLICY = [
  {
    remainingBelow: 10,
    burnRateAtLeast: 0,
    action: "deploy-halt",
    description:
      "Budget nearly exhausted: halt all deploys except hotfixes approved by the on-call lead; page L3.",
  },
  {
    remainingBelow: 25,
    burnRateAtLeast: 0,
    action: "incident-review",
    description:
      "Open an incident review: freeze feature work, require eng-lead sign-off for deploys, root-cause the error source.",
  },
  {
    remainingBelow: 50,
    burnRateAtLeast: 0,
    action: "approval-required",
    description:
      "Require explicit approval (risk assessment in the deploy PR) for deploys touching risky paths; no freeze yet.",
  },
  {
    remainingBelow: 100,
    burnRateAtLeast: 2,
    action: "watch",
    description:
      "Burn rate >= 2x: budget will exhaust before window end at current pace — watch closely, prep mitigation.",
  },
  {
    remainingBelow: 100,
    burnRateAtLeast: 0,
    action: "normal",
    description: "Within normal operating envelope.",
  },
]

// ---------------------------------------------------------------------------
// Duration parsing: 15m, 1h, 24h, 7d, 30d, 4w
// ---------------------------------------------------------------------------

const DURATION_UNITS = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }

function parseDuration(input) {
  const match = /^(\d+(?:\.\d+)?)([mhdw])$/.exec(String(input).trim().toLowerCase())
  if (!match) {
    throw new Error(`invalid duration "${input}" — expected e.g. 15m, 1h, 24h, 7d, 30d, 4w`)
  }
  return Number(match[1]) * DURATION_UNITS[match[2]]
}

function formatDuration(ms) {
  for (const [suffix, unit] of [
    ["w", 604_800_000],
    ["d", 86_400_000],
    ["h", 3_600_000],
    ["m", 60_000],
  ]) {
    if (ms >= unit && Number.isInteger(ms / unit)) return `${ms / unit}${suffix}`
  }
  return `${Math.round(ms / 60_000)}m`
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `Usage: node scripts/sre/errorbudget/budget.mjs [options]

Options:
  --target <pct>      SLO target percent, e.g. 99.9 (required unless config/demo)
  --window <dur>      budget window, e.g. 30d, 7d, 24h — repeatable or comma list
  --service <name>    service label stored in state/log (default: config or "app")
  --input <file>      JSONL samples file — repeatable. Line: {"ts","ok":bool}
                      or {"ts","value":number} classified by --threshold
  --threshold <n>     numeric samples with value <= threshold count as good
  --state <path>      budget state JSON (default: scripts/sre/errorbudget/.state/budget-state.json)
  --log <path>        append-only snapshot log (default: .../budget.log.jsonl)
  --record            persist state + append log line (default: report only)
  --demo              offline demo: deterministic synthetic samples, ignores --input
  --json              emit the report as JSON instead of text
  --config <path>     optional config JSON (default: scripts/sre/errorbudget/budget.config.json if present)
  --help, -h          show this message

Sample JSONL format (one object per line):
  {"ts":"2025-01-01T00:00:00Z","ok":true}
  {"ts":"2025-01-01T00:00:00Z","value":187}   # good when value <= --threshold

Exit codes: 0 success, 2 usage/config error.`

function parseArgs(argv) {
  const options = {
    inputs: [],
    windows: [],
    demo: false,
    record: false,
    json: false,
    help: false,
  }
  const take = (i, flag) => {
    const v = argv[i + 1]
    if (v === undefined || v.startsWith("--")) throw new Error(`${flag} requires a value`)
    return v
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case "--target":
        options.target = Number(take(i, arg))
        i++
        break
      case "--window":
        options.windows.push(...String(take(i, arg)).split(","))
        i++
        break
      case "--service":
        options.service = take(i, arg)
        i++
        break
      case "--input":
        options.inputs.push(take(i, arg))
        i++
        break
      case "--threshold":
        options.threshold = Number(take(i, arg))
        i++
        break
      case "--state":
        options.state = take(i, arg)
        i++
        break
      case "--log":
        options.log = take(i, arg)
        i++
        break
      case "--config":
        options.config = take(i, arg)
        i++
        break
      case "--record":
        options.record = true
        break
      case "--demo":
        options.demo = true
        break
      case "--json":
        options.json = true
        break
      case "--help":
      case "-h":
        options.help = true
        break
      default:
        throw new Error(`unknown argument: ${arg}`)
    }
  }
  return options
}

async function loadConfig(path) {
  const resolved = resolve(ROOT, path)
  if (!existsSync(resolved)) return null
  return JSON.parse(await readFile(resolved, "utf8"))
}

// ---------------------------------------------------------------------------
// Samples
// ---------------------------------------------------------------------------

// Accepts {"ts","ok":bool} or {"ts","value":num} (+ --threshold). Missing ts
// inherits the previous sample's timestamp (first sample defaults to now).
function parseSampleLine(line, lineNo, threshold) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith("#")) return null
  let obj
  try {
    obj = JSON.parse(trimmed)
  } catch {
    throw new Error(`sample line ${lineNo}: invalid JSON`)
  }
  let ok
  if (typeof obj.ok === "boolean") {
    ok = obj.ok
  } else if (typeof obj.value === "number" && Number.isFinite(obj.value)) {
    if (threshold == null) {
      throw new Error(`sample line ${lineNo}: numeric "value" sample requires --threshold`)
    }
    ok = obj.value <= threshold
  } else {
    throw new Error(`sample line ${lineNo}: expected "ok" boolean or "value" number`)
  }
  return { ts: obj.ts ? new Date(obj.ts) : null, ok }
}

async function loadSamples(paths, threshold) {
  const samples = []
  let lastTs = null
  for (const path of paths) {
    const resolved = resolve(ROOT, path)
    if (!existsSync(resolved)) {
      throw new Error(`input file not found: ${resolved}`)
    }
    const text = await readFile(resolved, "utf8")
    const lines = text.split("\n")
    for (let i = 0; i < lines.length; i++) {
      const sample = parseSampleLine(lines[i], i + 1, threshold)
      if (!sample) continue
      if (!sample.ts || Number.isNaN(sample.ts.getTime())) {
        sample.ts = lastTs ? new Date(lastTs.getTime()) : new Date()
      }
      lastTs = sample.ts
      samples.push(sample)
    }
  }
  samples.sort((a, b) => a.ts.getTime() - b.ts.getTime())
  return samples
}

// Deterministic PRNG so --demo output is stable across runs/machines.
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Builds a synthetic 30-day availability trace against a 99.9% target:
// ~0.06% errors early, ramping to ~0.18% in the final week — enough burn to
// land around 55-70% of budget consumed with burn rate > 1.
function demoSamples(now = new Date()) {
  const rand = mulberry32(0x5eed)
  const spanMs = 30 * 86_400_000
  const count = 20_000
  const samples = []
  const start = now.getTime() - spanMs
  for (let i = 0; i < count; i++) {
    const frac = i / count // 0..1 across the window
    const ts = new Date(start + frac * spanMs)
    // Two-regime error probability: quiet early, hot recently.
    const pEarly = 0.0006
    const pRecent = 0.0018
    const p = frac < 0.77 ? pEarly : pEarly + ((frac - 0.77) / 0.23) * (pRecent - pEarly)
    samples.push({ ts, ok: rand() >= p })
  }
  return samples
}

// ---------------------------------------------------------------------------
// Budget math
// ---------------------------------------------------------------------------

function aggregate(samples, windowMs, now) {
  const windowStart = now.getTime() - windowMs
  let total = 0
  let bad = 0
  let firstTs = null
  let lastTs = null
  for (const s of samples) {
    const t = s.ts.getTime()
    if (t < windowStart) continue
    total++
    if (!s.ok) bad++
    if (firstTs === null || t < firstTs) firstTs = t
    if (lastTs === null || t > lastTs) lastTs = t
  }
  const elapsedMs = Math.min(windowMs, Math.max(lastTs ?? now.getTime(), windowStart) - windowStart)
  return { total, bad, firstTs, lastTs, elapsedMs }
}

function computeBudget({ target, windowMs, samples, now }) {
  const errorBudgetFraction = (100 - target) / 100
  const { total, bad, elapsedMs } = aggregate(samples, windowMs, now)

  const allowedBad = total * errorBudgetFraction
  const consumedPct = allowedBad > 0 ? (bad / allowedBad) * 100 : bad > 0 ? Infinity : 0
  const remainingPct = 100 - consumedPct
  const actualErrorRatio = total > 0 ? bad / total : 0

  // Burn rate: fraction of the window's budget consumed per fraction of the
  // window elapsed. >1 means on pace to exhaust early.
  const elapsedFraction = windowMs > 0 ? Math.min(1, elapsedMs / windowMs) : 1
  const burnRate = elapsedFraction > 0 ? consumedPct / 100 / elapsedFraction : Infinity

  // Linear projection: assume the current bad-events rate continues and the
  // allowance scales with observed volume (allowedBad grows with total).
  // Exhaustion when bad(t) = total(t) * errorBudgetFraction. With constant
  // rates this is remaining allowance / current bad rate.
  let projectedExhaustion = null
  if (bad > 0 && elapsedMs > 0) {
    const badPerMs = bad / elapsedMs
    const remainingBadAllowance = Math.max(0, allowedBad - bad)
    const msToExhaust = remainingBadAllowance / badPerMs
    projectedExhaustion = new Date(now.getTime() + msToExhaust).toISOString()
  } else if (bad === 0 && total > 0) {
    projectedExhaustion = null // no errors observed — budget not draining
  }

  // Tolerance so values landing exactly on a threshold (e.g. remaining == 25%)
  // aren't flipped into the stricter band by floating-point noise.
  const EPS = 1e-9
  const policy =
    POLICY.find(
      (p) => remainingPct < p.remainingBelow - EPS && burnRate >= p.burnRateAtLeast - EPS,
    ) ?? POLICY[POLICY.length - 1]

  return {
    target,
    window: formatDuration(windowMs),
    windowMs,
    samples: total,
    badEvents: bad,
    errorRatio: actualErrorRatio,
    budgetConsumedPct: consumedPct,
    budgetRemainingPct: remainingPct,
    burnRate,
    elapsedFraction,
    projectedExhaustion,
    policy: policy.action,
    policyDescription: policy.description,
  }
}

// ---------------------------------------------------------------------------
// State + append-only log (multi-window tracking)
// ---------------------------------------------------------------------------

async function loadState(path) {
  if (!existsSync(path)) return { version: 1, service: null, updatedAt: null, windows: {} }
  const state = JSON.parse(await readFile(path, "utf8"))
  state.windows ??= {}
  return state
}

// Fold freshly computed per-window results into persisted state. State keeps
// cumulative counters per window; a window resets when its span has fully
// elapsed since `startedAt` (fresh window starts at now - windowMs).
function updateState(state, service, results, now) {
  state.version = 1
  state.service = service
  state.updatedAt = now.toISOString()
  for (const r of results) {
    const existing = state.windows[r.window]
    const windowStartBoundary = now.getTime() - r.windowMs
    let entry
    if (
      existing?.startedAt &&
      new Date(existing.startedAt).getTime() >= windowStartBoundary &&
      existing.samples != null
    ) {
      // Same window still open: merge deltas. We cannot diff samples, so when
      // --record is used the input is expected to cover the whole current
      // window; keep max() semantics to stay idempotent on re-runs.
      entry = {
        startedAt: existing.startedAt,
        samples: Math.max(existing.samples ?? 0, r.samples),
        bad: Math.max(existing.bad ?? 0, r.badEvents),
        lastRecordedAt: now.toISOString(),
      }
    } else {
      entry = {
        startedAt: new Date(windowStartBoundary).toISOString(),
        samples: r.samples,
        bad: r.badEvents,
        lastRecordedAt: now.toISOString(),
      }
    }
    state.windows[r.window] = entry
  }
  return state
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

const pct = (n) => (Number.isFinite(n) ? `${n.toFixed(1)}%` : "n/a")
const num = (n) => (Number.isFinite(n) ? n.toFixed(2) : "n/a")

function renderReport({ service, results, source, recordedTo }) {
  const out = []
  out.push(`# Error budget report — ${service}`)
  out.push("")
  out.push(`Source: ${source}`)
  out.push(`Generated: ${new Date().toISOString()}`)
  if (recordedTo) out.push(`Recorded: ${recordedTo}`)
  out.push("")
  for (const r of results) {
    out.push(`## Window: ${r.window} (target ${r.target}%)`)
    out.push("")
    out.push(`| Metric | Value |`)
    out.push(`| ------ | ----- |`)
    out.push(`| Samples in window | ${r.samples} |`)
    out.push(`| Bad events | ${r.badEvents} |`)
    out.push(`| Observed error ratio | ${pct(r.errorRatio * 100)} |`)
    out.push(`| Budget consumed | ${pct(r.budgetConsumedPct)} |`)
    out.push(`| Budget remaining | ${pct(r.budgetRemainingPct)} |`)
    out.push(`| Burn rate | ${num(r.burnRate)}x |`)
    out.push(`| Projected exhaustion | ${r.projectedExhaustion ?? "n/a (no errors observed)"} |`)
    out.push(`| Policy | **${r.policy}** — ${r.policyDescription} |`)
    out.push("")
  }
  out.push("Policy thresholds (budget remaining): see `docs/sre/error-budget.md`.")
  return out.join("\n")
}

function toLogRecord(service, r, now) {
  return {
    ts: now.toISOString(),
    service,
    window: r.window,
    target: r.target,
    samples: r.samples,
    badEvents: r.badEvents,
    errorRatio: r.errorRatio,
    budgetConsumedPct: r.budgetConsumedPct,
    budgetRemainingPct: r.budgetRemainingPct,
    burnRate: r.burnRate,
    projectedExhaustion: r.projectedExhaustion,
    policy: r.policy,
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    console.error(USAGE)
    return 2
  }
  if (options.help) {
    console.log(USAGE)
    return 0
  }

  let config
  try {
    config = await loadConfig(options.config ?? DEFAULT_CONFIG)
  } catch (error) {
    console.error(`[budget] invalid config: ${error instanceof Error ? error.message : error}`)
    return 2
  }

  const service = options.service ?? config?.service ?? "app"
  const target = options.target ?? config?.target
  const windows = (options.windows.length > 0 ? options.windows : (config?.windows ?? ["30d"])).map(
    (w) => {
      try {
        return { raw: w.trim(), ms: parseDuration(w) }
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : String(error), { cause: error })
      }
    },
  )
  const threshold = options.threshold ?? config?.threshold

  if (options.demo) {
    // Fully offline path: deterministic samples, demo state/log paths.
    const now = new Date()
    const samples = demoSamples(now)
    const demoTarget = options.target ?? config?.target ?? 99.9
    const demoWindows =
      options.windows.length > 0
        ? windows
        : [
            { raw: "30d", ms: 30 * 86_400_000 },
            { raw: "7d", ms: 7 * 86_400_000 },
          ]
    const results = demoWindows.map((w) =>
      computeBudget({ target: demoTarget, windowMs: w.ms, samples, now }),
    )
    const statePath = resolve(ROOT, options.state ?? join(HERE, ".state", "demo-budget-state.json"))
    const logPath = resolve(ROOT, options.log ?? join(HERE, ".state", "demo-budget.log.jsonl"))
    let recordedTo = null
    if (options.record) {
      const state = updateState(await loadState(statePath), service, results, now)
      await mkdir(dirname(statePath), { recursive: true })
      await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8")
      await appendFile(
        logPath,
        results.map((r) => JSON.stringify(toLogRecord(service, r, now))).join("\n") + "\n",
        "utf8",
      )
      recordedTo = `${statePath} + ${logPath}`
    }
    if (options.json) {
      console.log(JSON.stringify({ service, demo: true, results }, null, 2))
    } else {
      console.log(
        renderReport({
          service,
          results,
          source: "--demo (deterministic synthetic samples)",
          recordedTo,
        }),
      )
    }
    return 0
  }

  try {
    if (target === undefined || !Number.isFinite(target) || target <= 0 || target >= 100) {
      throw new Error("--target (or config.target) must be a percent in (0, 100), e.g. 99.9")
    }
    if (options.inputs.length === 0) {
      throw new Error("no samples: pass --input <file.jsonl> (repeatable) or use --demo")
    }
  } catch (error) {
    console.error(`[budget] ${error instanceof Error ? error.message : error}`)
    console.error(USAGE)
    return 2
  }

  try {
    const now = new Date()
    const samples = await loadSamples(options.inputs, threshold)
    if (samples.length === 0) {
      console.error("[budget] input files contained no samples")
      return 2
    }
    const results = windows.map((w) => computeBudget({ target, windowMs: w.ms, samples, now }))

    const statePath = resolve(ROOT, options.state ?? DEFAULT_STATE)
    const logPath = resolve(ROOT, options.log ?? DEFAULT_LOG)
    let recordedTo = null
    if (options.record) {
      const state = updateState(await loadState(statePath), service, results, now)
      await mkdir(dirname(statePath), { recursive: true })
      await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8")
      await mkdir(dirname(logPath), { recursive: true })
      await appendFile(
        logPath,
        results.map((r) => JSON.stringify(toLogRecord(service, r, now))).join("\n") + "\n",
        "utf8",
      )
      recordedTo = `${statePath} + ${logPath}`
    }

    if (options.json) {
      console.log(JSON.stringify({ service, results }, null, 2))
    } else {
      console.log(
        renderReport({
          service,
          results,
          source: options.inputs.join(", "),
          recordedTo,
        }),
      )
    }
    return 0
  } catch (error) {
    console.error(`[budget] ${error instanceof Error ? error.message : error}`)
    return 2
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`[budget] unexpected error: ${error?.stack ?? error}`)
    process.exit(2)
  })
