#!/usr/bin/env node
// Chaos engineering runner for Spindle.
//
//   node scripts/chaos/run.mjs --demo                     # full offline pipeline
//   node scripts/chaos/run.mjs --dry-run                  # print the plan, run nothing
//   node scripts/chaos/run.mjs --experiment error-rate-injection-api --env local
//   node scripts/chaos/run.mjs --all --env local --target http://localhost:3000
//
// Executes experiments from scripts/chaos/experiments.json in three phases:
//   baseline  -> steady-state hypothesis checks (probe loop, no fault)
//   chaos     -> fault applied, blast radius measured (error rate / latency)
//   recovery  -> fault removed, recovery hypothesis verified
//
// Fault adapters (chosen by experiment `kind`):
//   proxy          in-process fault-injection proxy (scripts/chaos/fault-proxy.mjs)
//   compose-stop   `docker compose stop <service>` / `start <service>`
//   compose-pause  `docker compose pause|unpause <service>`
//   host-load      spawn CPU worker processes for the chaos duration
//   admin          POST a fault payload to <target>/__admin/fault (demo dummy
//                  server, or any app exposing a test-only fault hook)
//
// In --demo mode a built-in dummy upstream is started and every experiment is
// mapped onto a supported adapter (docker kinds become simulated admin faults),
// so the whole pipeline runs offline with no app, database, or docker.
//
// Safety: refuses production-like environments and non-loopback targets unless
// explicitly overridden. See docs/resilience/chaos-engineering.md.
//
// Exit codes: 0 all experiments passed (or observational), 1 hypothesis
// failure, 2 usage/config error, 3 safety refusal.

/* eslint-disable no-restricted-properties --
   entrypoint script: parses CLI flags and env overrides before any app code
   loads, so src/lib/env.ts cannot be used here. */
/* global AbortSignal */

import { spawn, execFile } from "node:child_process"
import http from "node:http"
import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { startFaultProxy } from "./fault-proxy.mjs"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const DEFAULT_EXPERIMENTS = join(ROOT, "scripts", "chaos", "experiments.json")
const COMPOSE_FILE = join(ROOT, "compose.yaml")

const USAGE = `Usage: node scripts/chaos/run.mjs [options]

Modes:
  --demo                  run the full pipeline against a built-in dummy server
                          (offline; no app/docker required)
  --dry-run               validate the catalog and print the execution plan
  --list                  list experiments and exit

Selection:
  --experiment <id>       run one experiment (repeatable or comma-separated)
  --all                   run every experiment runnable in this environment
  (default)               run experiments tagged for the resolved environment

Target / environment:
  --target <url>          base URL of the app under test (default:
                          CHAOS_TARGET or http://localhost:3000; --demo ignores)
  --env <name>            environment label: local|demo|dev|test|staging
                          (default: CHAOS_ENV, NODE_ENV, or 'local')
  --allow-remote          permit non-loopback targets (never permits prod)

Tuning:
  --scale <factor>        multiply all durations/sample counts (default 1)
  --chaos-duration <ms>   override chaos duration for all experiments
  --probe <path>          override probe path for all experiments
  --interval <ms>         override probe interval
  --json                  print only the JSON report
  --help, -h              show this message

Exit codes: 0 pass/observational, 1 hypothesis failure, 2 usage error,
            3 safety refusal.`

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function log(json, ...args) {
  if (!json) console.log("[chaos]", ...args)
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, idx)]
}

function summarize(samples) {
  const ok = samples.filter((s) => s.ok)
  const latencies = samples.map((s) => s.latencyMs).sort((a, b) => a - b)
  const okLatencies = ok.map((s) => s.latencyMs).sort((a, b) => a - b)
  const statuses = {}
  for (const s of samples) statuses[s.status ?? "error"] = (statuses[s.status ?? "error"] || 0) + 1
  return {
    samples: samples.length,
    successes: ok.length,
    successRate: samples.length ? ok.length / samples.length : 0,
    errorRate: samples.length ? 1 - ok.length / samples.length : 0,
    avgLatencyMs: samples.length
      ? Math.round(samples.reduce((a, s) => a + s.latencyMs, 0) / samples.length)
      : 0,
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    avgOkLatencyMs: okLatencies.length
      ? Math.round(okLatencies.reduce((a, b) => a + b, 0) / okLatencies.length)
      : 0,
    statuses,
  }
}

