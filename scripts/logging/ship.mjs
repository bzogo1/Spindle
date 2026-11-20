#!/usr/bin/env node
/**
 * Log shipper for Spindle's pino JSON logs.
 *
 * Reads newline-delimited JSON log lines from stdin, a file (optionally
 * followed), or a built-in `--demo` fixture that mirrors what
 * `src/lib/logger.ts` emits (`service`, `level` label, ISO `time`, `pid`,
 * `hostname`, `msg`, plus request fields from `request-logging.ts`).
 *
 * Records are batched and pushed to a pluggable sink:
 *
 *   - stdout  — echo each raw line (default; useful for piping to another tool)
 *   - file    — append JSONL to --out with size-based rotation
 *   - http    — POST a batch to --endpoint in Loki push format (`--format loki`)
 *               or newline-delimited JSON (`--format ndjson`, Vector `http` sink
 *               compatible). `auto` picks loki when the endpoint path contains
 *               `/loki/`.
 *
 * Backpressure: at most `--max-buffer` records wait between the source and the
 * sink. When the buffer is full the source is paused until the in-flight batch
 * completes, so a slow sink never grows memory unboundedly.
 *
 * Retries: a failed HTTP batch is retried with exponential backoff up to
 * `--max-retries` times while newer batches queue behind it (ordering is
 * preserved). Batches that still fail are counted as dropped and reported in
 * the shutdown summary.
 *
 * Usage:
 *   node scripts/logging/ship.mjs --demo [--sink stdout]
 *   docker logs -f spindle-app | node scripts/logging/ship.mjs --stdin --sink http --endpoint http://loki:3100/loki/api/v1/push --format loki
 *   node scripts/logging/ship.mjs --file /var/log/spindle/app.log --follow --sink file --out /var/log/spindle/ship.jsonl
 *
 * Environment (SHIP_* prefix, CLI flags win):
 *   SHIP_SINK, SHIP_ENDPOINT, SHIP_FORMAT, SHIP_OUT, SHIP_BATCH_SIZE,
 *   SHIP_FLUSH_MS, SHIP_MAX_BUFFER, SHIP_MAX_RETRIES, SHIP_ROTATE_MB
 */

import { appendFile, mkdir, open, rename, stat } from "node:fs/promises"
import { createReadStream } from "node:fs"
import { dirname, resolve } from "node:path"
import readline from "node:readline"
import { Buffer } from "node:buffer"
import { TextDecoder } from "node:util"
import { env } from "node:process"
import { fileURLToPath } from "node:url"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const HELP = `ship.mjs — batch and ship pino JSON logs to a pluggable sink

Sources (pick one):
  --stdin              read lines from stdin (default when no source is given)
  --file <path>        read a file once
  --file <path> --follow   tail the file for appended lines
  --demo               feed built-in sample pino lines and exit

Sinks:
  --sink stdout|file|http   (default: stdout)
  --out <path>              JSONL output for the file sink
                            (default: logs/ship.jsonl; env SHIP_OUT)
  --endpoint <url>          HTTP push endpoint (env SHIP_ENDPOINT)
  --format loki|ndjson|auto (default: auto)

Tuning:
  --batch-size <n>    records per batch        (default: 100,  env SHIP_BATCH_SIZE)
  --flush-ms <n>      max wait before flush    (default: 1000,  env SHIP_FLUSH_MS)
  --max-buffer <n>    pending-record cap       (default: 10000, env SHIP_MAX_BUFFER)
  --max-retries <n>   HTTP retries per batch   (default: 5,     env SHIP_MAX_RETRIES)
  --retry-ms <n>      base retry backoff       (default: 500)
  --rotate-mb <n>     file-sink rotation size  (default: 100,   env SHIP_ROTATE_MB)
  --rotate-keep <n>   rotated files to keep    (default: 3)
  --poll-ms <n>       file-follow poll interval (default: 250)
  --host <name>       hostname label override  (env SHIP_HOST)

Modes:
  --dry-run           parse and count records, send nothing
  --help              show this message
`

function parseArgs(argv) {
  const flags = new Set()
  const values = new Map()
  const positionals = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith("--")) {
      positionals.push(arg)
      continue
    }
    const eq = arg.indexOf("=")
    const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq)
    if (eq !== -1) {
      values.set(key, arg.slice(eq + 1))
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      values.set(key, argv[++i])
    } else {
      flags.add(key)
    }
  }

  return {
    flag: (name) => flags.has(name),
    value: (name, fallback) => {
      const raw = values.get(name) ?? env[`SHIP_${name.toUpperCase().replaceAll("-", "_")}`]
      if (raw === undefined) return fallback
      return raw
    },
    has: (name) => values.has(name) || flags.has(name),
    positionals,
  }
}

