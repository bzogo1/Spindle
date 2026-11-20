#!/usr/bin/env node
// Secrets rotation orchestrator.
//
// Inventories secret variable names from .env.example (names only, values are
// never read), loads a rotation plan (rotation-plan.json or a YAML equivalent),
// tracks last-rotated timestamps in state.json, and walks per-secret rotation
// steps. Verification steps delegate to the existing scripts under
// scripts/secrets/ (check.ts, verify-rotation.ts); nothing is reimplemented.
//
// The default mode is a dry run: every step is printed, no commands execute,
// and state.json is never written, so it is fully offline. Pass --apply to run
// runnable steps and --record to stamp lastRotated after a successful apply.
//
// Usage:
//   node scripts/secrets/rotation/rotate.mjs inventory [--json]
//   node scripts/secrets/rotation/rotate.mjs status [--json]
//   node scripts/secrets/rotation/rotate.mjs run <id|all> [--apply] [--record] [--json] [--report <file>]
//   node scripts/secrets/rotation/rotate.mjs report [--report <file>]
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "../../..")

const ENV_EXAMPLE = resolve(repoRoot, ".env.example")
const DEFAULT_PLAN = resolve(scriptDir, "rotation-plan.json")
const DEFAULT_STATE = resolve(scriptDir, "state.json")

// Verification scripts the orchestrator is allowed to invoke. Anything else is
// rejected so a plan cannot smuggle arbitrary tsx entrypoints through `verify`.
const VERIFY_SCRIPTS = new Set(["check", "verify-rotation"])

const USAGE = `Usage: node scripts/secrets/rotation/rotate.mjs <command> [options]

Commands:
  inventory   List secret variable names from .env.example and the plan.
  status      Show rotation age vs maxAgeDays for every planned secret.
  run <id>    Walk the rotation steps for one secret (or "all").
  report      Print a markdown rotation report (same data as status).

Options:
  --plan <path>     Rotation plan file (JSON, or YAML if js-yaml resolves).
  --state <path>    State file (default: scripts/secrets/rotation/state.json).
  --apply           Execute runnable steps. Without it (or with --dry-run)
                    every command is a dry run and state is never written.
  --record          With --apply: stamp lastRotated in the state file on success.
  --json            Emit machine-readable JSON.
  --report <file>   Also write the report to <file> (markdown).
  --help            Show this text.
`

function fail(message) {
  console.error(`rotate: ${message}`)
  process.exit(2)
}

function parseArgs(argv) {
  const args = {
    command: null,
    target: null,
    plan: DEFAULT_PLAN,
    state: DEFAULT_STATE,
    apply: false,
    record: false,
    json: false,
    report: null,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case "--help":
      case "-h":
        console.log(USAGE)
        process.exit(0)
        break
      case "--apply":
        args.apply = true
        break
      case "--dry-run":
        args.apply = false
        break
      case "--record":
        args.record = true
        break
      case "--json":
        args.json = true
        break
      case "--plan":
        args.plan = resolve(argv[++i] ?? fail("--plan needs a path"))
        break
      case "--state":
        args.state = resolve(argv[++i] ?? fail("--state needs a path"))
        break
      case "--report":
        args.report = resolve(argv[++i] ?? fail("--report needs a path"))
        break
      default:
        if (arg.startsWith("--")) fail(`unknown option ${arg}`)
        if (!args.command) args.command = arg
        else if (!args.target) args.target = arg
        else fail(`unexpected argument ${arg}`)
    }
  }

  return args
}

function readText(path) {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return null
  }
}

async function loadPlan(path) {
  const text = readText(path)
  if (text === null) fail(`cannot read plan ${path}`)

  const isYaml = /\.ya?ml$/i.test(path)
  if (isYaml) {
    try {
      const yaml = await import("js-yaml")
      return yaml.load(text)
    } catch (error) {
      fail(`cannot parse YAML plan (is js-yaml installed?): ${error.message}`)
    }
  }

  try {
    return JSON.parse(text)
  } catch (error) {
    fail(`cannot parse plan ${path}: ${error.message}`)
  }
}