// ---------------------------------------------------------------------------
// Environment safety guard
// ---------------------------------------------------------------------------

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"])
const PRIVATE_HOST_RE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|.*\.local$|.*\.internal$)/

function isPrivateOrLocalHost(hostname) {
  const h = String(hostname).replace(/^\[|\]$/g, "")
  if (LOCAL_HOSTS.has(h)) return true
  if (PRIVATE_HOST_RE.test(h)) return true
  // docker-compose service names commonly used in local stacks
  if (/^[a-z][a-z0-9-]*$/.test(h) && !h.includes(".")) return true
  return false
}

function assertSafeEnvironment({ env, targetUrl, allowRemote, demo }) {
  if (demo) return { env: "demo" }
  const normalized = String(env || "local").toLowerCase()
  if (/prod|production/.test(normalized)) {
    throw new SafetyError(
      `refusing to run chaos experiments against environment '${env}'. ` +
        "Chaos experiments are for local/dev/staging only. See docs/resilience/chaos-engineering.md.",
    )
  }
  const allowed = new Set(["local", "demo", "dev", "development", "test", "staging"])
  if (!allowed.has(normalized)) {
    throw new SafetyError(`unknown environment '${env}'. Allowed: ${[...allowed].join(", ")}`)
  }
  if (targetUrl) {
    let host
    try {
      host = new URL(targetUrl).hostname
    } catch {
      throw new ConfigError(`invalid --target URL: ${targetUrl}`)
    }
    if (!isPrivateOrLocalHost(host) && !allowRemote) {
      throw new SafetyError(
        `target host '${host}' is not loopback/private. Pass --allow-remote to confirm ` +
          "this is a non-production environment you own.",
      )
    }
  }
  return { env: normalized }
}

class SafetyError extends Error {}
class ConfigError extends Error {}

// ---------------------------------------------------------------------------
// Fault adapters
// ---------------------------------------------------------------------------

function makeAdminAdapter(targetUrl, faultPayloadFor) {
  const endpoint = `${targetUrl.replace(/\/$/, "")}/__admin/fault`
  return {
    name: "admin",
    async apply(exp, ctx) {
      const payload = faultPayloadFor(exp)
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) throw new ConfigError(`admin fault endpoint returned ${res.status}`)
      ctx.log(`admin fault applied: ${JSON.stringify(payload)}`)
    },
    async revert(exp, ctx) {
      await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "ok" }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => {})
      ctx.log("admin fault cleared")
    },
  }
}

function dockerAvailable() {
  return new Promise((resolvePromise) => {
    execFile("docker", ["compose", "version"], { timeout: 10000 }, (err) => {
      resolvePromise(!err)
    })
  })
}

function composeAction(action, service) {
  return new Promise((resolvePromise, reject) => {
    execFile(
      "docker",
      ["compose", "-f", COMPOSE_FILE, action, service],
      { timeout: 90000, cwd: ROOT },
      (err, stdout, stderr) => {
        if (err) reject(new Error(`docker compose ${action} ${service}: ${stderr || err.message}`))
        else resolvePromise(stdout.trim())
      },
    )
  })
}

function makeComposeAdapter(kind, service, ctx) {
  const action = kind === "compose-stop" ? "stop" : "pause"
  const revertAction = kind === "compose-stop" ? "start" : "unpause"
  return {
    name: kind,
    async apply() {
      const out = await composeAction(action, service)
      ctx.log(`docker compose ${action} ${service}${out ? ` (${out})` : ""}`)
    },
    async revert() {
      await composeAction(revertAction, service)
      ctx.log(`docker compose ${revertAction} ${service}`)
    },
  }
}

function makeHostLoadAdapter(workers) {
  const procs = []
  return {
    name: "host-load",
    async apply(exp, ctx) {
      const n = exp.workers ?? workers ?? 4
      for (let i = 0; i < n; i++) {
        const p = spawn(process.execPath, ["-e", "while(true){}"], { stdio: "ignore" })
        procs.push(p)
      }
      ctx.log(`spawned ${n} CPU worker processes`)
    },
    async revert() {
      for (const p of procs.splice(0)) p.kill("SIGKILL")
    },
  }
}

