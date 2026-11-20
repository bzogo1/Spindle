#!/usr/bin/env node
/**
 * Prometheus exposition endpoint for Spindle's log-derived metrics.
 *
 * scripts/metrics/log-metrics.mjs is a one-shot tool: it parses a JSONL log
 * file and prints a Prometheus text exposition, then exits. This tiny
 * dependency-free HTTP wrapper re-runs it on demand (with a short TTL cache)
 * so a Prometheus server has a real scrape target. It is used by the OPTIONAL
 * local stack in infra/observability/compose.observability.yml — it is not
 * part of the production app and nothing deploys it by default.
 *
 * Usage:
 *   node scripts/observability/serve-metrics.mjs --file logs/ship.jsonl
 *   node scripts/observability/serve-metrics.mjs --demo
 *   METRICS_LOG_FILE=/repo/logs/ship.jsonl METRICS_PORT=9100 \
 *     node scripts/observability/serve-metrics.mjs
 *
 * Endpoints:
 *   GET /metrics   Prometheus text exposition (text/plain; version=0.0.4)
 *   GET /healthz   liveness probe
 *
 * Environment / flags:
 *   --file <path> | METRICS_LOG_FILE   JSONL log file to measure (default:
 *                                      logs/ship.jsonl under the repo root)
 *   --demo                            feed the tool's built-in fixture instead
 *   --config <path>                   log-metrics.config.json override
 *   --port <n>    | METRICS_PORT       listen port (default: 9100)
 *   --cache-ms <n>| METRICS_CACHE_MS   reuse the last exposition for this long
 *                                      (default: 15000; 0 disables caching)
 *
 * The log file is streamed by the child process, so large files are fine —
 * but metrics are only as fresh as the file. Point this at a bounded slice
 * (a rotated ship.mjs spool, one cron interval's output), not an
 * ever-growing file, per docs/observability/log-based-metrics.md.
 */

import { createServer } from "node:http"
import { spawn } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Buffer } from "node:buffer"
import { env } from "node:process"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const METRICS_SCRIPT = resolve(repoRoot, "scripts/metrics/log-metrics.mjs")

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const values = new Map()
  const flags = new Set()
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith("--")) continue
    const eq = arg.indexOf("=")
    const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq)
    if (eq !== -1) values.set(key, arg.slice(eq + 1))
    else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      values.set(key, argv[++i])
    } else {
      flags.add(key)
    }
  }
  return {
    flag: (name) => flags.has(name),
    value: (name, fallback) =>
      values.get(name) ?? env[`METRICS_${name.toUpperCase().replaceAll("-", "_")}`] ?? fallback,
  }
}

const HELP = `serve-metrics.mjs — HTTP wrapper that serves log-metrics.mjs Prometheus output

  --file <path>     JSONL log file (env METRICS_LOG_FILE; default logs/ship.jsonl)
  --demo            use the tool's built-in synthetic fixture
  --config <path>   metric definitions override
  --port <n>        listen port (env METRICS_PORT; default 9100)
  --cache-ms <n>    exposition cache TTL (env METRICS_CACHE_MS; default 15000)
  --help            show this message

Endpoints: GET /metrics, GET /healthz
`

// ---------------------------------------------------------------------------
// Exposition generation — spawn the tool, capture its stdout.
// ---------------------------------------------------------------------------

const MAX_EXPOSITION_BYTES = 16 * 1024 * 1024

function generateExposition(options) {
  return new Promise((resolvePromise, reject) => {
    const args = [METRICS_SCRIPT]
    if (options.demo) args.push("--demo")
    else {
      args.push("--file", options.file)
      if (options.config) args.push("--config", options.config)
    }
    args.push("--format", "prometheus")

    const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] })
    const chunks = []
    let bytes = 0
    let stderr = ""
    let failed = false

    child.stdout.on("data", (chunk) => {
      bytes += chunk.length
      if (bytes <= MAX_EXPOSITION_BYTES) chunks.push(chunk)
      else failed = true
    })
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 4096) stderr += chunk.toString()
    })
    child.on("error", reject)
    child.on("close", (code) => {
      if (failed || code !== 0) {
        reject(new Error(`log-metrics.mjs exited ${code}: ${stderr.trim().slice(0, 500)}`))
        return
      }
      resolvePromise(Buffer.concat(chunks).toString("utf8"))
    })
  })
}

// ---------------------------------------------------------------------------
// HTTP server with a tiny TTL cache.
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.flag("help")) {
    console.log(HELP)
    return
  }

  const options = {
    demo: args.flag("demo"),
    file: resolve(repoRoot, String(args.value("file", "logs/ship.jsonl"))),
    config: args.value("config", null),
  }
  const port = Number.parseInt(String(args.value("port", "9100")), 10)
  const cacheMs = Math.max(0, Number.parseInt(String(args.value("cache-ms", "15000")), 10) || 0)

  if (!options.demo && options.file === "") {
    console.error("[serve-metrics] --file must not be empty")
    process.exitCode = 2
    return
  }

  let cache = null // { at, body, error }

  const exposition = async () => {
    if (cache && cacheMs > 0 && Date.now() - cache.at < cacheMs) return cache
    try {
      const body = await generateExposition(options)
      cache = { at: Date.now(), body, error: null }
    } catch (error) {
      cache = { at: Date.now(), body: null, error }
    }
    return cache
  }

  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname

    if (path === "/healthz") {
      response.writeHead(200, { "content-type": "text/plain" })
      response.end("ok\n")
      return
    }

    if (path !== "/metrics") {
      response.writeHead(404, { "content-type": "text/plain" })
      response.end("not found\n")
      return
    }

    const result = await exposition()
    if (result.error) {
      response.writeHead(503, { "content-type": "text/plain" })
      response.end(`metrics unavailable: ${result.error.message}\n`)
      return
    }
    response.writeHead(200, {
      "content-type": "text/plain; version=0.0.4; charset=utf-8",
      "cache-control": "no-store",
    })
    response.end(result.body)
  })

  server.listen(port, "0.0.0.0", () => {
    const source = options.demo ? "--demo fixture" : options.file
    console.log(`[serve-metrics] listening on :${port} metrics=${source} cacheMs=${cacheMs}`)
  })
}

main().catch((error) => {
  console.error(`[serve-metrics] fatal: ${error.stack ?? error.message}`)
  process.exitCode = 1
})
