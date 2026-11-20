#!/usr/bin/env node
// On-call rotation schedule generator for Spindle.
//
//   node scripts/oncall/rotation.mjs [options]
//
// Reads a JSON config (default scripts/oncall/rotation.config.json), expands a
// weekly L1 primary / L2 secondary rotation, and writes:
//
//   <out>/<service>-oncall-<start>-<weeks>w.ics   calendar file (import into
//                                                 any calendar app)
//   <out>/<service>-oncall-<start>-<weeks>w.md    markdown roster
//
// `--demo` uses a built-in placeholder config (next-Monday start, three demo
// members) and never touches the repo config — safe for offline verification:
//
//   node scripts/oncall/rotation.mjs --demo --weeks 4
//
// Everything is offline: no network, no dependencies. The L3 escalation lead
// is constant per config and is repeated on every roster row.
//
// Exit codes: 0 success, 2 usage/config error.

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { TextEncoder } from "node:util"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const DEFAULT_CONFIG = join(ROOT, "scripts", "oncall", "rotation.config.json")
const DEFAULT_OUT = join(ROOT, "scripts", "oncall", ".output")

// ---------------------------------------------------------------------------
// Demo config — placeholder names only, used by --demo
// ---------------------------------------------------------------------------

function nextMonday(from = new Date()) {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
  const day = d.getUTCDay() // 0 Sun .. 6 Sat
  const delta = day === 1 ? 0 : (8 - day) % 7 || 7
  d.setUTCDate(d.getUTCDate() + (day === 1 ? 0 : delta))
  return d
}

function isoDate(d) {
  return d.toISOString().slice(0, 10)
}