async function resolveAdapter(exp, { targetUrl, demo, ctx }) {
  if (exp.kind === "proxy") {
    const proxy = await startFaultProxy({ target: targetUrl, port: 0 })
    ctx.log(`fault proxy on ${proxy.url} -> ${targetUrl}`)
    // A proxy-level timeout only fires if the upstream actually stalls. In
    // demo mode the dummy server exposes an admin hook, so stall it too —
    // this mirrors a real run where the app's dependency hangs.
    const stallDemoUpstream =
      demo && exp.fault?.timeoutMs != null ? `${targetUrl.replace(/\/$/, "")}/__admin/fault` : null
    const postDemoFault = (payload) =>
      stallDemoUpstream
        ? fetch(stallDemoUpstream, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(5000),
          }).catch(() => {})
        : Promise.resolve()
    return {
      name: "proxy",
      probeBase: proxy.url,
      async apply() {
        await postDemoFault({ mode: "hang" })
        proxy.setFault(exp.fault || {})
        ctx.log(`proxy fault applied: ${JSON.stringify(proxy.getFault())}`)
      },
      async revert() {
        proxy.setFault({ latencyMs: 0, jitterMs: 0, errorRate: 0, timeoutMs: null, match: null })
        await postDemoFault({ mode: "ok" })
        ctx.log("proxy fault cleared")
      },
      async close() {
        await proxy.close()
      },
    }
  }

  if (demo) {
    // Simulate non-proxy experiments through the dummy server's fault hook.
    const payload = demoFaultPayload(exp)
    ctx.log(`demo mode: ${exp.kind} simulated via admin fault ${JSON.stringify(payload)}`)
    return makeAdminAdapter(targetUrl, () => payload)
  }

  if (exp.kind === "compose-stop" || exp.kind === "compose-pause") {
    if (!(await dockerAvailable())) {
      return { name: exp.kind, skipped: "docker compose not available" }
    }
    return makeComposeAdapter(exp.kind, exp.service, ctx)
  }

  if (exp.kind === "host-load") {
    return makeHostLoadAdapter(exp.workers)
  }

  if (exp.kind === "admin") {
    return makeAdminAdapter(targetUrl, () => exp.fault || { mode: "error" })
  }

  return { name: exp.kind, skipped: `unknown kind '${exp.kind}'` }
}

function demoFaultPayload(exp) {
  switch (exp.kind) {
    case "compose-stop":
      return { mode: "error", errorRate: 1, status: 503 } // DB down -> API fails
    case "compose-pause":
      return { mode: "timeout", timeoutMs: 400 } // hung DB -> queries time out
    case "host-load":
      return { mode: "latency", latencyMs: 700, jitterMs: 200 }
    default:
      return { mode: "error", errorRate: 1, status: 503 }
  }
}

// ---------------------------------------------------------------------------
// Probing
// ---------------------------------------------------------------------------

async function probe(baseUrl, { path, method = "GET", timeoutMs, expectedStatus }) {
  const started = performance.now()
  // AbortController (not AbortSignal.timeout) so the timeout covers the whole
  // exchange including body consumption, not just time-to-headers.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      signal: controller.signal,
      redirect: "manual",
    })
    // Drain body so the socket is released; bounded by the same abort.
    await res.arrayBuffer().catch(() => {})
    const latencyMs = Math.round(performance.now() - started)
    const ok =
      expectedStatus != null ? res.status === expectedStatus : res.status >= 200 && res.status < 400
    return { ok, status: res.status, latencyMs }
  } catch (err) {
    return {
      ok: false,
      status: "error",
      latencyMs: Math.round(performance.now() - started),
      error:
        err.name === "TimeoutError" || err.name === "AbortError"
          ? "timeout"
          : String(err.cause?.code || err.message || err),
    }
  } finally {
    clearTimeout(timer)
  }
}

async function probeLoop(baseUrl, probeCfg, { durationMs, intervalMs, timeoutMs, onSample }) {
  const deadline = durationMs ? Date.now() + durationMs : Infinity
  const samples = []
  while (Date.now() < deadline || samples.length === 0) {
    const s = await probe(baseUrl, { ...probeCfg, timeoutMs })
    samples.push(s)
    onSample?.(s)
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    await sleep(Math.min(intervalMs, Math.max(0, remaining)))
  }
  return samples
}