function intArg(args, name, fallback) {
  const raw = args.value(name, fallback)
  const parsed = Number.parseInt(String(raw), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

// ---------------------------------------------------------------------------
// Demo fixture — mirrors createLogger() output in src/lib/logger.ts and the
// request summary line emitted by withRequestLogging() in request-logging.ts.
// ---------------------------------------------------------------------------

function demoLine(overrides) {
  return JSON.stringify({
    level: "info",
    time: new Date().toISOString(),
    pid: 412,
    hostname: "spindle-app-1",
    service: "spindle",
    ...overrides,
  })
}

const DEMO_LINES = [
  demoLine({ msg: "server listening", port: 3000 }),
  demoLine({
    level: "info",
    event: "api.request",
    requestId: "req_demo_001",
    method: "GET",
    path: "/api/projects",
    status: 200,
    durationMs: 12.4,
    userId: "user_01JXYZ",
    projectId: null,
    msg: "api request",
  }),
  demoLine({
    level: "warn",
    event: "api.request",
    requestId: "req_demo_002",
    method: "POST",
    path: "/api/uploads",
    status: 413,
    durationMs: 3.1,
    msg: "api request",
  }),
  demoLine({
    level: "error",
    event: "api.request",
    requestId: "req_demo_003",
    method: "GET",
    path: "/api/search",
    status: 500,
    durationMs: 87.9,
    error: { type: "PrismaClientKnownRequestError", message: "connection timeout" },
    msg: "api request",
  }),
  demoLine({
    level: "debug",
    event: "db.query",
    durationMs: 4.2,
    msg: "query executed",
  }),
  // A non-JSON line proves the shipper tolerates stray output.
  "not-json noise from a dependency",
]

// ---------------------------------------------------------------------------
// Record handling
// ---------------------------------------------------------------------------

const PINO_LEVEL_LABELS = {
  10: "trace",
  20: "debug",
  30: "info",
  40: "warn",
  50: "error",
  60: "fatal",
}

function parseRecord(raw) {
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const looksPino =
        "level" in parsed || "msg" in parsed || "time" in parsed || "event" in parsed
      return { raw, parsed, valid: looksPino }
    }
    return { raw, parsed: null, valid: false }
  } catch {
    return { raw, parsed: null, valid: false }
  }
}

function levelLabel(level) {
  if (typeof level === "string") return level
  if (typeof level === "number") return PINO_LEVEL_LABELS[level] ?? "unknown"
  return "unknown"
}

function str(value, fallback) {
  return typeof value === "string" && value.length > 0 ? value : fallback
}

// ---------------------------------------------------------------------------
// Sinks
// ---------------------------------------------------------------------------

const stats = {
  linesRead: 0,
  linesValid: 0,
  linesInvalid: 0,
  batchesSent: 0,
  batchesRetried: 0,
  batchesDropped: 0,
  recordsDropped: 0,
  bytesSent: 0,
}

let sinkName = "stdout"
let outPath = ""
let endpoint = ""
let format = "auto"
let rotateBytes = 100 * 1024 * 1024
let rotateKeep = 3
let hostOverride = ""
let dryRun = false

function resolvedFormat() {
  if (format !== "auto") return format
  return /\/loki(\/|$)/.test(endpoint) ? "loki" : "ndjson"
}

function encodeBody(records) {
  const fmt = resolvedFormat()

  if (fmt === "loki") {
    const streams = new Map()
    const nowNs = String(BigInt(Date.now()) * 1_000_000n)

    for (const { raw, parsed } of records) {
      const obj = parsed ?? {}
      const labels = {
        service: str(obj.service, "unknown"),
        level: levelLabel(obj.level),
        host: hostOverride || str(obj.hostname, "unknown"),
      }
      const key = `${labels.service}|${labels.level}|${labels.host}`
      const timeNs =
        typeof obj.time === "string" && !Number.isNaN(Date.parse(obj.time))
          ? String(BigInt(Date.parse(obj.time)) * 1_000_000n)
          : nowNs

      if (!streams.has(key)) streams.set(key, { stream: labels, values: [] })
      streams.get(key).values.push([timeNs, raw])
    }

    return JSON.stringify({ streams: [...streams.values()] })
  }

  // ndjson (and any non-loki format): one JSON object per line, raw preserved.
  return records.map(({ raw }) => raw).join("\n") + "\n"
}