function demoConfig() {
  const start = nextMonday()
  return {
    service: "demo",
    startDate: isoDate(start),
    weeks: 8,
    timezoneNote: "Dates are UTC; adjust to local timezone when importing.",
    members: [
      { name: "Demo Primary A", handle: "@demo-a", email: "demo-a@example.invalid" },
      { name: "Demo Secondary B", handle: "@demo-b", email: "demo-b@example.invalid" },
      { name: "Demo Tertiary C", handle: "@demo-c", email: "demo-c@example.invalid" },
    ],
    rotation: { pattern: "weekly", l1Offset: 0, l2Offset: 1 },
    escalationLead: { name: "Demo Eng Lead", handle: "@demo-lead" },
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `Usage: node scripts/oncall/rotation.mjs [options]

Options:
  --config <path>   rotation config JSON (default: scripts/oncall/rotation.config.json)
  --out <dir>       output directory (default: scripts/oncall/.output)
  --weeks <n>       number of rotation weeks to generate (overrides config)
  --demo            use the built-in demo config; ignores --config
  --help, -h        show this message

Outputs an .ics calendar file and a .md roster under --out.`

function parseArgs(argv) {
  const options = { demo: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => argv[++i]
    switch (arg) {
      case "--config":
        options.config = next()
        break
      case "--out":
        options.out = next()
        break
      case "--weeks": {
        const n = Number(next())
        if (!Number.isInteger(n) || n < 1 || n > 104) {
          throw new Error("--weeks must be an integer between 1 and 104")
        }
        options.weeks = n
        break
      }
      case "--demo":
        options.demo = true
        break
      case "--help":
      case "-h":
        options.help = true
        break
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return options
}

// ---------------------------------------------------------------------------
// Config loading / validation
// ---------------------------------------------------------------------------

async function loadConfig(path) {
  const resolved = resolve(ROOT, path)
  if (!existsSync(resolved)) {
    throw new Error(`config file not found: ${resolved}`)
  }
  return JSON.parse(await readFile(resolved, "utf8"))
}

function validateConfig(config, source) {
  const problems = []
  if (!config || typeof config !== "object") {
    throw new Error(`${source}: config must be a JSON object`)
  }
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(config.service ?? "")) {
    problems.push("service must be a non-empty slug (letters, digits, dashes)")
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(config.startDate ?? "")) {
    problems.push("startDate must be YYYY-MM-DD")
  } else {
    const start = new Date(`${config.startDate}T00:00:00Z`)
    if (Number.isNaN(start.getTime())) problems.push("startDate is not a valid date")
    else if (start.getUTCDay() !== 1) {
      problems.push(
        `startDate ${config.startDate} is not a Monday (rotations start Monday 00:00 UTC)`,
      )
    }
  }
  if (!Array.isArray(config.members) || config.members.length < 2) {
    problems.push("members must be an array with at least 2 entries")
  } else {
    const names = new Set()
    config.members.forEach((m, i) => {
      if (!m?.name) problems.push(`members[${i}] is missing name`)
      else if (names.has(m.name)) problems.push(`duplicate member name: ${m.name}`)
      else names.add(m.name)
    })
  }
  if (problems.length > 0) {
    throw new Error(`${source}: invalid config — ${problems.join("; ")}`)
  }
  const rotation = config.rotation ?? {}
  if (rotation.pattern !== undefined && rotation.pattern !== "weekly") {
    throw new Error(`${source}: only rotation.pattern "weekly" is supported`)
  }
  const l1Offset = rotation.l1Offset ?? 0
  const l2Offset = rotation.l2Offset ?? 1
  if (!Number.isInteger(l1Offset) || !Number.isInteger(l2Offset)) {
    problems.push("rotation.l1Offset/l2Offset must be integers")
  } else if (Array.isArray(config.members) && config.members.length >= 2) {
    const n = config.members.length
    if (((l1Offset % n) + n) % n === ((l2Offset % n) + n) % n) {
      problems.push(
        "rotation.l1Offset and l2Offset must differ (L1 and L2 cannot be the same member)",
      )
    }
  }
  if (!config.escalationLead?.name) {
    problems.push("escalationLead.name is required (constant L3)")
  }
  if (problems.length > 0) {
    throw new Error(`${source}: invalid config — ${problems.join("; ")}`)
  }
  return config
}

// ---------------------------------------------------------------------------
// Schedule expansion
// ---------------------------------------------------------------------------

function expandSchedule(config, weeks) {
  const start = new Date(`${config.startDate}T00:00:00Z`)
  const l1Offset = config.rotation?.l1Offset ?? 0
  const l2Offset = config.rotation?.l2Offset ?? 1
  const n = config.members.length
  const rows = []
  for (let w = 0; w < weeks; w++) {
    const weekStart = new Date(start.getTime() + w * 7 * 86_400_000)
    const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000)
    rows.push({
      week: w + 1,
      start: isoDate(weekStart),
      end: isoDate(weekEnd), // exclusive
      l1: config.members[(((w + l1Offset) % n) + n) % n],
      l2: config.members[(((w + l2Offset) % n) + n) % n],
      l3: config.escalationLead,
    })
  }
  return rows
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

function icsDate(iso) {
  return iso.replaceAll("-", "")
}

function icsEscape(text) {
  return String(text)
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll("\n", "\\n")
}

const utf8 = new TextEncoder()

function foldLine(line) {
  // RFC 5545 §3.1: lines SHOULD be folded at 75 octets; continuation lines
  // start with a single space (which counts toward the 75). Fold on UTF-8
  // byte boundaries without splitting multi-byte characters.
  const out = []
  let rest = line
  while (utf8.encode(rest).length > 75) {
    let end = 75
    while (end > 0 && utf8.encode(rest.slice(0, end)).length > 75) end--
    if (end > 0 && end < rest.length) {
      const code = rest.charCodeAt(end - 1)
      if (code >= 0xd800 && code <= 0xdbff) end-- // don't split a surrogate pair
    }
    if (end === 0) end = 1 // unreachable for valid UTF-8, but never emit an empty fold
    out.push(rest.slice(0, end))
    rest = ` ${rest.slice(end)}`
  }
  out.push(rest)
  return out.join("\r\n")
}

function renderIcs(config, rows) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Spindle//On-call Rotation//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(`${config.service} on-call`)}`,
    `X-WR-TIMEZONE:${icsEscape(config.timezoneNote ?? "UTC")}`,
  ]
  for (const row of rows) {
    for (const [role, member] of [
      ["L1 primary", row.l1],
      ["L2 secondary", row.l2],
    ]) {
      const uid = `oncall-${config.service}-${row.start}-${role === "L1 primary" ? "l1" : "l2"}@spindle`
      lines.push(
        "BEGIN:VEVENT",
        foldLine(`UID:${uid}`),
        foldLine(`DTSTAMP:${icsDate(new Date().toISOString().slice(0, 10))}T000000Z`),
        `DTSTART;VALUE=DATE:${icsDate(row.start)}`,
        `DTEND;VALUE=DATE:${icsDate(row.end)}`,
        foldLine(`SUMMARY:${icsEscape(`${config.service} on-call — ${role}: ${member.name}`)}`),
        foldLine(
          `DESCRIPTION:${icsEscape(
            `Weekly on-call rotation (${role}).\n` +
              `L1: ${row.l1.name}${row.l1.handle ? ` (${row.l1.handle})` : ""}\n` +
              `L2: ${row.l2.name}${row.l2.handle ? ` (${row.l2.handle})` : ""}\n` +
              `L3 escalation lead: ${row.l3.name}${row.l3.handle ? ` (${row.l3.handle})` : ""}\n` +
              `Runbook: docs/oncall/handoff.md — acknowledge alerts within the SLA in docs/oncall/escalation-policy.md`,
          )}`,
        ),
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        "DESCRIPTION:On-call shift starts",
        "TRIGGER:-PT15M",
        "END:VALARM",
        "END:VEVENT",
      )
    }
  }
  lines.push("END:VCALENDAR")
  return `${lines.join("\r\n")}\r\n`
}

function renderMarkdown(config, rows, generatedAt) {
  const fmt = (m) => (m.handle ? `${m.name} (${m.handle})` : m.name)
  const out = []
  out.push(`# ${config.service} — on-call roster`)
  out.push("")
  out.push(`Generated: ${generatedAt} by \`scripts/oncall/rotation.mjs\`.`)
  out.push(`Rotation starts: **${config.startDate}** (Monday, UTC).`)
  out.push(`L3 escalation lead (constant): **${fmt(config.escalationLead)}**.`)
  out.push("")
  out.push("| Week | Start (UTC) | End (exclusive) | L1 primary | L2 secondary | L3 lead |")
  out.push("| ---- | ------------ | --------------- | ---------- | ------------- | ------ |")
  for (const row of rows) {
    out.push(
      `| ${row.week} | ${row.start} | ${row.end} | ${fmt(row.l1)} | ${fmt(row.l2)} | ${fmt(row.l3)} |`,
    )
  }
  out.push("")
  out.push("## How to read this")
  out.push("")
  out.push("- **L1 primary** owns the shift: triage alerts, follow runbooks, drive incidents.")
  out.push(
    "- **L2 secondary** is paged when L1 does not acknowledge within the severity SLA (see `docs/oncall/escalation-policy.md`).",
  )
  out.push(
    "- **L3 lead** is the engineering lead; engaged when L2 cannot resolve or the incident exceeds the L2 window.",
  )
  out.push(
    "- Weeks are Monday 00:00 UTC → next Monday 00:00 UTC. Handoff happens in the shift-change window (see `docs/oncall/handoff.md`).",
  )
  out.push("")
  return out.join("\n")
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
  let source
  try {
    if (options.demo) {
      config = demoConfig()
      source = "--demo (built-in placeholder config)"
    } else {
      config = await loadConfig(options.config ?? DEFAULT_CONFIG)
      source = options.config ?? DEFAULT_CONFIG
    }
    config = validateConfig(config, source)
  } catch (error) {
    console.error(`[oncall] ${error instanceof Error ? error.message : error}`)
    return 2
  }

  const weeks = options.weeks ?? config.weeks ?? 8
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 104) {
    console.error(`[oncall] weeks must be an integer between 1 and 104 (got ${weeks})`)
    return 2
  }

  const rows = expandSchedule(config, weeks)
  const generatedAt = new Date().toISOString()
  const slug = `${config.service}-oncall-${config.startDate}-${weeks}w`

  const outDir = resolve(ROOT, options.out ?? DEFAULT_OUT)
  const icsPath = join(outDir, `${slug}.ics`)
  const mdPath = join(outDir, `${slug}.md`)

  await mkdir(outDir, { recursive: true })
  await writeFile(icsPath, renderIcs(config, rows), "utf8")
  await writeFile(mdPath, renderMarkdown(config, rows, generatedAt), "utf8")

  const first = rows[0]
  const last = rows[rows.length - 1]
  console.log(`[oncall] ${source}`)
  console.log(
    `[oncall] ${weeks} week(s): ${first.start} → ${last.end} (exclusive); ` +
      `${config.members.length} members; L1 offset ${config.rotation?.l1Offset ?? 0}, ` +
      `L2 offset ${config.rotation?.l2Offset ?? 1}`,
  )
  console.log(`[oncall] wrote ${icsPath}`)
  console.log(`[oncall] wrote ${mdPath}`)
  console.log(`[oncall] first week L1=${first.l1.name} L2=${first.l2.name} L3=${first.l3.name}`)
  return 0
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`[oncall] unexpected error: ${error?.stack ?? error}`)
    process.exit(2)
  })