function loadState(path) {
  const text = readText(path)
  if (text === null) return { version: 1, rotations: {} }
  try {
    const state = JSON.parse(text)
    state.rotations ??= {}
    return state
  } catch {
    fail(`state file ${path} is not valid JSON; fix or delete it`)
  }
}

function saveState(path, state) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`)
}

function envExampleKeys() {
  const text = readText(ENV_EXAMPLE)
  if (text === null) return new Set()
  const keys = new Set()
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=/.exec(line)
    if (match) keys.add(match[1])
  }
  return keys
}

function planVariables(plan) {
  const map = new Map()
  for (const secret of plan.secrets ?? []) {
    for (const key of [...(secret.variables ?? []), ...(secret.previousVariables ?? [])]) {
      map.set(key, secret.id)
    }
  }
  return map
}

function validatePlan(plan) {
  if (!plan || !Array.isArray(plan.secrets)) fail("plan must contain a secrets array")
  const seen = new Set()
  for (const secret of plan.secrets) {
    if (!secret.id || seen.has(secret.id))
      fail(`plan has a missing or duplicate secret id: ${secret.id}`)
    seen.add(secret.id)
    if (!Array.isArray(secret.variables) || secret.variables.length === 0) {
      fail(`secret ${secret.id} must list at least one variable`)
    }
    if (typeof secret.maxAgeDays !== "number" || secret.maxAgeDays <= 0) {
      fail(`secret ${secret.id} must set a positive maxAgeDays`)
    }
    for (const step of secret.steps ?? []) {
      if (step.type === "verify" && !VERIFY_SCRIPTS.has(step.script)) {
        fail(`secret ${secret.id} step ${step.id} requests unapproved verify script ${step.script}`)
      }
      if (step.type === "command" && typeof step.command !== "string") {
        fail(`secret ${secret.id} step ${step.id} is type command but has no command`)
      }
    }
  }
  return plan
}

function daysBetween(fromIso, to = new Date()) {
  return Math.floor((to.getTime() - new Date(fromIso).getTime()) / 86_400_000)
}

function rotationStatus(secret, state) {
  const entry = state.rotations[secret.id]
  const lastRotated = entry?.lastRotated ?? null
  if (!lastRotated) return { status: "never", ageDays: null, daysUntilDue: null }
  const ageDays = daysBetween(lastRotated)
  const daysUntilDue = secret.maxAgeDays - ageDays
  return {
    status:
      daysUntilDue <= 0
        ? "due"
        : daysUntilDue <= Math.ceil(secret.maxAgeDays * 0.2)
          ? "due-soon"
          : "ok",
    ageDays,
    daysUntilDue,
  }
}

async function inventory(args) {
  const plan = validatePlan(await loadPlan(args.plan))
  const exampleKeys = envExampleKeys()
  const planned = planVariables(plan)

  const rows = []
  for (const key of [...exampleKeys].sort()) {
    rows.push({ key, source: "env-example", secret: planned.get(key) ?? null })
  }
  for (const [key, secretId] of [...planned].sort()) {
    if (!exampleKeys.has(key)) rows.push({ key, source: "plan-only", secret: secretId })
  }
  // env.example keys that are not secrets at all (settings, URLs) still appear;
  // they simply have no owning rotation entry.

  if (args.json) {
    console.log(
      JSON.stringify({ envExample: ENV_EXAMPLE, plan: args.plan, variables: rows }, null, 2),
    )
    return
  }

  console.log(`Inventory (${rows.length} variable names; values are never read)`)
  console.log(`  .env.example : ${ENV_EXAMPLE}`)
  console.log(`  plan         : ${args.plan}`)
  console.log("")
  const keyWidth = Math.max(...rows.map((row) => row.key.length))
  for (const row of rows) {
    const owner = row.secret ? `  -> ${row.secret}` : ""
    console.log(`  ${row.key.padEnd(keyWidth + 2)} ${row.source}${owner}`)
  }
}

function statusReport(plan, state) {
  return plan.secrets.map((secret) => {
    const rot = rotationStatus(secret, state)
    return {
      id: secret.id,
      label: secret.label,
      variables: [...secret.variables, ...(secret.previousVariables ?? [])],
      strategy: secret.strategy,
      maxAgeDays: secret.maxAgeDays,
      runbook: secret.runbook ?? null,
      lastRotated: state.rotations[secret.id]?.lastRotated ?? null,
      ...rot,
    }
  })
}

async function status(args) {
  const plan = validatePlan(await loadPlan(args.plan))
  const state = loadState(args.state)
  const rows = statusReport(plan, state)

  if (args.json) {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), secrets: rows }, null, 2))
    return
  }

  console.log("Rotation status")
  console.log("")
  for (const row of rows) {
    const last = row.lastRotated ?? "never"
    const age = row.ageDays === null ? "-" : `${row.ageDays}d`
    console.log(
      `  ${row.id.padEnd(12)} ${row.status.padEnd(9)} age=${age.padEnd(5)} max=${String(row.maxAgeDays).padEnd(4)}d last=${last}  ${row.label}`,
    )
  }
  console.log("")
  console.log("state file:", args.state)
}

function markdownReport(plan, state, runResults = null) {
  const rows = statusReport(plan, state)
  const lines = [
    "# Secrets rotation report",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "| Secret | Status | Age (days) | Max age (days) | Last rotated | Strategy | Runbook |",
    "| ------ | ------ | ----------- | -------------- | ------------ | -------- | ------- |",
  ]
  for (const row of rows) {
    const runbook = row.runbook ? `[runbook](${row.runbook})` : "-"
    lines.push(
      `| ${row.label} (${row.id}) | ${row.status} | ${row.ageDays ?? "-"} | ${row.maxAgeDays} | ${row.lastRotated ?? "never"} | ${row.strategy} | ${runbook} |`,
    )
  }
  if (runResults) {
    lines.push("", "## Last run", "")
    for (const result of runResults) {
      lines.push(`- **${result.id}**: ${result.mode} — ${result.summary}`)
    }
  }
  lines.push("")
  return lines.join("\n")
}

async function report(args) {
  const plan = validatePlan(await loadPlan(args.plan))
  const state = loadState(args.state)
  const md = markdownReport(plan, state)

  if (args.report) {
    writeFileSync(args.report, md)
    console.log(`Report written to ${args.report}`)
  } else {
    console.log(md)
  }
}

function runVerify(script, extraArgs = []) {
  const tsx = resolve(repoRoot, "node_modules/.bin/tsx")
  if (!existsSync(tsx)) fail("tsx not found; run npm install first")
  execFileSync(tsx, [`scripts/secrets/${script}.ts`, ...extraArgs], {
    cwd: repoRoot,
    stdio: "inherit",
  })
}

function runSecret(secret, args) {
  const mode = args.apply ? "apply" : "dry-run"
  const results = []
  let failed = false
  // With --json the step narration is suppressed so stdout stays machine-readable.
  const say = (...parts) => {
    if (!args.json) console.log(...parts)
  }

  say(`\n=== ${secret.label} (${secret.id}) — ${mode} ===`)
  say(`    variables: ${[...secret.variables, ...(secret.previousVariables ?? [])].join(", ")}`)
  say(`    runbook:   ${secret.runbook ?? "(none)"}`)

  for (const step of secret.steps ?? []) {
    const tag = `[${mode}] ${step.id}`
    switch (step.type) {
      case "manual":
      case "store":
        say(`  ${tag}: ${step.title}`)
        results.push({
          step: step.id,
          title: step.title ?? null,
          type: step.type,
          status: mode === "dry-run" ? "planned" : "operator-action",
        })
        break
      case "command":
        if (!args.apply) {
          say(`  ${tag}: would run \`${step.command}\``)
          results.push({
            step: step.id,
            title: step.title ?? null,
            type: step.type,
            status: "planned",
          })
        } else {
          say(`  ${tag}: running \`${step.command}\``)
          try {
            execFileSync(step.command, { cwd: repoRoot, stdio: "inherit", shell: true })
            results.push({
              step: step.id,
              title: step.title ?? null,
              type: step.type,
              status: "ok",
            })
          } catch {
            results.push({
              step: step.id,
              title: step.title ?? null,
              type: step.type,
              status: "failed",
            })
            failed = true
          }
        }
        break
      case "verify": {
        const extra = step.expectPreviousRemoved ? ["--expect-previous-removed"] : []
        if (!args.apply) {
          say(
            `  ${tag}: would run secrets:${step.script}${extra.length ? ` ${extra.join(" ")}` : ""}`,
          )
          results.push({
            step: step.id,
            title: step.title ?? null,
            type: step.type,
            status: "planned",
          })
        } else {
          say(`  ${tag}: running secrets:${step.script}`)
          try {
            runVerify(step.script, extra)
            results.push({
              step: step.id,
              title: step.title ?? null,
              type: step.type,
              status: "ok",
            })
          } catch {
            results.push({
              step: step.id,
              title: step.title ?? null,
              type: step.type,
              status: "failed",
            })
            failed = true
          }
        }
        break
      }
      default:
        say(`  ${tag}: unknown step type ${step.type} — skipped`)
        results.push({
          step: step.id,
          title: step.title ?? null,
          type: step.type,
          status: "skipped",
        })
    }
    if (failed) break
  }

  const summary = failed
    ? "FAILED — see step output above; do not record this rotation"
    : mode === "dry-run"
      ? `${results.length} steps planned (dry run; nothing executed)`
      : `${results.length} steps walked; manual/store steps still require operator action`

  say(`  result: ${summary}`)
  return { id: secret.id, mode, summary, results, failed }
}

