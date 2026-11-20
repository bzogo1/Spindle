#!/usr/bin/env node
/**
 * Experiment assignment preview — shows which variant sample subjects would
 * get, without running the app.
 *
 * IMPORTANT: the hashing and weighting below MUST stay in sync with
 * src/lib/experiments/{bucket,assign}.ts (FNV-1a, "enroll"/"assign"
 * namespaces, 0–9999 bucket space, cumulative-percent walk). If those files
 * change, update this script — it exists to preview the real algorithm.
 *
 * Usage:
 *   node scripts/experiments/assign-preview.mjs --demo
 *   node scripts/experiments/assign-preview.mjs \
 *     --experiment checkout-cta --variants "control:50,treatment:50" \
 *     --traffic 80 --subjects "user-1,user-2,user-3"
 *   node scripts/experiments/assign-preview.mjs --help
 */

const BUCKET_SPACE = 10_000

// --- Mirror of src/lib/experiments/bucket.ts -------------------------------

function hashBucket(input) {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % BUCKET_SPACE
}

function enrollmentBucket(key, subjectId, salt) {
  return hashBucket([salt ?? "", "enroll", key, subjectId].join("|"))
}

function variantBucket(key, subjectId, salt) {
  return hashBucket([salt ?? "", "assign", key, subjectId].join("|"))
}

function clampPercent(value) {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

// --- Mirror of src/lib/experiments/assign.ts -------------------------------

function pickVariant(variants, bucket) {
  const position = (bucket / BUCKET_SPACE) * 100
  let cumulative = 0
  for (const variant of variants) {
    cumulative += clampPercent(variant.weight)
    if (position < cumulative) return variant
  }
  return null
}

function assignVariant(def, subjectId, now = new Date()) {
  const enrollBucket = enrollmentBucket(def.name, subjectId, def.salt)

  if ((def.status ?? "running") !== "running") {
    return { variant: null, bucket: enrollBucket, enrolled: false, reason: "not-running" }
  }
  if (
    def.startDate &&
    !Number.isNaN(new Date(def.startDate).getTime()) &&
    now < new Date(def.startDate)
  ) {
    return { variant: null, bucket: enrollBucket, enrolled: false, reason: "outside-window" }
  }
  if (
    def.endDate &&
    !Number.isNaN(new Date(def.endDate).getTime()) &&
    now >= new Date(def.endDate)
  ) {
    return { variant: null, bucket: enrollBucket, enrolled: false, reason: "outside-window" }
  }

  const traffic = clampPercent(def.traffic ?? 100)
  const enrolled = traffic >= 100 || (traffic > 0 && enrollBucket < traffic * 100)
  if (!enrolled) {
    return { variant: null, bucket: enrollBucket, enrolled: false, reason: "not-enrolled" }
  }

  const bucket = variantBucket(def.name, subjectId, def.salt)
  const variant = pickVariant(def.variants, bucket)
  return {
    variant: variant?.name ?? null,
    bucket,
    enrolled: true,
    reason: variant ? "assigned" : "unassigned-variant",
  }
}

// --- CLI --------------------------------------------------------------------

const USAGE = `Usage: node scripts/experiments/assign-preview.mjs [options]

  --demo                     Run a built-in sample experiment over sample subjects
  --experiment <name>        Experiment key (default: "preview")
  --variants <spec>          Comma list of name:weight, e.g. "control:50,treatment:50"
  --traffic <0-100>          Enrolled traffic percentage (default: 100)
  --salt <string>            Assignment salt
  --status <s>               draft | running | stopped (default: running)
  --start <iso>              Window start (inclusive)
  --end <iso>                Window end (exclusive)
  --subjects <list>          Comma-separated subject ids
  --count <n>                Generate n subjects "user-0..n-1" (default with --demo: 10)
  --prefix <s>               Subject id prefix for --count (default: "user-")
  --summary                  Print a variant distribution summary only
  --help                     Show this help
`

function parseArgs(argv) {
  const args = { demo: false, summary: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => argv[++i]
    switch (arg) {
      case "--demo":
        args.demo = true
        break
      case "--summary":
        args.summary = true
        break
      case "--help":
      case "-h":
        args.help = true
        break
      case "--experiment":
        args.experiment = next()
        break
      case "--variants":
        args.variants = next()
        break
      case "--traffic":
        args.traffic = Number(next())
        break
      case "--salt":
        args.salt = next()
        break
      case "--status":
        args.status = next()
        break
      case "--start":
        args.startDate = next()
        break
      case "--end":
        args.endDate = next()
        break
      case "--subjects":
        args.subjects = next()
        break
      case "--count":
        args.count = Number(next())
        break
      case "--prefix":
        args.prefix = next()
        break
      default:
        console.error(`Unknown argument: ${arg}`)
        process.exit(2)
    }
  }
  return args
}

function parseVariants(spec) {
  if (!spec) {
    return [
      { name: "control", weight: 50 },
      { name: "treatment", weight: 50 },
    ]
  }
  return spec.split(",").map((part) => {
    const [name, weight] = part.split(":")
    const w = Number(weight)
    if (!name || !Number.isFinite(w)) {
      console.error(`Invalid variant spec "${part}" — expected name:weight`)
      process.exit(2)
    }
    return { name: name.trim(), weight: w }
  })
}

function resolveSubjects(args) {
  if (args.subjects)
    return args.subjects
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  const count = args.count ?? (args.demo ? 10 : 5)
  const prefix = args.prefix ?? "user-"
  return Array.from({ length: count }, (_, i) => `${prefix}${i}`)
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(USAGE)
    return
  }

  const totalWeight = parseVariants(args.variants).reduce((sum, v) => sum + v.weight, 0)
  if (totalWeight > 100) {
    console.error(`Variant weights sum to ${totalWeight} (> 100)`)
    process.exit(2)
  }

  const definition = {
    name: args.experiment ?? "preview",
    status: args.status ?? "running",
    traffic: args.traffic,
    salt: args.salt,
    startDate: args.startDate,
    endDate: args.endDate,
    variants: parseVariants(args.variants),
  }

  const subjects = resolveSubjects(args)
  const counts = new Map()
  let enrolled = 0

  if (!args.summary) {
    console.log(`Experiment: ${definition.name}`)
    console.log(
      `  status=${definition.status} traffic=${definition.traffic ?? 100}%` +
        (definition.salt ? ` salt=${definition.salt}` : "") +
        (definition.startDate || definition.endDate
          ? ` window=[${definition.startDate ?? "-∞"}, ${definition.endDate ?? "∞"})`
          : ""),
    )
    console.log(
      `  variants: ${definition.variants.map((v) => `${v.name}:${v.weight}%`).join(", ")}`,
    )
    console.log("")
    console.log(
      "subject".padEnd(24) +
        "bucket".padEnd(8) +
        "enrolled".padEnd(10) +
        "variant".padEnd(14) +
        "reason",
    )
  }

  for (const subjectId of subjects) {
    const a = assignVariant(definition, subjectId)
    const variant = a.variant ?? "(none)"
    counts.set(variant, (counts.get(variant) ?? 0) + 1)
    if (a.enrolled) enrolled++
    if (!args.summary) {
      console.log(
        subjectId.padEnd(24) +
          String(a.bucket).padEnd(8) +
          String(a.enrolled).padEnd(10) +
          variant.padEnd(14) +
          a.reason,
      )
    }
  }

  console.log("")
  console.log(`Enrolled: ${enrolled}/${subjects.length} subjects`)
  for (const [variant, count] of [...counts.entries()].sort()) {
    console.log(`  ${variant}: ${count}`)
  }
}

main()
