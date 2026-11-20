#!/usr/bin/env node
/**
 * Experiment registry CLI.
 *
 * Tracks experiment lifecycle records (draft -> running -> concluded|stopped)
 * in a JSON registry file. The record shape and transition rules mirror
 * src/lib/experiments/tracking.ts — keep EXPERIMENT_TRANSITIONS below in sync
 * with EXPERIMENT_TRANSITIONS there (the CLI is plain .mjs so it cannot import
 * the TS module directly).
 *
 * Usage:
 *   node scripts/experiments/track.mjs <command> [options]
 *
 * Commands:
 *   list                          List experiments (filter: --status, --owner)
 *   show --id <id>                Show one experiment as JSON
 *   create --id <id> --hypothesis <h> --owner <o> --variant <v[:weight]>...
 *   update --id <id> [--hypothesis h] [--owner o]
 *          [--add-variant v[:weight]]... [--remove-variant name]...
 *   transition --id <id> --to <status>   Move between lifecycle states
 *   conclude --id <id> --result <win|loss|inconclusive> --summary <s>
 *          [--metric name]... [--metric-value name=value]... [--metric-link name=url]...
 *   validate                      Check the whole registry for problems
 *
 * Global options:
 *   --file <path>   Registry file (default: experiments.registry.json in cwd)
 *   --demo          Use a throwaway seeded demo registry (nothing is persisted
 *                   to the repo; the demo file lives in the OS temp dir)
 *   --json          Emit machine-readable JSON where supported
 *   -h, --help      Show this help
 *
 * See docs/experiments/tracking.md for the lifecycle, result-recording, and
 * rollback conventions.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

// --- transition table (mirror of src/lib/experiments/tracking.ts) -------------

const TRANSITIONS = {
  draft: ["running", "stopped"],
  running: ["concluded", "stopped"],
  stopped: ["running"],
  concluded: [],
}
const STATUSES = Object.keys(TRANSITIONS)
const RESULTS = ["win", "loss", "inconclusive"]
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/

// --- args --------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    command: null,
    file: "experiments.registry.json",
    demo: false,
    json: false,
    help: false,
    status: null,
    id: null,
    hypothesis: null,
    ownerValue: null,
    to: null,
    result: null,
    summary: null,
    variants: [],
    addVariants: [],
    removeVariants: [],
    metrics: [],
    metricValues: [],
    metricLinks: [],
  }
  const positionals = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => {
      const v = argv[++i]
      if (v === undefined) fail(`missing value for ${a}`)
      return v
    }
    const repeat = (key) => (v) => args[key].push(v)
    switch (a) {
      case "list":
      case "show":
      case "create":
      case "update":
      case "transition":
      case "conclude":
      case "validate":
        if (args.command) fail(`unexpected extra command: ${a}`)
        args.command = a
        break
      case "--file":
        args.file = next()
        break
      case "--demo":
        args.demo = true
        break
      case "--json":
        args.json = true
        break
      case "-h":
      case "--help":
        args.help = true
        break
      case "--status":
        args.status = next()
        break
      case "--owner":
        args.ownerValue = next()
        break
      case "--id":
        args.id = next()
        break
      case "--hypothesis":
        args.hypothesis = next()
        break
      case "--to":
        args.to = next()
        break
      case "--result":
        args.result = next()
        break
      case "--summary":
        args.summary = next()
        break
      case "--variant":
        repeat("variants")(next())
        break
      case "--add-variant":
        repeat("addVariants")(next())
        break
      case "--remove-variant":
        repeat("removeVariants")(next())
        break
      case "--metric":
        repeat("metrics")(next())
        break
      case "--metric-value":
        repeat("metricValues")(next())
        break
      case "--metric-link":
        repeat("metricLinks")(next())
        break
      default:
        if (a.startsWith("--")) fail(`unknown option: ${a}`)
        positionals.push(a)
    }
  }
  if (!args.command && positionals.length) args.command = positionals.shift()
  return args
}

function fail(msg) {
  console.error(`error: ${msg}`)
  process.exit(1)
}

// --- registry io ---------------------------------------------------------------

function resolveFile(args) {
  if (args.demo) {
    const dir = join(tmpdir(), "spindle-experiments-demo")
    mkdirSync(dir, { recursive: true })
    return join(dir, "experiments.registry.json")
  }
  return resolve(args.file)
}

function seedDemoRegistry(file) {
  if (existsSync(file)) return
  const now = Date.now()
  const iso = (d) => new Date(now - d * 86400000).toISOString()
  writeJson(file, {
    version: 1,
    experiments: [
      {
        id: "demo-checkout-copy",
        hypothesis: "Demo: 'Start free trial' CTA beats 'Sign up' on checkout",
        variants: [
          { name: "control", weight: 50 },
          { name: "treatment", weight: 50 },
        ],
        status: "running",
        owner: "demo-growth",
        createdAt: iso(14),
        startedAt: iso(12),
      },
      {
        id: "demo-onboarding-checklist",
        hypothesis: "Demo: a 3-step checklist lifts day-1 activation",
        variants: [{ name: "control" }, { name: "checklist" }],
        status: "draft",
        owner: "demo-growth",
        createdAt: iso(3),
      },
      {
        id: "demo-pricing-anchor",
        hypothesis: "Demo: annual plan anchored first increases plan upgrades",
        variants: [{ name: "control" }, { name: "annual-first" }],
        status: "concluded",
        owner: "demo-revenue",
        createdAt: iso(60),
        startedAt: iso(55),
        concludedAt: iso(20),
        conclusion: {
          result: "win",
          summary: "Annual-first lifted upgrades 8%; shipped to 100%.",
          decidedAt: iso(20),
          metrics: [{ name: "plan-upgrade-rate", value: 0.184 }],
        },
      },
    ],
  })
}

function writeJson(file, data) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n")
}

function loadRegistry(file) {
  if (!existsSync(file)) return { version: 1, experiments: [] }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"))
  } catch (err) {
    fail(`cannot parse registry ${file}: ${err.message}`)
  }
  if (!parsed || !Array.isArray(parsed.experiments)) {
    fail(`registry ${file} is missing an "experiments" array`)
  }
  return parsed
}

function saveRegistry(file, registry) {
  writeJson(file, registry)
}

function findExperiment(registry, id) {
  const e = registry.experiments.find((x) => x.id === id)
  if (!e) fail(`experiment not found: ${id} (use 'list' to see ids)`)
  return e
}

// --- domain helpers (mirror tracking.ts) --------------------------------------

function normalizeVariant(input) {
  if (typeof input !== "string") return { ...input }
  const [name, weight] = input.split(":")
  const v = { name: name.trim() }
  if (weight !== undefined) {
    const n = Number(weight)
    if (Number.isFinite(n)) v.weight = n
  }
  return v
}

function validateExperiment(e) {
  const errors = []
  if (!e || typeof e !== "object") return ["experiment must be an object"]
  if (typeof e.id !== "string" || !ID_PATTERN.test(e.id)) {
    errors.push(`id must match ${ID_PATTERN}`)
  }
  if (!e.hypothesis?.trim()) errors.push("hypothesis is required")
  if (!e.owner?.trim()) errors.push("owner is required")
  if (!ISO_DATE.test(e.createdAt ?? "")) errors.push("createdAt must be ISO-8601")
  if (!STATUSES.includes(e.status)) errors.push(`status must be one of ${STATUSES.join(", ")}`)

  if (!Array.isArray(e.variants) || e.variants.length === 0) {
    errors.push("variants must be a non-empty array")
  } else {
    const seen = new Set()
    e.variants.forEach((v, i) => {
      if (!v?.name?.trim()) errors.push(`variants[${i}].name is required`)
      else if (seen.has(v.name)) errors.push(`duplicate variant name: ${v.name}`)
      else seen.add(v.name)
      if (v?.weight !== undefined && !(typeof v.weight === "number" && v.weight > 0)) {
        errors.push(`variants[${i}].weight must be a positive number`)
      }
    })
    if (e.variants.length === 1) errors.push("need at least 2 variants")
  }

  if (e.status === "running" && !ISO_DATE.test(e.startedAt ?? "")) {
    errors.push("startedAt is required once running")
  }
  if (e.status === "concluded") {
    if (!ISO_DATE.test(e.concludedAt ?? "")) errors.push("concludedAt is required once concluded")
    const c = e.conclusion
    if (
      !c ||
      !RESULTS.includes(c.result) ||
      !c.summary?.trim() ||
      !ISO_DATE.test(c.decidedAt ?? "")
    ) {
      errors.push("conclusion (result, summary, decidedAt) is required once concluded")
    }
  }
  if (e.status === "stopped" && !ISO_DATE.test(e.stoppedAt ?? "")) {
    errors.push("stoppedAt is required once stopped")
  }
  return errors
}

function assertTransition(from, to) {
  if (!TRANSITIONS[from]?.includes(to)) {
    const allowed = TRANSITIONS[from]?.join(", ") || "(none — terminal)"
    fail(`invalid transition ${from} -> ${to}. Allowed from ${from}: ${allowed}`)
  }
}

function transition(e, to, { now, conclusion } = {}) {
  assertTransition(e.status, to)
  const ts = (now ?? new Date()).toISOString()
  const next = { ...e, status: to }
  delete next.conclusion
  if (to === "running") {
    next.startedAt = ts
    delete next.stoppedAt
  }
  if (to === "concluded") {
    if (!conclusion) fail("concluding requires --result and --summary")
    next.conclusion = conclusion
    next.concludedAt = ts
  }
  if (to === "stopped") {
    next.stoppedAt = ts
    delete next.conclusion
  }
  const errors = validateExperiment(next)
  if (errors.length) fail(`invalid transition ${e.status} -> ${to}: ${errors.join("; ")}`)
  return next
}

function buildConclusion(args) {
  if (!RESULTS.includes(args.result)) {
    fail(`--result must be one of: ${RESULTS.join(", ")}`)
  }
  if (!args.summary?.trim()) fail("--summary is required when concluding")
  const values = new Map()
  const links = new Map()
  for (const m of args.metrics) values.set(m, undefined)
  for (const mv of args.metricValues) {
    const idx = mv.indexOf("=")
    if (idx === -1) fail(`--metric-value expects name=value, got: ${mv}`)
    const name = mv.slice(0, idx).trim()
    const raw = mv.slice(idx + 1).trim()
    const num = Number(raw)
    values.set(name, Number.isFinite(num) && raw !== "" ? num : raw)
  }
  for (const ml of args.metricLinks) {
    const idx = ml.indexOf("=")
    if (idx === -1) fail(`--metric-link expects name=url, got: ${ml}`)
    links.set(ml.slice(0, idx).trim(), ml.slice(idx + 1).trim())
    if (!values.has(ml.slice(0, idx).trim())) values.set(ml.slice(0, idx).trim(), undefined)
  }
  const metrics = [...values.entries()].map(([name, value]) => {
    const metric = { name }
    if (value !== undefined) metric.value = value
    const link = links.get(name)
    if (link) metric.link = link
    return metric
  })
  const conclusion = {
    result: args.result,
    summary: args.summary.trim(),
    decidedAt: new Date().toISOString(),
  }
  if (metrics.length) conclusion.metrics = metrics
  return conclusion
}

// --- commands -------------------------------------------------------------------

function cmdList(args, registry) {
  let list = registry.experiments
  if (args.status) {
    if (!STATUSES.includes(args.status)) fail(`--status must be one of: ${STATUSES.join(", ")}`)
    list = list.filter((e) => e.status === args.status)
  }
  if (args.ownerValue) list = list.filter((e) => e.owner === args.ownerValue)
  if (args.json) {
    console.log(JSON.stringify(list, null, 2))
    return
  }
  if (!list.length) {
    console.log(args.demo ? "(empty demo registry)" : "no experiments found")
    return
  }
  const pad = (s, n) => String(s).padEnd(n)
  console.log(`${pad("id", 34)}${pad("status", 10)}${pad("owner", 18)}started      hypothesis`)
  for (const e of list) {
    console.log(
      `${pad(e.id, 34)}${pad(e.status, 10)}${pad(e.owner ?? "", 18)}${(e.startedAt ?? "").slice(0, 10)}  ${e.hypothesis}`,
    )
  }
  console.log(`\n${list.length} experiment(s)`)
}

function cmdShow(args, registry) {
  if (!args.id) fail("show requires --id")
  console.log(JSON.stringify(findExperiment(registry, args.id), null, 2))
}

function cmdCreate(args, registry, file) {
  if (!args.id) fail("create requires --id")
  if (!ID_PATTERN.test(args.id)) fail(`--id must match ${ID_PATTERN}`)
  if (registry.experiments.some((e) => e.id === args.id)) {
    fail(`experiment already exists: ${args.id} (use 'update' or pick a new id)`)
  }
  if (!args.hypothesis?.trim()) fail("create requires --hypothesis")
  if (!args.ownerValue?.trim()) fail("create requires --owner")
  if (!args.variants.length) fail("create requires at least two --variant name[:weight] flags")
  const variants = args.variants.map(normalizeVariant)
  const seen = new Set()
  for (const v of variants) {
    if (!v.name) fail("variant name is required")
    if (seen.has(v.name)) fail(`duplicate variant: ${v.name}`)
    seen.add(v.name)
  }
  if (variants.length < 2) fail("an experiment needs at least 2 variants")

  const e = {
    id: args.id,
    hypothesis: args.hypothesis.trim(),
    variants,
    status: "draft",
    owner: args.ownerValue.trim(),
    createdAt: new Date().toISOString(),
  }
  const errors = validateExperiment(e)
  if (errors.length) fail(errors.join("; "))
  registry.experiments.push(e)
  saveRegistry(file, registry)
  console.log(`created draft experiment '${e.id}' in ${file}`)
}

function cmdUpdate(args, registry, file) {
  if (!args.id) fail("update requires --id")
  const e = findExperiment(registry, args.id)
  if (e.status !== "draft") {
    fail(`cannot edit '${e.id}': status is '${e.status}' (only drafts are editable)`)
  }
  if (args.hypothesis !== null) {
    if (!args.hypothesis.trim()) fail("--hypothesis must be non-empty")
    e.hypothesis = args.hypothesis.trim()
  }
  if (args.ownerValue !== null) {
    if (!args.ownerValue.trim()) fail("--owner must be non-empty")
    e.owner = args.ownerValue.trim()
  }
  for (const name of args.removeVariants) {
    const before = e.variants.length
    e.variants = e.variants.filter((v) => v.name !== name)
    if (e.variants.length === before) fail(`variant not found: ${name}`)
  }
  for (const spec of args.addVariants) {
    const v = normalizeVariant(spec)
    if (e.variants.some((x) => x.name === v.name)) fail(`variant already exists: ${v.name}`)
    e.variants.push(v)
  }
  const errors = validateExperiment(e)
  if (errors.length) fail(errors.join("; "))
  saveRegistry(file, registry)
  console.log(`updated draft experiment '${e.id}'`)
}

function cmdTransition(args, registry, file) {
  if (!args.id) fail("transition requires --id")
  if (!args.to) fail("transition requires --to <status>")
  if (!STATUSES.includes(args.to)) fail(`--to must be one of: ${STATUSES.join(", ")}`)
  const e = findExperiment(registry, args.id)
  const conclusion = args.to === "concluded" ? buildConclusion(args) : undefined
  const next = transition(e, args.to, { conclusion })
  registry.experiments[registry.experiments.indexOf(e)] = next
  saveRegistry(file, registry)
  console.log(`${e.id}: ${e.status} -> ${next.status}`)
}

function cmdConclude(args, registry, file) {
  args.to = "concluded"
  cmdTransition(args, registry, file)
}

function cmdValidate(args, registry) {
  let problems = 0
  if (!registry.experiments.length) console.log("registry is empty")
  const ids = new Set()
  for (const e of registry.experiments) {
    const errors = validateExperiment(e)
    if (ids.has(e.id)) {
      errors.push(`duplicate id in registry: ${e.id}`)
      problems++
    }
    ids.add(e.id)
    if (errors.length) {
      problems++
      console.log(`${e.id ?? "<no id>"}:`)
      for (const err of errors) console.log(`  - ${err}`)
    }
  }
  if (problems === 0) console.log(`registry OK (${registry.experiments.length} experiment(s))`)
  else fail(`${problems} experiment(s) with problems`)
}

// --- main ------------------------------------------------------------------------

const USAGE = `experiment registry CLI — see header comment or docs/experiments/tracking.md`

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || !args.command) {
    console.log(USAGE)
    process.exit(args.help ? 0 : 1)
  }
  const file = resolveFile(args)
  if (args.demo) seedDemoRegistry(file)
  const registry = loadRegistry(file)

  switch (args.command) {
    case "list":
      cmdList(args, registry)
      break
    case "show":
      cmdShow(args, registry)
      break
    case "create":
      cmdCreate(args, registry, file)
      break
    case "update":
      cmdUpdate(args, registry, file)
      break
    case "transition":
      cmdTransition(args, registry, file)
      break
    case "conclude":
      cmdConclude(args, registry, file)
      break
    case "validate":
      cmdValidate(args, registry)
      break
    default:
      fail(`unknown command: ${args.command}`)
  }
}

main()
