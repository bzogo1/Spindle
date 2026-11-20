#!/usr/bin/env node
/**
 * Webhook dead-letter queue manager.
 *
 * Inspect, replay, and remove entries in the webhook DLQ JSONL file produced
 * by `src/lib/webhooks/dlq.ts` (`createJsonlDlqStore`). Self-contained: no
 * dependencies beyond Node.js, so it runs on any ops box.
 *
 * Usage:
 *   node scripts/webhooks/dlq/manage.mjs list   [--file path] [--demo]
 *   node scripts/webhooks/dlq/manage.mjs inspect <id> [--file path] [--demo]
 *   node scripts/webhooks/dlq/manage.mjs replay <id|all> [--file path] [--demo] [--dry-run]
 *   node scripts/webhooks/dlq/manage.mjs remove <id|all> [--file path] [--demo] [--yes]
 *   node scripts/webhooks/dlq/manage.mjs stats  [--file path] [--demo]
 *
 * Flags:
 *   --file <path>  DLQ JSONL file. Default: ./var/webhooks/dlq.jsonl
 *                  (created on first write).
 *   --demo         Use a throwaway demo file under the OS temp dir, seeded
 *                  with sample entries on first run. Implies nothing else —
 *                  it still writes to that file so state persists across
 *                  invocations within the temp dir.
 *   --dry-run      For `replay`: print what would be delivered, send nothing.
 *   --yes          For `remove all`: skip the confirmation prompt.
 *
 * Exit codes: 0 ok, 1 usage/runtime error, 2 not found.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { randomBytes } from "node:crypto"
import { createInterface } from "node:readline/promises"

const DEFAULT_FILE = "./var/webhooks/dlq.jsonl"

function usage() {
  console.error(`Usage: node scripts/webhooks/dlq/manage.mjs <command> [args] [flags]

Commands:
  list                  List DLQ entries (id, age, attempts, last error)
  inspect <id>          Show full entry JSON
  replay <id|all>       Redeliver an entry (or all, oldest first)
  remove <id|all>       Delete an entry (or all with --yes)
  stats                 Counts: total, failed replays, oldest/newest

Flags:
  --file <path>   DLQ JSONL file (default: ./var/webhooks/dlq.jsonl)
  --demo          Use seeded demo file in temp dir
  --dry-run       replay: show delivery without sending
  --yes           remove all: skip confirmation`)
  process.exit(1)
}

function parseArgs(argv) {
  const args = [...argv]
  const opts = { file: DEFAULT_FILE, demo: false, dryRun: false, yes: false }
  const positional = []
  while (args.length) {
    const a = args.shift()
    if (a === "--file") opts.file = args.shift()
    else if (a === "--demo") opts.demo = true
    else if (a === "--dry-run") opts.dryRun = true
    else if (a === "--yes" || a === "-y") opts.yes = true
    else if (a === "--help" || a === "-h") usage()
    else positional.push(a)
  }
  if (opts.demo) opts.file = join(tmpdir(), "spindle-webhook-dlq-demo.jsonl")
  if (!opts.file) {
    console.error("error: --file requires a path")
    process.exit(1)
  }
  return { opts, positional }
}

async function readAll(path) {
  let raw
  try {
    raw = await readFile(path, "utf8")
  } catch (e) {
    if (e.code === "ENOENT") return []
    throw e
  }
  const entries = []
  for (const line of raw.split("\n")) {
    const t = line.trim()
    if (!t) continue
    try {
      const parsed = JSON.parse(t)
      if (parsed && typeof parsed.id === "string") entries.push(parsed)
    } catch {
      /* skip corrupt lines, same policy as src/lib/webhooks/dlq.ts */
    }
  }
  return entries
}