// ---------------------------------------------------------------------------
// Hypothesis evaluation
// ---------------------------------------------------------------------------

const CHECKS = {
  successRateMin: (m, v) => ({
    name: "successRateMin",
    expected: `>= ${v}`,
    actual: m.successRate.toFixed(3),
    pass: m.successRate >= v,
  }),
  successRateMax: (m, v) => ({
    name: "successRateMax",
    expected: `<= ${v}`,
    actual: m.successRate.toFixed(3),
    pass: m.successRate <= v,
  }),
  avgLatencyMinMs: (m, v) => ({
    name: "avgLatencyMinMs",
    expected: `>= ${v}`,
    actual: m.avgLatencyMs,
    pass: m.avgLatencyMs >= v,
  }),
  avgLatencyMaxMs: (m, v) => ({
    name: "avgLatencyMaxMs",
    expected: `<= ${v}`,
    actual: m.avgLatencyMs,
    pass: m.avgLatencyMs <= v,
  }),
  p95LatencyMinMs: (m, v) => ({
    name: "p95LatencyMinMs",
    expected: `>= ${v}`,
    actual: m.p95LatencyMs,
    pass: m.p95LatencyMs >= v,
  }),
  p95LatencyMaxMs: (m, v) => ({
    name: "p95LatencyMaxMs",
    expected: `<= ${v}`,
    actual: m.p95LatencyMs,
    pass: m.p95LatencyMs <= v,
  }),
  observedStatusesInclude: (m, v) => ({
    name: "observedStatusesInclude",
    expected: `see ${JSON.stringify(v)}`,
    actual: JSON.stringify(m.statuses),
    pass: v.every((code) => Object.prototype.hasOwnProperty.call(m.statuses, code)),
  }),
}

function evaluateHypothesis(hypothesis, metrics) {
  if (!hypothesis) return { observational: true, checks: [], pass: true }
  const keys = Object.keys(hypothesis).filter((k) => k !== "note")
  if (keys.length === 0) {
    return { observational: true, checks: [], pass: true, note: hypothesis.note }
  }
  const checks = []
  let pass = true
  for (const key of keys) {
    const check = CHECKS[key]
    if (!check) {
      checks.push({ name: key, expected: "(unknown check)", actual: "-", pass: false })
      pass = false
      continue
    }
    const result = check(metrics, hypothesis[key])
    checks.push(result)
    if (!result.pass) pass = false
  }
  return { observational: false, checks, pass }
}

function hypothesisPasses(hypothesis, samples) {
  const ev = evaluateHypothesis(hypothesis, summarize(samples))
  return ev.pass
}

// ---------------------------------------------------------------------------
// Dummy server for --demo
// ---------------------------------------------------------------------------

function startDummyServer() {
  let fault = { mode: "ok" }
  const server = http.createServer(async (req, res) => {
    const url = req.url || "/"

    if (url === "/__admin/fault" && req.method === "POST") {
      let body = ""
      for await (const chunk of req) body += chunk
      try {
        fault = { mode: "ok", ...JSON.parse(body || "{}") }
      } catch {
        fault = { mode: "ok" }
      }
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ fault }))
      return
    }
    if (url === "/__admin/fault" && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ fault }))
      return
    }

    // Liveness endpoint: always up, not faulted — proves the process survives.
    if (url === "/health") {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ status: "ok", service: "chaos-dummy" }))
      return
    }

    // Faultable API surface.
    if (url.startsWith("/api/")) {
      // "hang" simulates a dead dependency: accept the request, never respond.
      // Clients/proxies must time out on their own.
      if (fault.mode === "hang") return
      const latency =
        fault.mode === "latency"
          ? (fault.latencyMs ?? 500) + Math.floor(Math.random() * ((fault.jitterMs ?? 0) + 1))
          : 0
      const respond = () => {
        if (fault.mode === "error" && Math.random() < (fault.errorRate ?? 1)) {
          res.writeHead(fault.status ?? 503, { "content-type": "application/json" })
          res.end(JSON.stringify({ error: "dependency-down", simulated: true }))
          return
        }
        if (fault.mode === "timeout") {
          res.writeHead(504, { "content-type": "application/json" })
          res.end(JSON.stringify({ error: "chaos-timeout", simulated: true }))
          return
        }
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({ ok: true, path: url, service: "chaos-dummy" }))
      }
      if (latency > 0) setTimeout(respond, latency)
      else respond()
      return
    }

    res.writeHead(404, { "content-type": "application/json" })
    res.end(JSON.stringify({ error: "not-found" }))
  })

  return new Promise((resolvePromise, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address()
      resolvePromise({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      })
    })
  })
}