async function run(args) {
  if (!args.target) fail("run needs a target: a secret id or 'all'")
  const plan = validatePlan(await loadPlan(args.plan))
  const state = loadState(args.state)

  const targets =
    args.target === "all" ? plan.secrets : plan.secrets.filter((s) => s.id === args.target)
  if (targets.length === 0) fail(`no secret named ${args.target} in the plan`)

  if (args.record && !args.apply) fail("--record requires --apply")

  const runResults = []
  const stamp = new Date().toISOString()
  let anyFailed = false

  for (const secret of targets) {
    const result = runSecret(secret, args)
    runResults.push(result)
    if (result.failed) {
      anyFailed = true
      continue
    }
    if (args.apply && args.record) {
      state.rotations[secret.id] = {
        lastRotated: stamp,
        lastRun: stamp,
        lastMode: "apply",
        note: "Operator attests manual/store steps were completed per the runbook.",
        history: [
          ...(state.rotations[secret.id]?.history ?? []).slice(-19),
          { at: stamp, mode: "apply", result: "recorded" },
        ],
      }
    }
  }

  if (args.apply && args.record && !anyFailed) {
    saveState(args.state, state)
    if (!args.json) console.log(`\nState updated: ${args.state}`)
  } else if (args.apply && !args.json) {
    console.log(
      "\nState not updated (dry-run semantics preserved; pass --record after confirming steps).",
    )
  }

  const md = markdownReport(plan, state, runResults)
  if (args.report) {
    writeFileSync(args.report, md)
    if (!args.json) console.log(`Report written to ${args.report}`)
  }
  if (args.json) {
    console.log(
      JSON.stringify({ mode: args.apply ? "apply" : "dry-run", results: runResults }, null, 2),
    )
  }

  process.exitCode = anyFailed ? 1 : 0
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.command) {
    console.log(USAGE)
    process.exit(args.json ? 0 : 2)
  }

  switch (args.command) {
    case "inventory":
      await inventory(args)
      break
    case "status":
      await status(args)
      break
    case "run":
      await run(args)
      break
    case "report":
      await report(args)
      break
    default:
      fail(`unknown command ${args.command}`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