async function rotateIfNeeded(incomingBytes) {
  try {
    const info = await stat(outPath)
    if (info.size + incomingBytes <= rotateBytes) return
  } catch {
    return // file does not exist yet
  }

  for (let i = rotateKeep - 1; i >= 1; i--) {
    const from = `${outPath}.${i}`
    const to = `${outPath}.${i + 1}`
    try {
      await rename(from, to)
    } catch {
      // missing generation — nothing to shift
    }
  }
  await rename(outPath, `${outPath}.1`).catch(() => {})
}

async function sendToFile(records) {
  const body = records.map(({ raw }) => raw).join("\n") + "\n"
  const bytes = Buffer.byteLength(body)
  await mkdir(dirname(outPath), { recursive: true })
  await rotateIfNeeded(bytes)
  await appendFile(outPath, body)
  stats.bytesSent += bytes
}

async function sendToHttp(records) {
  const body = encodeBody(records)
  const bytes = Buffer.byteLength(body)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: controller.signal,
    })
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300)
      throw new Error(`HTTP ${response.status}: ${detail}`)
    }
  } finally {
    clearTimeout(timer)
  }
  stats.bytesSent += bytes
}

async function sendBatch(records) {
  if (dryRun) return
  if (sinkName === "file") return sendToFile(records)
  if (sinkName === "http") return sendToHttp(records)

  // stdout: raw lines, one per record — composable with downstream tools.
  for (const { raw } of records) console.log(raw)
  stats.bytesSent += records.reduce((sum, { raw }) => sum + raw.length + 1, 0)
}

// ---------------------------------------------------------------------------
// Batching, backpressure, retries
// ---------------------------------------------------------------------------

const pending = []
let batchSize = 100
let flushMs = 1000
let maxBuffer = 10_000
let maxRetries = 5
let retryBaseMs = 500
let inflight = false
let flushTimer = null
let stopped = false
let sourcePaused = false

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))

function scheduleFlush() {
  if (flushTimer || inflight || pending.length === 0) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushOne()
  }, flushMs)
  flushTimer.unref?.()
}

async function flushOne() {
  if (inflight || pending.length === 0) return
  inflight = true

  const batch = pending.splice(0, batchSize)
  let attempt = 0

  while (true) {
    try {
      await sendBatch(batch)
      stats.batchesSent++
      break
    } catch (error) {
      attempt++
      if (attempt > maxRetries || stopped) {
        stats.batchesDropped++
        stats.recordsDropped += batch.length
        console.error(
          `[ship] dropping batch of ${batch.length} records after ${attempt - 1} retries: ${error.message}`,
        )
        break
      }
      stats.batchesRetried++
      const delay = Math.min(retryBaseMs * 2 ** (attempt - 1), 30_000)
      console.error(
        `[ship] send failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms: ${error.message}`,
      )
      await sleep(delay)
    }
  }

  inflight = false
  if (pending.length >= batchSize) void flushOne()
  else scheduleFlush()
}

/** Called after every dequeued source line; pauses the source when full. */
async function backpressure() {
  while (!stopped && pending.length >= maxBuffer) {
    if (!sourcePaused) {
      sourcePaused = true
      pauseSource?.()
    }
    await sleep(50)
    // A flush may still be retrying; keep waiting until the buffer drains.
    if (pending.length < maxBuffer && !inflight) {
      void flushOne()
    }
  }
  if (sourcePaused && pending.length < maxBuffer) {
    sourcePaused = false
    resumeSource?.()
  }
}

let pauseSource = null
let resumeSource = null

async function enqueue(raw) {
  stats.linesRead++
  const record = parseRecord(raw)
  if (record.valid) stats.linesValid++
  else stats.linesInvalid++

  pending.push(record)
  if (pending.length >= batchSize) {
    await flushOne()
  } else {
    scheduleFlush()
  }
  await backpressure()
}

