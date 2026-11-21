#!/usr/bin/env node
// Alert escalation engine for Spindle.
//
//   node scripts/alerts/escalate.mjs [options]
//
// Consumes alert events (JSON on stdin, --file, or --input), routes them
// through docs/alerts/routing.json to a policy in docs/alerts/policies.json,
// and runs the escalation state machine:
//
//   trigger -> notify L1 -> (unacked after ackTimeoutMinutes) notify L2 ->
//   ... -> L3 -> repeat final level every repeatIntervalMinutes (if set)
//
// Incidents are acknowledged with an {"type":"ack", ...} event, a --ack flag,
// or the receiving system's ack call; they are closed with {"type":"resolve"}
// / "status":"resolved" / --resolve. State is persisted as JSON so the engine
// can be run on a cron/tick cadence: ingest events, then re-run periodically
// (or pass --tick) to fire due escalations.
//
// Supported input shapes (see docs/alerts/escalation-policies.md):
//   - db-monitor report:  {"type":"database-monitoring","alerts":[...]}
//   - deploy event:       {"event":"failed|rolled-back|succeeded|started", ...}
//   - normalized batch:   {"alerts":[{"source","id","severity","status",...}]}
//   - single alert:       {"source","id","severity","status","message"}
//   - control events:     {"type":"ack"|"resolve","key"|"source"+"id",...}
//
// Options:
//   --file <path>     read events JSON from a file ('-' for stdin)
//   --stdin           read events JSON from stdin (default when piped)
//   --tick            run only the escalation evaluation (no new events)
//   --demo            scripted offline demo of the full state machine
//   --dry-run         compute actions but do not persist state or POST webhooks
//   --json            print only the JSON report
//   --now <iso>       override "now" (testing/demo)
//   --ack <key>       acknowledge an open incident, e.g. db-monitor:disk-usage
//   --resolve <key>   resolve an open/acked incident
//   --actor <name>    who performed --ack/--resolve
//   --webhook <url>   POST the action batch here (env: ALERT_NOTIFY_WEBHOOK_URL)
//   --state <path>    state file (env: ALERT_STATE_PATH; default: tmpdir)
//   --policies <path> policies file (default: docs/alerts/policies.json)
//   --routing <path>  routing file (default: docs/alerts/routing.json)
//   --help, -h        show this message
//
// Exit codes: 0 ok (incl. dry-run/demo), 1 at least one incident open or
// escalated after this run, 2 usage error.

/* eslint-disable no-restricted-properties --
   entrypoint script: it reads ALERT_* env overrides before any app code
   loads, so src/lib/env.ts cannot be used here. */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const DEFAULT_POLICIES = join(ROOT, "docs", "alerts", "policies.json")
const DEFAULT_ROUTING = join(ROOT, "docs", "alerts", "routing.json")

const SEVERITY_ORDER = { info: 0, warning: 1, critical: 2, error: 2 }
const DEPLOY_EVENTS = ["started", "succeeded", "failed", "rolled-back"]

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `Usage: node scripts/alerts/escalate.mjs [options]

Options:
  --file <path>       events JSON file ('-' reads stdin)
  --stdin             read events JSON from stdin
  --tick              evaluate due escalations only (cron mode)
  --demo              scripted offline demo; prints the full state machine trace
  --dry-run           compute actions; no state writes, no webhook POSTs
  --json              print only the JSON report
  --now <iso>         override current time (ISO 8601)
  --ack <key>         acknowledge an incident (e.g. db-monitor:disk-usage)
  --resolve <key>     resolve an incident
  --actor <name>      actor for --ack/--resolve (default: $USER or 'cli')
  --webhook <url>     POST action batch (env: ALERT_NOTIFY_WEBHOOK_URL)
  --state <path>      state file (env: ALERT_STATE_PATH)
  --policies <path>   escalation policies (default: docs/alerts/policies.json)
  --routing <path>    source routing (default: docs/alerts/routing.json)
  --help, -h          show this message

Exit codes: 0 ok/dry-run/demo, 1 open incidents remain, 2 usage error.`