async function writeAll(path, entries) {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}`
  const body = entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : "")
  await writeFile(tmp, body, "utf8")
  await rename(tmp, path)
}

function demoEntries() {
  const now = Date.now()
  const iso = (msAgo) => new Date(now - msAgo).toISOString()
  const mk = (i, overrides = {}) => ({
    id: `dlq_demo_${i}_${randomBytes(3).toString("hex")}`,
    endpointId: "whk_demo",
    eventId: `evt_demo_${i}`,
    url: "https://httpbin.org/status/200",
    rawBody: JSON.stringify({
      id: `evt_demo_${i}`,
      type: "newsletter.subscribed",
      apiVersion: "2025-01",
      created: iso(3600_000),
      livemode: false,
      data: { object: { email: `demo${i}@example.com`, consent: true } },
    }),
    headers: {
      "webhook-id": `evt_demo_${i}`,
      "webhook-signature": `t=${Math.floor(now / 1000) - 3600},v1=${randomBytes(16).toString("hex")}`,
      "content-type": "application/json",
      "idempotency-key": `idem_demo_${i}`,
    },
    attempts: 5,
    replayAttempts: 0,
    lastError: "HTTP 503: receiver unavailable",
    lastStatus: 503,
    deadLetteredAt: iso(3600_000),
    reason: "max-attempts",
    ...overrides,
  })
  return [
    mk(1, { deadLetteredAt: iso(7200_000), lastError: "connect ETIMEDOUT", lastStatus: undefined }),
    mk(2, {
      replayAttempts: 1,
      lastReplayAt: iso(1800_000),
      lastReplayOk: false,
      lastError: "HTTP 502",
    }),
    mk(3),
  ]
}

async function ensureDemoSeeded(path) {
  const existing = await readAll(path)
  if (existing.length === 0) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(
      path,
      demoEntries()
        .map((e) => JSON.stringify(e))
        .join("\n") + "\n",
      "utf8",
    )
    console.log(`seeded demo DLQ at ${path}`)
  }
}

function fmtAge(iso) {
  const ms = Date.now() - Date.parse(iso)
  if (Number.isNaN(ms)) return "?"
  const m = Math.floor(ms / 60000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

async function cmdList(entries) {
  if (!entries.length) {
    console.log("DLQ is empty.")
    return
  }
  console.log(
    `${"ID".padEnd(24)} ${"AGE".padStart(6)} ${"URL".padEnd(52)} ${"ATT".padStart(3)} ${"REPLAY".padStart(6)}  LAST ERROR`,
  )
  for (const e of entries) {
    console.log(
      `${e.id.padEnd(24)} ${fmtAge(e.deadLetteredAt).padStart(6)} ${(e.url ?? "").slice(0, 52).padEnd(52)} ${String(e.attempts ?? "?").padStart(3)} ${String(e.replayAttempts ?? 0).padStart(6)}  ${e.lastError ?? ""}`,
    )
  }
  console.log(`\n${entries.length} entr${entries.length === 1 ? "y" : "ies"}`)
}

async function cmdInspect(entries, id) {
  const e = entries.find((x) => x.id === id)
  if (!e) {
    console.error(`error: no DLQ entry with id ${id}`)
    process.exit(2)
  }
  console.log(JSON.stringify(e, null, 2))
}

async function deliverEntry(e, dryRun) {
  if (dryRun) {
    return { ok: true, status: undefined, dryRun: true }
  }
  const headers = { ...(e.headers ?? {}) }
  if (!headers["content-type"] && !headers["Content-Type"])
    headers["content-type"] = "application/json"
  const res = await fetch(e.url, { method: "POST", headers, body: e.rawBody })
  if (res.ok) return { ok: true, status: res.status }
  const text = await res.text().catch(() => "")
  return {
    ok: false,
    status: res.status,
    error: `HTTP ${res.status}${text ? `: ${text.slice(0, 120)}` : ""}`,
  }
}

async function cmdReplay(path, entries, target, opts) {
  const targets = target === "all" ? entries : entries.filter((e) => e.id === target)
  if (target !== "all" && targets.length === 0) {
    console.error(`error: no DLQ entry with id ${target}`)
    process.exit(2)
  }
  const results = []
  for (const e of targets) {
    let outcome
    try {
      outcome = await deliverEntry(e, opts.dryRun)
    } catch (err) {
      outcome = { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
    const now = new Date().toISOString()
    if (opts.dryRun) {
      results.push({
        id: e.id,
        status: outcome.ok ? `would replay → ${e.url}` : `would fail: ${outcome.error}`,
      })
      continue
    }
    if (outcome.ok) {
      const next = entries.filter((x) => x.id !== e.id)
      await writeAll(path, next)
      entries = next
      results.push({ id: e.id, status: `replayed (${outcome.status ?? "?"})` })
    } else {
      const updated = {
        ...e,
        replayAttempts: (e.replayAttempts ?? 0) + 1,
        lastReplayAt: now,
        lastReplayOk: false,
        lastError: outcome.error,
        lastStatus: outcome.status,
      }
      await writeAll(
        path,
        entries.map((x) => (x.id === e.id ? updated : x)),
      )
      entries = entries.map((x) => (x.id === e.id ? updated : x))
      results.push({ id: e.id, status: `failed: ${outcome.error}` })
    }
  }
  for (const r of results) console.log(`${r.id}: ${r.status}`)
  if (opts.dryRun) console.log("\n(dry-run: nothing was sent, entries unchanged)")
}

async function cmdRemove(path, entries, target, opts) {
  if (target === "all") {
    if (!entries.length) {
      console.log("DLQ is empty.")
      return
    }
    if (!opts.yes) {
      const rl = createInterface({ input: process.stdin, output: process.stdout })
      const answer = await rl.question(`Remove all ${entries.length} DLQ entries? [y/N] `)
      rl.close()
      if (answer.trim().toLowerCase() !== "y") {
        console.log("aborted")
        return
      }
    }
    await writeAll(path, [])
    console.log(`removed ${entries.length} entries`)
    return
  }
  const e = entries.find((x) => x.id === target)
  if (!e) {
    console.error(`error: no DLQ entry with id ${target}`)
    process.exit(2)
  }
  await writeAll(
    path,
    entries.filter((x) => x.id !== target),
  )
  console.log(`removed ${e.id}`)
}

function cmdStats(entries) {
  if (!entries.length) {
    console.log("DLQ is empty.")
    return
  }
  const replayed = entries.filter((e) => (e.replayAttempts ?? 0) > 0).length
  const failedReplays = entries.filter((e) => e.lastReplayOk === false).length
  const ages = entries.map((e) => Date.parse(e.deadLetteredAt)).filter((n) => !Number.isNaN(n))
  console.log(`total entries:        ${entries.length}`)
  console.log(`with replay attempts: ${replayed}`)
  console.log(`last replay failed:   ${failedReplays}`)
  if (ages.length) {
    console.log(`oldest dead-lettered: ${new Date(Math.min(...ages)).toISOString()}`)
    console.log(`newest dead-lettered: ${new Date(Math.max(...ages)).toISOString()}`)
  }
}

async function main() {
  const { opts, positional } = parseArgs(process.argv.slice(2))
  const [command, target] = positional
  if (!command) usage()

  if (opts.demo) await ensureDemoSeeded(opts.file)
  const entries = await readAll(opts.file)

  switch (command) {
    case "list":
      await cmdList(entries)
      break
    case "inspect":
      if (!target) usage()
      await cmdInspect(entries, target)
      break
    case "replay":
      if (!target) usage()
      await cmdReplay(opts.file, entries, target, opts)
      break
    case "remove":
      if (!target) usage()
      await cmdRemove(opts.file, entries, target, opts)
      break
    case "stats":
      cmdStats(entries)
      break
    default:
      usage()
  }
}

main().catch((err) => {
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