/** Wait until every queued and in-flight record has been flushed or dropped. */
async function drain() {
  while (pending.length > 0 || inflight || flushTimer) {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    await flushOne()
    if (pending.length === 0 && !inflight) break
    await sleep(25)
  }
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

async function* stdinLines() {
  const decoder = new TextDecoder()
  let carry = ""
  for await (const chunk of process.stdin) {
    carry += decoder.decode(chunk, { stream: true })
    const lines = carry.split("\n")
    carry = lines.pop() ?? ""
    for (const line of lines) {
      const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line
      if (trimmed.length > 0) yield trimmed
    }
  }
  carry += decoder.decode()
  if (carry.length > 0) yield carry
}

async function* fileLines(path, follow, pollMs) {
  if (!follow) {
    const rl = readline.createInterface({
      input: createReadStream(path, { encoding: "utf8" }),
      crlfDelay: Infinity,
    })
    for await (const line of rl) {
      if (line.length > 0) yield line
    }
    return
  }

  // Tail mode: poll for appended bytes so rotation/truncation is handled and
  // no lines are missed while the sink is backed up.
  const handle = await open(path, "r")
  try {
    let offset = 0
    let carry = ""
    const decoder = new TextDecoder()

    while (!stopped) {
      const info = await stat(path)
      if (info.size < offset) offset = 0 // truncated or rotated

      if (info.size > offset) {
        const length = info.size - offset
        const buffer = Buffer.alloc(length)
        const { bytesRead } = await handle.read(buffer, 0, length, offset)
        offset += bytesRead

        carry += decoder.decode(buffer.subarray(0, bytesRead), { stream: true })
        const lines = carry.split("\n")
        carry = lines.pop() ?? ""
        for (const line of lines) {
          const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line
          if (trimmed.length > 0) yield trimmed
        }
      } else {
        await sleep(pollMs)
      }
    }

    if (carry.length > 0) yield carry
  } finally {
    await handle.close()
  }
}

function* demoSource() {
  yield* DEMO_LINES
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function printStats(exitCode) {
  const dropped = stats.recordsDropped
  console.error(
    `[ship] done — read=${stats.linesRead} valid=${stats.linesValid} ` +
      `invalid=${stats.linesInvalid} batches=${stats.batchesSent} ` +
      `retried=${stats.batchesRetried} dropped=${stats.batchesDropped} ` +
      `recordsDropped=${dropped} bytes=${stats.bytesSent} sink=${sinkName}` +
      (dryRun ? " (dry-run)" : ""),
  )
  process.exitCode = exitCode
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.flag("help")) {
    console.log(HELP)
    return
  }

  sinkName = String(args.value("sink", "stdout"))
  if (!["stdout", "file", "http"].includes(sinkName)) {
    console.error(`[ship] unknown sink "${sinkName}" (stdout|file|http)`)
    process.exitCode = 2
    return
  }

  outPath = resolve(repoRoot, String(args.value("out", env.SHIP_OUT ?? "logs/ship.jsonl")))
  endpoint = String(args.value("endpoint", env.SHIP_ENDPOINT ?? "http://localhost:3100"))
  format = String(args.value("format", "auto"))
  if (!["auto", "loki", "ndjson"].includes(format)) {
    console.error(`[ship] unknown format "${format}" (auto|loki|ndjson)`)
    console.error(HELP)
    process.exitCode = 2
    return
  }
  rotateBytes = intArg(args, "rotate-mb", 100) * 1024 * 1024
  rotateKeep = Math.max(1, intArg(args, "rotate-keep", 3))
  hostOverride = String(args.value("host", env.SHIP_HOST ?? ""))
  dryRun = args.flag("dry-run")

  batchSize = intArg(args, "batch-size", 100)
  flushMs = intArg(args, "flush-ms", 1000)
  maxBuffer = intArg(args, "max-buffer", 10_000)
  maxRetries = intArg(args, "max-retries", 5)
  retryBaseMs = intArg(args, "retry-ms", 500)

  const filePath = args.value("file", null)
  const follow = args.flag("follow")
  const useDemo = args.flag("demo")
  const useStdin = args.flag("stdin") || (!useDemo && filePath === null)

  // stdin backpressure hooks: the async iterator cannot be paused directly,
  // but awaiting between yields keeps the kernel buffer bounded.
  let source
  if (useDemo) {
    source = demoSource()
  } else if (filePath !== null) {
    source = fileLines(resolve(repoRoot, String(filePath)), follow, intArg(args, "poll-ms", 250))
  } else if (useStdin) {
    source = stdinLines()
    // The stream async iterator buffers internally; pausing the underlying
    // stream keeps kernel/user-space buffers bounded while the sink is full.
    pauseSource = () => process.stdin.pause()
    resumeSource = () => process.stdin.resume()
  } else {
    console.error("[ship] no input source; use --stdin, --file <path>, or --demo")
    process.exitCode = 2
    return
  }

  if (sinkName === "http" && !endpoint.startsWith("http")) {
    console.error(`[ship] http sink requires an http(s) --endpoint, got "${endpoint}"`)
    process.exitCode = 2
    return
  }

  const onSignal = () => {
    stopped = true
  }
  process.on("SIGINT", onSignal)
  process.on("SIGTERM", onSignal)

  try {
    for await (const raw of source) {
      if (stopped) break
      await enqueue(raw)
    }
  } catch (error) {
    console.error(`[ship] source error: ${error.message}`)
    stopped = true
  }

  await drain()
  printStats(0)
}

main().catch((error) => {
  console.error(`[ship] fatal: ${error.stack ?? error.message}`)
  process.exitCode = 1
})