function parseArgs(argv) {
  const options = {
    dryRun: false,
    json: false,
    tick: false,
    demo: false,
    help: false,
    file: null,
    stdin: false,
    now: null,
    ack: null,
    resolve: null,
    actor: null,
    webhook: null,
    state: null,
    policies: null,
    routing: null,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => argv[++i]
    switch (arg) {
      case "--dry-run":
        options.dryRun = true
        break
      case "--json":
        options.json = true
        break
      case "--tick":
        options.tick = true
        break
      case "--demo":
        options.demo = true
        break
      case "--file":
        options.file = next()
        break
      case "--stdin":
        options.stdin = true
        break
      case "--now":
        options.now = next()
        break
      case "--ack":
        options.ack = next()
        break
      case "--resolve":
        options.resolve = next()
        break
      case "--actor":
        options.actor = next()
        break
      case "--webhook":
        options.webhook = next()
        break
      case "--state":
        options.state = next()
        break
      case "--policies":
        options.policies = next()
        break
      case "--routing":
        options.routing = next()
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
// Config loading
// ---------------------------------------------------------------------------

function resolveConfigPath(path, fallback) {
  const candidate = path ?? fallback
  const resolved = isAbsolute(candidate) ? candidate : resolve(ROOT, candidate)
  if (!existsSync(resolved)) {
    throw new Error(`config file not found: ${resolved}`)
  }
  return resolved
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

// ---------------------------------------------------------------------------
// Input normalization -> canonical alert/control events
// ---------------------------------------------------------------------------

function normalizeSeverity(value, fallback = "warning") {
  const sev = String(value ?? fallback).toLowerCase()
  if (sev === "error") return "critical"
  if (SEVERITY_ORDER[sev] !== undefined) return sev
  return fallback
}

function controlEvent(type, key, extra = {}) {
  return { type, key, ...extra }
}

function alertEvent(source, id, fields) {
  const severity = normalizeSeverity(fields.severity ?? fields.status)
  if (severity === "info") return null // informational: no page, no incident
  return {
    type: fields.status === "resolved" ? "resolve" : "alert",
    source,
    id,
    key: `${source}:${id}`,
    severity,
    status: fields.status === "firing" || fields.status === undefined ? "firing" : fields.status,
    title: fields.title,
    message: fields.message,
    runbook: fields.runbook,
    at: fields.at,
    raw: fields.raw,
    policyHint: fields.policyHint,
  }
}

/**
 * Normalizes any supported input payload into canonical events.
 * Returns { events, skipped } — skipped counts inputs that produced nothing.
 */
function normalizeEvents(input, routing, nowIso) {
  const events = []
  let skipped = 0
  const push = (evt) => {
    if (evt) events.push({ ...evt, at: evt.at ?? nowIso })
  }

  const items = Array.isArray(input) ? input : [input]

  for (const raw of items) {
    if (!raw || typeof raw !== "object") {
      skipped++
      continue
    }

    // Explicit control events.
    if (raw.type === "ack" || raw.type === "resolve") {
      const key = raw.key ?? (raw.source && raw.id ? `${raw.source}:${raw.id}` : null)
      if (key) push(controlEvent(raw.type, key, { actor: raw.actor }))
      else skipped++
      continue
    }

    // Database-monitoring report from scripts/db/monitoring/check.mjs.
    if (raw.type === "database-monitoring" && Array.isArray(raw.alerts)) {
      for (const a of raw.alerts) {
        if (!a?.id) continue
        if (a.status === "skipped") {
          skipped++
          continue
        }
        if (a.status === "ok") {
          push(alertEvent("db-monitor", a.id, { status: "resolved", at: raw.generatedAt }))
          continue
        }
        push(
          alertEvent("db-monitor", a.id, {
            severity: a.status === "warning" ? "warning" : "critical",
            status: "firing",
            title: a.title,
            message:
              a.message ?? `${a.id} is ${a.status}${a.value != null ? ` (value=${a.value})` : ""}`,
            runbook: a.runbook,
            at: raw.generatedAt,
            raw: a,
          }),
        )
      }
      continue
    }

    // Deploy notification from scripts/deploy/notify.ts.
    if (typeof raw.event === "string" && DEPLOY_EVENTS.includes(raw.event)) {
      const env = raw.environment ?? "unknown"
      const id = env
      const sourceCfg = routing.sources?.deploy ?? {}
      const mapped = sourceCfg.events?.[raw.event]
      if (mapped === "__ignore__") {
        skipped++
        continue
      }
      if (mapped === "__resolve__") {
        push(controlEvent("resolve", `deploy:${env}`, { actor: raw.actor, at: raw.timestamp }))
        continue
      }
      if (raw.event === "failed" || raw.event === "rolled-back") {
        push(
          alertEvent("deploy", id, {
            severity: "critical",
            status: "firing",
            title: `deploy ${raw.event} on ${env}`,
            message: raw.error
              ? `deploy ${raw.event}: ${String(raw.error).slice(0, 500)}`
              : `deploy ${raw.event} on ${env}${raw.revision ? ` rev=${String(raw.revision).slice(0, 12)}` : ""}`,
            runbook: "docs/runbooks/rollback.md",
            at: raw.timestamp,
            raw,
            policyHint: typeof mapped === "string" && !mapped.startsWith("__") ? mapped : undefined,
          }),
        )
      } else {
        skipped++
      }
      continue
    }

    // Normalized batch: {"alerts": [...]} or {"source": ..., "alerts": [...]}.
    if (Array.isArray(raw.alerts)) {
      const source = raw.source ?? "generic"
      for (const a of raw.alerts) {
        if (!a?.id) {
          skipped++
          continue
        }
        push(alertEvent(source, a.id, { ...a, at: a.at ?? raw.generatedAt }))
      }
      continue
    }

    // Single normalized alert event.
    if (raw.source && raw.id) {
      push(alertEvent(raw.source, raw.id, raw))
      continue
    }

    skipped++
  }

  return { events, skipped }
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

function routeFor(source, id, severity, routing, policyHint) {
  if (policyHint) return policyHint
  const sourceCfg = routing.sources?.[source] ?? {}
  const rules = sourceCfg.rules ?? {}

  let spec = rules[id] ?? rules["*"]
  if (spec === undefined) spec = sourceCfg.defaultPolicy
  if (spec === undefined) {
    const bySeverity = routing.defaults?.policyBySeverity ?? {}
    spec = bySeverity[normalizeSeverity(severity)] ?? bySeverity.warning ?? null
  }

  // Rule spec may be a string policy name or {policy, bySeverity:{...}}.
  if (spec && typeof spec === "object") {
    spec = spec.bySeverity?.[normalizeSeverity(severity)] ?? spec.policy ?? null
  }
  return spec ?? null
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

function emptyState() {
  return { version: 1, updatedAt: null, incidents: {} }
}

function defaultStatePath() {
  return process.env.ALERT_STATE_PATH ?? join(tmpdir(), "spindle-alert-escalation-state.json")
}

function loadState(path) {
  if (!existsSync(path)) return emptyState()
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"))
    if (parsed && typeof parsed === "object" && parsed.incidents) {
      parsed.incidents = parsed.incidents ?? {}
      return { version: 1, updatedAt: parsed.updatedAt ?? null, incidents: parsed.incidents }
    }
  } catch {
    // Corrupt state: start fresh rather than crash the tick.
  }
  return emptyState()
}

function saveState(path, state) {
  state.updatedAt = new Date().toISOString()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(state, null, 2) + "\n")
}

// ---------------------------------------------------------------------------
// Escalation engine
// ---------------------------------------------------------------------------

function policyFor(policies, name) {
  const policy = policies.policies?.[name]
  if (!policy) throw new Error(`unknown policy: ${name}`)
  return policy
}

function chainFor(policy, policies) {
  const defaults = policies.defaults ?? {}
  return (policy.chain ?? []).map((level, index) => ({
    index,
    level: level.level ?? `L${index + 1}`,
    name: level.name ?? `level ${index + 1}`,
    role: level.role ?? "",
    ackTimeoutMinutes: level.ackTimeoutMinutes ?? defaults.ackTimeoutMinutes ?? 15,
    ackSlaMinutes: level.ackSlaMinutes ?? defaults.ackSlaMinutes ?? null,
    repeatIntervalMinutes:
      level.repeatIntervalMinutes ??
      (index === (policy.chain ?? []).length - 1 ? (defaults.repeatIntervalMinutes ?? null) : null),
    notify: { ...(defaults.notify ?? {}), ...(level.notify ?? {}) },
  }))
}

function historyPush(incident, event, detail = {}) {
  incident.history.push({ at: detail.at ?? new Date().toISOString(), event, ...detail })
}

function incidentSummary(incident, policy) {
  return {
    key: incident.key,
    title: incident.title,
    source: incident.source,
    severity: incident.severity,
    status: incident.status,
    policy: incident.policy,
    policyTitle: policy?.title ?? incident.policy,
    level: incident.level,
    levelName: incident.levelName,
    levelRole: incident.levelRole,
    ackSlaMinutes: incident.ackSlaMinutes,
    ackTimeoutMinutes: incident.ackTimeoutMinutes,
    triggeredAt: incident.createdAt,
    levelNotifiedAt: incident.levelNotifiedAt,
    ackedAt: incident.ackedAt ?? null,
    ackedBy: incident.ackedBy ?? null,
    resolvedAt: incident.resolvedAt ?? null,
    message: incident.message,
    runbook: incident.runbook ?? null,
    url: incident.url ?? null,
  }
}

function notifyAction(incident, level, kind, nowIso) {
  return {
    type: kind, // "notify" | "escalate" | "repeat"
    incident: incidentSummary(incident, null),
    level: level.level,
    levelName: level.name,
    role: level.role,
    ackTimeoutMinutes: level.ackTimeoutMinutes,
    ackSlaMinutes: level.ackSlaMinutes ?? level.ackTimeoutMinutes,
    notify: level.notify,
    at: nowIso,
  }
}

function applyLevel(incident, chain, index, nowMs, nowIso, actions, kind) {
  const level = chain[index]
  incident.level = index + 1
  incident.levelName = level.name
  incident.levelRole = level.role
  incident.levelNotifiedAt = new Date(nowMs).toISOString()
  incident.ackTimeoutMinutes = level.ackTimeoutMinutes
  incident.ackSlaMinutes = level.ackSlaMinutes ?? level.ackTimeoutMinutes
  historyPush(incident, kind === "notify" ? "notify" : kind, {
    level: level.level,
    at: nowIso,
  })
  actions.push(notifyAction(incident, level, kind, nowIso))
}

/** Ingest canonical events into state; returns actions produced. */
function ingestEvent(state, event, ctx, actions) {
  const { policies, routing, nowIso } = ctx

  if (event.type === "ack") {
    const inc = state.incidents[event.key]
    if (!inc || inc.status === "resolved") {
      actions.push({
        type: "ack-miss",
        key: event.key,
        reason: inc ? "already resolved" : "unknown incident",
        at: nowIso,
      })
      return
    }
    inc.ackedAt = nowIso
    inc.ackedBy = event.actor ?? null
    if (inc.status === "open") inc.status = "acked"
    historyPush(inc, "ack", { actor: inc.ackedBy, level: inc.level, at: nowIso })
    actions.push({
      type: "ack",
      incident: incidentSummary(inc, policies.policies?.[inc.policy]),
      at: nowIso,
    })
    return
  }

  if (event.type === "resolve") {
    const inc = state.incidents[event.key]
    if (!inc) {
      actions.push({ type: "resolve-miss", key: event.key, reason: "unknown incident", at: nowIso })
      return
    }
    const wasOpen = inc.status !== "resolved"
    inc.status = "resolved"
    inc.resolvedAt = nowIso
    historyPush(inc, "resolve", { actor: event.actor ?? null, at: nowIso })
    if (wasOpen) {
      actions.push({
        type: "resolve",
        incident: incidentSummary(inc, policies.policies?.[inc.policy]),
        at: nowIso,
      })
    }
    return
  }

  // alert event
  const policyName = routeFor(event.source, event.id, event.severity, routing, event.policyHint)
  if (!policyName) {
    actions.push({ type: "unrouted", event, at: nowIso })
    return
  }
  const policy = policyFor(policies, policyName)
  const chain = chainFor(policy, policies)
  if (chain.length === 0) {
    actions.push({
      type: "unrouted",
      event,
      reason: `policy ${policyName} has no chain`,
      at: nowIso,
    })
    return
  }

  const existing = state.incidents[event.key]
  if (!existing) {
    const inc = {
      key: event.key,
      source: event.source,
      id: event.id,
      title: event.title ?? `${event.source}:${event.id}`,
      severity: event.severity,
      policy: policyName,
      message: event.message ?? null,
      runbook: event.runbook ?? null,
      status: "open",
      createdAt: nowIso,
      resolvedAt: null,
      ackedAt: null,
      ackedBy: null,
      level: 0,
      levelName: null,
      levelRole: null,
      levelNotifiedAt: null,
      lastRepeatAt: null,
      history: [],
    }
    state.incidents[event.key] = inc
    historyPush(inc, "trigger", { severity: event.severity, at: nowIso })
    actions.push({
      type: "trigger",
      incident: incidentSummary(inc, policy),
      at: nowIso,
    })
    // L1 is notified immediately by evaluateEscalations below.
    return
  }

  // Existing incident: refresh details; reopen if it was resolved.
  existing.severity = event.severity
  existing.message = event.message ?? existing.message
  existing.title = event.title ?? existing.title
  existing.runbook = event.runbook ?? existing.runbook
  if (existing.status === "resolved") {
    existing.status = "open"
    existing.resolvedAt = null
    existing.ackedAt = null
    existing.ackedBy = null
    existing.level = 0
    existing.levelNotifiedAt = null
    existing.lastRepeatAt = null
    historyPush(existing, "retrigger", { at: nowIso })
    actions.push({ type: "retrigger", incident: incidentSummary(existing, policy), at: nowIso })
  } else {
    historyPush(existing, "update", { at: nowIso })
  }
}

/** Fire due notifications/escalations for all open incidents. */
function evaluateEscalations(state, ctx, actions) {
  const { policies, nowMs, nowIso } = ctx

  for (const inc of Object.values(state.incidents)) {
    if (inc.status !== "open") continue

    const policy = policies.policies?.[inc.policy]
    if (!policy) continue
    const chain = chainFor(policy, policies)
    if (chain.length === 0) continue

    // Freshly triggered incident: notify L1 immediately.
    if (inc.level === 0) {
      applyLevel(inc, chain, 0, nowMs, nowIso, actions, "notify")
      continue
    }

    const currentIndex = inc.level - 1
    const current = chain[currentIndex]
    if (!current) continue

    const notifiedMs = Date.parse(inc.levelNotifiedAt)
    const elapsedMin = (nowMs - notifiedMs) / 60_000

    // Still inside this level's ack window: nothing due.
    if (elapsedMin < current.ackTimeoutMinutes) continue

    const isLast = currentIndex === chain.length - 1

    if (!isLast) {
      applyLevel(inc, chain, currentIndex + 1, nowMs, nowIso, actions, "escalate")
      continue
    }

    // Final level reached and its ack window elapsed.
    if (!inc.exhaustedNotified) {
      inc.exhaustedNotified = true
      historyPush(inc, "exhausted", { at: nowIso })
      actions.push({
        type: "exhausted",
        incident: incidentSummary(inc, policy),
        at: nowIso,
      })
    }

    // Repeat notifications on the configured interval (null = stay silent).
    const repeatMin = current.repeatIntervalMinutes
    if (repeatMin != null) {
      const refMs = inc.lastRepeatAt ? Date.parse(inc.lastRepeatAt) : notifiedMs
      if ((nowMs - refMs) / 60_000 >= repeatMin) {
        inc.lastRepeatAt = nowIso
        actions.push(notifyAction(inc, current, "repeat", nowIso))
        historyPush(inc, "repeat", { level: current.level, at: nowIso })
      }
      continue
    }

    if (inc.status === "open") {
      inc.status = "exhausted"
    }
  }
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

async function postWebhook(url, payload, token) {
  const headers = { "Content-Type": "application/json" }
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    // eslint-disable-next-line no-undef -- AbortSignal.timeout is Node 17.3+
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(`webhook POST failed: ${response.status} ${detail.slice(0, 300)}`)
  }
}

async function deliver(actions, options) {
  const webhookUrl = options.webhook ?? process.env.ALERT_NOTIFY_WEBHOOK_URL
  const token = process.env.ALERT_NOTIFY_WEBHOOK_TOKEN
  const deliveries = []

  // Only page-worthy actions go to the webhook; bookkeeping stays local.
  const outbound = actions.filter((a) =>
    ["trigger", "notify", "escalate", "repeat", "resolve", "exhausted"].includes(a.type),
  )

  if (webhookUrl && outbound.length > 0) {
    try {
      await postWebhook(
        webhookUrl,
        { type: "alert-escalation", generatedAt: new Date().toISOString(), actions: outbound },
        token,
      )
      deliveries.push({ channel: "webhook", status: "sent", count: outbound.length })
    } catch (error) {
      deliveries.push({
        channel: "webhook",
        status: "failed",
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  } else {
    deliveries.push({ channel: "webhook", status: "skipped", detail: "no webhook configured" })
  }

  return deliveries
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function severityRank(sev) {
  return SEVERITY_ORDER[sev] ?? 1
}

function printText(report) {
  for (const action of report.actions) {
    const inc = action.incident
    switch (action.type) {
      case "trigger":
        console.log(
          `[escalate] TRIGGER ${inc.key} severity=${inc.severity} policy=${inc.policy} — ${inc.title}`,
        )
        break
      case "retrigger":
        console.log(`[escalate] RETRIGGER ${inc.key} (was resolved) — ${inc.title}`)
        break
      case "notify":
      case "escalate":
      case "repeat": {
        const verb = action.type === "notify" ? "NOTIFY" : action.type.toUpperCase()
        console.log(
          `[escalate] ${verb} ${inc.key} -> ${action.level} ${action.levelName} (${action.role}) ackSLA=${action.ackSlaMinutes ?? "-"}m ackTimeout=${action.ackTimeoutMinutes}m`,
        )
        break
      }
      case "ack":
        console.log(
          `[escalate] ACK ${inc.key} by ${inc.ackedBy ?? "unknown"} at level ${inc.level}`,
        )
        break
      case "resolve":
        console.log(`[escalate] RESOLVE ${inc.key}`)
        break
      case "exhausted":
        console.log(`[escalate] EXHAUSTED ${inc.key} — chain complete, still unacked`)
        break
      case "unrouted":
        console.log(`[escalate] UNROUTED ${action.event?.key ?? JSON.stringify(action.event)}`)
        break
      case "ack-miss":
      case "resolve-miss":
        console.log(
          `[escalate] ${action.type === "ack-miss" ? "ACK" : "RESOLVE"}-MISS ${action.key} (${action.reason})`,
        )
        break
      default:
        console.log(`[escalate] ${action.type} ${action.key ?? ""}`)
    }
  }
  const open = report.openIncidents
  if (open.length > 0) {
    console.log(`[escalate] ${open.length} open incident(s):`)
    for (const inc of open) {
      console.log(
        `  ${inc.key} level=${inc.level}/${inc.levelName ?? "?"} status=${inc.status} policy=${inc.policy} severity=${inc.severity}`,
      )
    }
  }
  console.log(
    `[escalate] summary: incidents=${report.incidentCount} actions=${report.actions.length} open=${open.length}`,
  )
}

// ---------------------------------------------------------------------------
// Demo
// ---------------------------------------------------------------------------

function runDemo(ctx, { trace = true } = {}) {
  const { routing } = ctx
  const t0 = Date.parse("2025-01-01T00:00:00.000Z")
  const at = (minutes) => new Date(t0 + minutes * 60_000).toISOString()
  // With --json the trace goes to stderr so stdout stays a pure JSON report.
  const log = trace
    ? (msg) => console.log(`[demo] ${msg}`)
    : (msg) => console.error(`[demo] ${msg}`)

  log("scenario: db-monitor critical + deploy failure, one acked, one left unacked")
  log("")

  // In-memory state; demo never persists unless --state was explicitly given
  // and --dry-run was not passed — but we always run demo in dry-run mode.
  const state = emptyState()
  const demoNow = { ms: t0 }
  const allActions = []

  const step = (label, minutes, fn) => {
    demoNow.ms = t0 + minutes * 60_000
    const nowIso = new Date(demoNow.ms).toISOString()
    log(`--- ${label} @ ${nowIso}`)
    const localCtx = { ...ctx, nowMs: demoNow.ms, nowIso }
    const actions = []
    fn(actions, localCtx)
    allActions.push(...actions)
    for (const a of actions) printDemoAction(a)
    if (actions.length === 0) log("  (no actions)")
  }

  const printDemoAction = (a) => {
    const inc = a.incident
    switch (a.type) {
      case "trigger":
        log(`  TRIGGER ${inc.key} [${inc.severity}] policy=${inc.policy} — ${inc.title}`)
        break
      case "notify":
      case "escalate":
      case "repeat":
        log(`  ${a.type.toUpperCase()} -> ${a.level} ${a.levelName} (${a.role})`)
        break
      case "ack":
        log(`  ACK ${inc.key} by ${inc.ackedBy ?? "?"}`)
        break
      case "resolve":
        log(`  RESOLVE ${inc.key}`)
        break
      case "exhausted":
        log(`  EXHAUSTED ${inc.key}`)
        break
      case "ack-miss":
      case "resolve-miss":
        log(`  ${a.type} ${a.key} (${a.reason})`)
        break
      default:
        log(`  ${a.type} ${inc?.key ?? a.key ?? ""}`)
    }
  }

  const dbReport = {
    type: "database-monitoring",
    generatedAt: at(0),
    alerts: [
      {
        id: "connection-pool-saturation",
        title: "Connection pool saturation",
        status: "critical",
        severity: "critical",
        value: 0.93,
        message: "93.0% (warn 75.0%, critical 90.0%)",
        runbook: "database-monitoring.md#connection-pool-saturation",
      },
      {
        id: "idle-in-transaction-sessions",
        title: "Idle in transaction sessions",
        status: "warning",
        severity: "warning",
        value: 8,
        message: "8 (warn 5, critical 20)",
        runbook: "database-monitoring.md#idle-in-transaction-sessions",
      },
    ],
  }

  const deployFailed = {
    event: "failed",
    environment: "production",
    revision: "abc123def456",
    error: "migrate step exited 1",
    timestamp: at(0),
  }

  step("t+0 ingest monitor report + deploy failure", 0, (actions, c) => {
    const { events } = normalizeEvents([dbReport, deployFailed], routing, at(0))
    for (const e of events) ingestEvent(state, e, c, actions)
    evaluateEscalations(state, c, actions)
  })

  step("t+5min periodic tick (inside ack windows)", 5, (actions, c) => {
    evaluateEscalations(state, c, actions)
  })

  step("t+11min L1 deploy-critical times out -> L2", 11, (actions, c) => {
    evaluateEscalations(state, c, actions)
  })

  step("t+16min ack deploy incident + db-critical L1 timeout -> L2", 16, (actions, c) => {
    ingestEvent(
      state,
      controlEvent("ack", "deploy:production", { actor: "oncall-bogdan" }),
      c,
      actions,
    )
    evaluateEscalations(state, c, actions)
  })

  step("t+31min db-critical L2 timeout -> L3", 31, (actions, c) => {
    evaluateEscalations(state, c, actions)
  })

  step("t+62min db-critical L3 ack window elapses -> exhausted", 62, (actions, c) => {
    evaluateEscalations(state, c, actions)
  })

  step("t+90min deploy 'succeeded' resolves the deploy incident", 90, (actions, c) => {
    ingestEvent(state, controlEvent("resolve", "deploy:production", { actor: "ci" }), c, actions)
    const { events } = normalizeEvents(
      { event: "succeeded", environment: "production", timestamp: at(90) },
      routing,
      at(90),
    )
    for (const e of events) ingestEvent(state, e, c, actions)
    evaluateEscalations(state, c, actions)
  })

  // L3 was notified at t+31; repeatIntervalMinutes=60 is measured from that
  // notification, so the first repeat is due at t+91.
  step("t+95min db-critical L3 repeat interval (60m) fires", 95, (actions, c) => {
    evaluateEscalations(state, c, actions)
  })

  step(
    "t+200min db-warning reached L3 unacked; monitor 'ok' resolves both db incidents",
    200,
    (actions, c) => {
      const okReport = {
        type: "database-monitoring",
        generatedAt: at(200),
        alerts: [
          { id: "idle-in-transaction-sessions", status: "ok" },
          { id: "connection-pool-saturation", status: "ok" },
        ],
      }
      const { events } = normalizeEvents(okReport, routing, at(200))
      for (const e of events) ingestEvent(state, e, c, actions)
      evaluateEscalations(state, c, actions)
    },
  )

  log("")
  log(`final state: ${Object.keys(state.incidents).length} incident(s) tracked`)
  for (const inc of Object.values(state.incidents)) {
    log(`  ${inc.key}: status=${inc.status} level=${inc.level} policy=${inc.policy}`)
  }
  log("demo complete (dry-run: no state written, no webhooks sent)")

  return {
    demo: true,
    dryRun: true,
    incidentCount: Object.keys(state.incidents).length,
    actions: allActions,
    deliveries: [{ channel: "demo", status: "dry-run" }],
    policies: ctx.policies,
    routing,
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function readStdin() {
  let data = ""
  for await (const chunk of process.stdin) data += chunk
  return data
}

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

  let policies
  let routing
  try {
    policies = loadJson(resolveConfigPath(options.policies, DEFAULT_POLICIES))
    routing = loadJson(resolveConfigPath(options.routing, DEFAULT_ROUTING))
  } catch (error) {
    console.error(`[escalate] ${error instanceof Error ? error.message : error}`)
    return 2
  }

  const nowMs = options.now ? Date.parse(options.now) : Date.now()
  if (Number.isNaN(nowMs)) {
    console.error(`[escalate] invalid --now value: ${options.now}`)
    return 2
  }
  const nowIso = new Date(nowMs).toISOString()

  const statePath = resolve(options.state ?? defaultStatePath())
  const state = options.demo ? emptyState() : loadState(statePath)

  const ctx = { policies, routing, nowMs, nowIso }
  const actions = []

  if (options.demo) {
    const report = runDemo(ctx, { trace: !options.json })
    if (options.json) console.log(JSON.stringify(report, null, 2))
    return 0
  }

  // --- ingest events ---
  let input
  const wantsInput = !options.tick && (options.file || options.stdin || !process.stdin.isTTY)
  if (wantsInput) {
    let raw
    if (options.file && options.file !== "-") {
      const path = isAbsolute(options.file) ? options.file : resolve(ROOT, options.file)
      if (!existsSync(path)) {
        console.error(`[escalate] input file not found: ${path}`)
        return 2
      }
      raw = readFileSync(path, "utf8")
    } else {
      raw = await readStdin()
    }
    if (raw.trim() === "") {
      console.error("[escalate] empty input; use --tick for escalation-only runs")
      return 2
    }
    try {
      input = JSON.parse(raw)
    } catch (error) {
      console.error(`[escalate] invalid JSON input: ${error.message}`)
      return 2
    }
    const { events, skipped } = normalizeEvents(input, routing, nowIso)
    if (skipped > 0) {
      actions.push({ type: "skipped-inputs", count: skipped, at: nowIso })
    }
    for (const event of events) {
      ingestEvent(state, event, ctx, actions)
    }
  }

  // --- direct ack/resolve flags ---
  const actor = options.actor ?? process.env.USER ?? "cli"
  if (options.ack) {
    ingestEvent(state, controlEvent("ack", options.ack, { actor }), ctx, actions)
  }
  if (options.resolve) {
    ingestEvent(state, controlEvent("resolve", options.resolve, { actor }), ctx, actions)
  }

  // --- evaluate due escalations ---
  evaluateEscalations(state, ctx, actions)

  // --- deliver ---
  const deliveries = options.dryRun
    ? [{ channel: "webhook", status: "dry-run", detail: "state and webhooks untouched" }]
    : await deliver(actions, { webhook: options.webhook })

  // --- persist ---
  if (!options.dryRun) {
    saveState(statePath, state)
  }

  const openIncidents = Object.values(state.incidents)
    .filter((i) => i.status === "open" || i.status === "exhausted" || i.status === "acked")
    .map((inc) => incidentSummary(inc, policies.policies?.[inc.policy]))
    .sort(
      (a, b) => severityRank(b.severity) - severityRank(a.severity) || a.key.localeCompare(b.key),
    )

  const report = {
    type: "alert-escalation-report",
    generatedAt: nowIso,
    dryRun: options.dryRun,
    statePath: options.dryRun ? null : statePath,
    incidentCount: Object.keys(state.incidents).length,
    openIncidents,
    actions,
    deliveries,
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    printText(report)
    for (const d of deliveries) {
      console.log(
        `[escalate] delivery ${d.channel}: ${d.status}${d.detail ? ` (${d.detail})` : ""}`,
      )
    }
  }

  const hasOpen = openIncidents.length > 0
  return hasOpen && !options.dryRun ? 1 : 0
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`[escalate] unexpected error: ${error?.stack ?? error}`)
    process.exit(2)
  })