// ---------------------------------------------------------------------------
// Experiment execution
// ---------------------------------------------------------------------------

async function runExperiment(exp, cfg) {
  const { defaults, scale, overrides, ctx } = cfg
  const intervalMs = overrides.intervalMs ?? defaults.probeIntervalMs
  const chaosDurationMs = overrides.chaosDurationMs ?? Math.round(defaults.chaosDurationMs * scale)
  const baselineSamples = Math.max(1, Math.round(defaults.baselineSamples * scale))
  const recoverySamples = Math.max(2, Math.round(defaults.recoverySamples * scale))
  const recoveryTimeoutMs = Math.round(defaults.recoveryTimeoutMs * scale)
  const probeTimeoutMs = defaults.probeTimeoutMs

  const probeCfg = {
    path: overrides.probePath ?? exp.probe?.path ?? defaults.probePath,
    method: exp.probe?.method ?? "GET",
    expectedStatus: exp.probe?.expectedStatus,
  }

  const result = {
    id: exp.id,
    title: exp.title,
    kind: exp.kind,
    severity: exp.severity,
    status: "pending",
    phases: {},
  }

  ctx.log(`experiment '${exp.id}' (${exp.kind}) — chaos ${chaosDurationMs}ms`)

  const adapter = await resolveAdapter(exp, {
    targetUrl: cfg.targetUrl,
    demo: cfg.demo,
    ctx,
  })
  if (adapter.skipped) {
    result.status = "skipped"
    result.reason = adapter.skipped
    ctx.log(`skipped: ${adapter.skipped}`)
    return result
  }

  const probeBase = adapter.probeBase ?? cfg.targetUrl
  const samplesFor = { baseline: [], chaos: [], recovery: [] }

  try {
    // -- Phase 1: baseline (steady state, no fault) --
    ctx.log(`phase baseline: ${baselineSamples} probes`)
    samplesFor.baseline = []
    for (let i = 0; i < baselineSamples; i++) {
      const s = await probe(probeBase, { ...probeCfg, timeoutMs: probeTimeoutMs })
      samplesFor.baseline.push(s)
      if (i < baselineSamples - 1) await sleep(intervalMs)
    }

    const baselineMetrics = summarize(samplesFor.baseline)
    const baselineEval = evaluateHypothesis(exp.hypothesis?.baseline, baselineMetrics)
    result.phases.baseline = { metrics: baselineMetrics, ...baselineEval }

    if (!baselineEval.pass) {
      result.status = "failed"
      result.failurePhase = "baseline"
      ctx.log(`baseline hypothesis FAILED — aborting experiment (system not in steady state)`)
      return result
    }

    // -- Phase 2: chaos --
    ctx.log(`phase chaos: applying fault for ${chaosDurationMs}ms`)
    await adapter.apply(exp, ctx)
    await sleep(250) // let the fault settle
    await probeLoop(probeBase, probeCfg, {
      durationMs: chaosDurationMs,
      intervalMs,
      timeoutMs: probeTimeoutMs,
      onSample: (s) => samplesFor.chaos.push(s),
    })
    await adapter.revert(exp, ctx)

    const chaosMetrics = summarize(samplesFor.chaos)
    const chaosEval = evaluateHypothesis(exp.hypothesis?.chaos, chaosMetrics)
    result.phases.chaos = { metrics: chaosMetrics, ...chaosEval }
    if (!chaosEval.pass) {
      result.status = "failed"
      result.failurePhase = "chaos"
      ctx.log(`chaos hypothesis FAILED (blast radius outside expected bounds)`)
      // Continue to recovery anyway so post-chaos state is still captured.
    }

    // -- Phase 3: recovery --
    ctx.log(`phase recovery: up to ${recoveryTimeoutMs}ms`)
    const recoveryDeadline = Date.now() + recoveryTimeoutMs
    while (Date.now() < recoveryDeadline) {
      const s = await probe(probeBase, { ...probeCfg, timeoutMs: probeTimeoutMs })
      samplesFor.recovery.push(s)
      if (
        samplesFor.recovery.length >= recoverySamples &&
        hypothesisPasses(exp.hypothesis?.recovery, samplesFor.recovery)
      ) {
        break
      }
      await sleep(intervalMs)
    }

    const recoveryMetrics = summarize(samplesFor.recovery)
    const recoveryEval = evaluateHypothesis(exp.hypothesis?.recovery, recoveryMetrics)
    result.phases.recovery = { metrics: recoveryMetrics, ...recoveryEval }

    const failedPhases = ["baseline", "chaos", "recovery"].filter(
      (p) => result.phases[p] && result.phases[p].pass === false,
    )
    result.status = failedPhases.length === 0 ? "passed" : "failed"
    if (failedPhases.length) result.failurePhase = failedPhases.join(",")
    ctx.log(
      `result: ${result.status}${result.failurePhase ? ` (failed: ${result.failurePhase})` : ""}`,
    )
  } catch (err) {
    result.status = "error"
    result.error = err.message
    ctx.log(`error: ${err.message}`)
    // Best-effort revert so we never leave a fault applied.
    try {
      await adapter.revert?.(exp, ctx)
    } catch {
      /* ignore */
    }
  } finally {
    if (adapter.close) await adapter.close().catch(() => {})
  }

  return result
}

// ---------------------------------------------------------------------------
// CLI / main
// ---------------------------------------------------------------------------

function parseCli(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      demo: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      list: { type: "boolean", default: false },
      experiment: { type: "string", multiple: true },
      all: { type: "boolean", default: false },
      target: { type: "string" },
      env: { type: "string" },
      "allow-remote": { type: "boolean", default: false },
      scale: { type: "string" },
      "chaos-duration": { type: "string" },
      probe: { type: "string" },
      interval: { type: "string" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  })
  return values
}

function loadCatalog(path) {
  const raw = JSON.parse(readFileSync(path, "utf8"))
  if (!Array.isArray(raw.experiments)) throw new ConfigError("catalog has no 'experiments' array")
  return raw
}

async function main() {
  const cli = parseCli(process.argv.slice(2))
  if (cli.help) {
    console.log(USAGE)
    return 0
  }

  const catalogPath = process.env.CHAOS_EXPERIMENTS ?? DEFAULT_EXPERIMENTS
  const catalog = loadCatalog(catalogPath)
  const defaults = catalog.defaults || {}
  const scale = cli.scale != null ? Number(cli.scale) : 1
  if (!Number.isFinite(scale) || scale <= 0)
    throw new ConfigError("--scale must be a positive number")

  if (cli.list) {
    for (const e of catalog.experiments) {
      console.log(
        `${e.id.padEnd(28)} ${e.kind.padEnd(14)} ${e.severity.padEnd(8)} tags=[${(e.tags || []).join(",")}]`,
      )
    }
    return 0
  }

  // -- Resolve target & environment --
  let targetUrl = cli.target ?? process.env.CHAOS_TARGET ?? "http://localhost:3000"
  let demo = cli.demo
  const envName =
    cli.env ?? (demo ? "demo" : (process.env.CHAOS_ENV ?? process.env.NODE_ENV ?? "local"))

  let dummy = null
  if (demo) {
    dummy = await startDummyServer()
    targetUrl = dummy.url
    const info = (msg) => (cli.json ? console.error(msg) : console.log(msg))
    info(`[chaos] demo mode: dummy upstream at ${targetUrl}`)
  }

  const { env: envLabel } = assertSafeEnvironment({
    env: envName,
    targetUrl,
    allowRemote: cli["allow-remote"],
    demo,
  })

  // -- Select experiments --
  let selected
  const requested = (cli.experiment ?? []).flatMap((s) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  )
  if (cli.experiment?.length) {
    const byId = new Map(catalog.experiments.map((e) => [e.id, e]))
    selected = []
    for (const id of requested) {
      const e = byId.get(id)
      if (!e) throw new ConfigError(`unknown experiment '${id}' (see --list)`)
      selected.push(e)
    }
  } else {
    const tag = demo ? "demo" : envLabel
    selected = catalog.experiments.filter((e) => (e.tags || []).includes(tag))
    if (cli.all) selected = catalog.experiments
    if (selected.length === 0) {
      throw new ConfigError(`no experiments tagged '${tag}'. Use --all or --experiment <id>.`)
    }
  }

  const overrides = {
    chaosDurationMs: cli["chaos-duration"] != null ? Number(cli["chaos-duration"]) : undefined,
    probePath: cli.probe,
    intervalMs: cli.interval != null ? Number(cli.interval) : undefined,
  }

  const plan = {
    mode: demo ? "demo" : cli["dry-run"] ? "dry-run" : "run",
    environment: envLabel,
    target: targetUrl,
    scale,
    experiments: selected.map((e) => ({
      id: e.id,
      kind: e.kind,
      chaosDurationMs: overrides.chaosDurationMs ?? Math.round(defaults.chaosDurationMs * scale),
      probe: overrides.probePath ?? e.probe?.path ?? defaults.probePath,
      fault: e.fault ?? {},
    })),
  }

  if (cli["dry-run"]) {
    console.log(JSON.stringify(plan, null, 2))
    if (dummy) await dummy.close()
    return 0
  }

  const json = cli.json
  const info = (msg) => (json ? console.error(msg) : console.log(msg))
  info(
    `[chaos] environment=${envLabel} target=${targetUrl} experiments=${selected.length} scale=${scale}`,
  )

  const results = []
  for (const exp of selected) {
    const ctx = {
      log: (...args) => log(json, ...args),
    }
    const r = await runExperiment(exp, {
      defaults,
      scale,
      overrides,
      json,
      envLabel,
      demo,
      targetUrl,
      ctx,
    })
    results.push(r)
    if (!json) printResult(r)
  }

  const summary = {
    environment: envLabel,
    target: targetUrl,
    mode: demo ? "demo" : "run",
    total: results.length,
    passed: results.filter((r) => r.status === "passed").length,
    failed: results.filter((r) => r.status === "failed").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    errored: results.filter((r) => r.status === "error").length,
    observational: results.filter(
      (r) => r.phases.chaos?.observational || r.phases.baseline?.observational,
    ).length,
    results,
  }

  if (json) console.log(JSON.stringify(summary, null, 2))
  else {
    console.log(
      `[chaos] summary: ${summary.passed} passed, ${summary.failed} failed, ` +
        `${summary.skipped} skipped, ${summary.errored} errored, ${summary.observational} observational`,
    )
  }

  if (dummy) await dummy.close()
  return summary.failed + summary.errored > 0 ? 1 : 0
}

function printResult(r) {
  const icon =
    { passed: "PASS", failed: "FAIL", skipped: "SKIP", error: "ERR", pending: "..." }[r.status] ??
    r.status
  console.log(`\n[chaos] === ${icon} ${r.id} (${r.kind}) ===`)
  for (const phase of ["baseline", "chaos", "recovery"]) {
    const p = r.phases?.[phase]
    if (!p) continue
    const m = p.metrics
    const metrics = m
      ? `samples=${m.samples} ok=${(m.successRate * 100).toFixed(0)}% avg=${m.avgLatencyMs}ms p95=${m.p95LatencyMs}ms`
      : ""
    console.log(
      `  ${phase.padEnd(9)} ${p.observational ? "observational" : p.pass ? "ok" : "FAILED"} ${metrics}`,
    )
    for (const c of p.checks ?? []) {
      console.log(
        `            ${c.pass ? "✓" : "✗"} ${c.name}: expected ${c.expected}, got ${c.actual}`,
      )
    }
    if (p.note) console.log(`            note: ${p.note}`)
  }
  if (r.reason) console.log(`  reason: ${r.reason}`)
  if (r.error) console.log(`  error: ${r.error}`)
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    if (err instanceof SafetyError) {
      console.error(`[chaos] SAFETY: ${err.message}`)
      process.exit(3)
    }
    if (err instanceof ConfigError) {
      console.error(`[chaos] CONFIG: ${err.message}`)
      process.exit(2)
    }
    console.error(`[chaos] FATAL: ${err.stack || err.message}`)
    process.exit(2)
  })
