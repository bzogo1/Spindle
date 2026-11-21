#!/usr/bin/env node
// Certificate expiry checker for the public hostnames behind the
// Cloudflare Tunnel.
//
// Live mode (default): reads the host list from
// infra/certificates/expiry-check.json, opens a TLS connection to each
// host:port with node:tls, reads the peer certificate's validity window
// and trust status, and evaluates it against per-host or default
// warnDays/criticalDays thresholds. No dependencies; uses only node:tls
// and node:crypto (X509Certificate).
//
// Offline mode (--demo): runs the same evaluation engine over canned
// fixtures (healthy, inside warn window, inside critical window, expired,
// unreachable, untrusted chain) and verifies each produces the expected
// verdict. No network access needed.
//
// Usage:
//   node scripts/certificates/expiry-check.mjs
//   node scripts/certificates/expiry-check.mjs --config infra/certificates/expiry-check.json
//   node scripts/certificates/expiry-check.mjs --host app.spindle.app --port 443
//   node scripts/certificates/expiry-check.mjs --json
//   node scripts/certificates/expiry-check.mjs --demo
//   node scripts/certificates/expiry-check.mjs --help
//
// Exit codes: 0 = every host ok (warnings allowed), 1 = at least one host
// in the warn window, 2 = at least one host critical/expired/unreachable,
// 64 = usage/config error.

import tls from "node:tls"
import { X509Certificate } from "node:crypto"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, "..", "..")
const DEFAULT_CONFIG = resolve(REPO_ROOT, "infra/certificates/expiry-check.json")

const USAGE = `Usage:
  expiry-check.mjs [options]

Options:
  --config <path>       Host-list config JSON (default infra/certificates/expiry-check.json).
  --host <hostname>     Check a single ad-hoc host instead of the config list.
  --port <port>         Port for --host (default 443).
  --warn-days <n>       Warn when expiry is within n days (default from config, 21).
  --critical-days <n>   Critical when expiry is within n days (default from config, 7).
  --timeout <ms>        Per-connection timeout (default from config, 10000).
  --json                Emit machine-readable JSON instead of text.
  --demo                Run the offline fixture self-test (no network).
  --help, -h            Show this text.

Exit codes: 0 ok, 1 warning, 2 critical/unreachable, 64 usage error.`

const DEFAULTS = {
  port: 443,
  warnDays: 21,
  criticalDays: 7,
  timeoutMs: 10_000,
}

function parseArgs(argv) {
  const args = {
    config: DEFAULT_CONFIG,
    host: null,
    port: null,
    warnDays: null,
    criticalDays: null,
    timeoutMs: null,
    json: false,
    demo: false,
    help: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => {
      i += 1
      if (i >= argv.length) throw new Error(`Missing value for ${arg}`)
      return argv[i]
    }

    switch (arg) {
      case "--config":
        args.config = resolve(next())
        break
      case "--host":
        args.host = next()
        break
      case "--port":
        args.port = Number(next())
        break
      case "--warn-days":
        args.warnDays = Number(next())
        break
      case "--critical-days":
        args.criticalDays = Number(next())
        break
      case "--timeout":
        args.timeoutMs = Number(next())
        break
      case "--json":
        args.json = true
        break
      case "--demo":
        args.demo = true
        break
      case "--help":
      case "-h":
        args.help = true
        break
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!args.demo && !args.help && !args.host) {
    // Config-driven mode is the default; --config is validated at load time.
  }
  return args
}

// Load and normalize the host list. Per-host warnDays/criticalDays/port
// override the config defaults; CLI overrides win over everything.
function loadTargets(args) {
  let config

  if (args.host) {
    config = {
      defaults: {
        warnDays: args.warnDays ?? DEFAULTS.warnDays,
        criticalDays: args.criticalDays ?? DEFAULTS.criticalDays,
        timeoutMs: args.timeoutMs ?? DEFAULTS.timeoutMs,
      },
      hosts: [
        {
          name: args.host,
          host: args.host,
          port: args.port ?? DEFAULTS.port,
        },
      ],
    }
  } else {
    let raw
    try {
      raw = JSON.parse(readFileSync(args.config, "utf8"))
    } catch (err) {
      throw new Error(`cannot read config ${args.config}: ${err.message}`, { cause: err })
    }
    config = {
      defaults: { ...DEFAULTS, ...(raw.defaults ?? {}) },
      hosts: raw.hosts ?? [],
    }
  }

  const defaults = config.defaults
  const warnOverride = args.warnDays ?? null
  const critOverride = args.criticalDays ?? null
  const timeoutOverride = args.timeoutMs ?? null

  const targets = config.hosts.map((h) => ({
    name: h.name ?? h.host,
    host: h.host,
    port: h.port ?? args.port ?? defaults.port ?? DEFAULTS.port,
    warnDays: warnOverride ?? h.warnDays ?? defaults.warnDays ?? DEFAULTS.warnDays,
    criticalDays: critOverride ?? h.criticalDays ?? defaults.criticalDays ?? DEFAULTS.criticalDays,
    timeoutMs: timeoutOverride ?? h.timeoutMs ?? defaults.timeoutMs ?? DEFAULTS.timeoutMs,
  }))

  for (const t of targets) {
    if (!t.host) throw new Error(`host entry missing "host": ${JSON.stringify(t)}`)
    if (!(t.warnDays > t.criticalDays)) {
      throw new Error(
        `host ${t.name}: warnDays (${t.warnDays}) must be greater than criticalDays (${t.criticalDays})`,
      )
    }
  }
  return targets
}

// Node surfaces multi-address connect failures as AggregateError with an
// empty .message; fall back to the code so the report stays readable.
function errText(err) {
  if (!err) return "unknown error"
  if (err.message) return String(err.message)
  if (err.code) return String(err.code)
  return String(err)
}

// Open one TLS connection and capture the peer certificate plus trust
// status. rejectUnauthorized stays false so an untrusted chain still
// yields certificate data; socket.authorized/authorizationError record the
// verification result as a finding instead of hiding it.
function probe(host, port, timeoutMs) {
  return new Promise((resolve) => {
    let socket
    try {
      socket = tls.connect({
        host,
        port,
        servername: host,
        rejectUnauthorized: false,
      })
    } catch (err) {
      resolve({ ok: false, error: errText(err) })
      return
    }

    const timer = setTimeout(() => {
      socket.destroy()
      resolve({ ok: false, error: `handshake timed out after ${timeoutMs}ms` })
    }, timeoutMs)

    socket.once("secureConnect", () => {
      clearTimeout(timer)
      try {
        const peer = socket.getPeerCertificate(true)
        const x509 = new X509Certificate(peer.raw)
        resolve({
          ok: true,
          authorized: socket.authorized === true,
          authorizationError: socket.authorized
            ? null
            : String(socket.authorizationError ?? "certificate not trusted"),
          protocol: socket.getProtocol(),
          cert: {
            subject: x509.subject,
            issuer: x509.issuer,
            subjectAltName: x509.subjectAltName,
            validFrom: x509.validFrom,
            validTo: x509.validTo,
            fingerprint256: x509.fingerprint256,
          },
        })
      } catch (err) {
        resolve({ ok: false, error: `could not parse peer certificate: ${errText(err)}` })
      } finally {
        socket.end()
      }
    })

    socket.once("error", (err) => {
      clearTimeout(timer)
      resolve({ ok: false, error: errText(err) })
      socket.destroy()
    })
  })
}

// Pure evaluation: observation is a live probe result or a demo fixture.
// Returns { status, daysLeft, checks } where status is ok | warn | critical.
function evaluate(observation, thresholds, now = new Date()) {
  const { warnDays, criticalDays } = thresholds
  const checks = []

  if (!observation.ok) {
    checks.push({
      id: "cert.reachable",
      status: "critical",
      detail: observation.error ?? "TLS handshake failed",
    })
    return { status: "critical", daysLeft: null, checks }
  }

  // Trust: the handshake succeeded but the chain failed verification.
  checks.push(
    observation.authorized === false
      ? {
          id: "cert.trust",
          status: "critical",
          detail: `certificate chain not trusted: ${observation.authorizationError}`,
        }
      : {
          id: "cert.trust",
          status: "pass",
          detail: `chain trusted (${observation.protocol ?? "TLS"})`,
        },
  )

  // Validity window.
  const validFrom = new Date(observation.cert.validFrom)
  const validTo = new Date(observation.cert.validTo)
  const daysLeft = (validTo.getTime() - now.getTime()) / 86_400_000

  if (Number.isNaN(validFrom.getTime()) || Number.isNaN(validTo.getTime())) {
    checks.push({
      id: "cert.expiry",
      status: "critical",
      detail: `unparseable validity window: ${observation.cert.validFrom} → ${observation.cert.validTo}`,
    })
  } else if (now < validFrom) {
    checks.push({
      id: "cert.expiry",
      status: "critical",
      detail: `certificate not yet valid (valid from ${observation.cert.validFrom})`,
    })
  } else if (now > validTo) {
    checks.push({
      id: "cert.expiry",
      status: "critical",
      detail: `certificate expired on ${observation.cert.validTo}`,
    })
  } else if (daysLeft <= criticalDays) {
    checks.push({
      id: "cert.expiry",
      status: "critical",
      detail: `expires in ${Math.floor(daysLeft)} day(s) (${observation.cert.validTo}); critical threshold ${criticalDays}d`,
    })
  } else if (daysLeft <= warnDays) {
    checks.push({
      id: "cert.expiry",
      status: "warn",
      detail: `expires in ${Math.floor(daysLeft)} day(s) (${observation.cert.validTo}); warn threshold ${warnDays}d`,
    })
  } else {
    checks.push({
      id: "cert.expiry",
      status: "pass",
      detail: `valid until ${observation.cert.validTo} (${Math.floor(daysLeft)} days left)`,
    })
  }

  const status = checks.some((c) => c.status === "critical")
    ? "critical"
    : checks.some((c) => c.status === "warn")
      ? "warn"
      : "ok"
  return { status, daysLeft: Number.isNaN(daysLeft) ? null : Math.floor(daysLeft), checks }
}

function daysFromNow(days) {
  return new Date(Date.now() + days * 86_400_000).toUTCString()
}

function daysAgo(days) {
  return new Date(Date.now() - days * 86_400_000).toUTCString()
}

function certFixture(subject, validFrom, validTo) {
  return {
    subject,
    issuer: "C=US, O=Google Trust Services, CN=WE1",
    subjectAltName: `DNS:${subject.replace(/^CN=/, "")}`,
    validFrom,
    validTo,
    fingerprint256: "AA:BB:CC",
  }
}

// Canned observations for --demo. Each fixture states the expected overall
// status so the self-test proves the threshold logic end to end.
function demoFixtures() {
  return [
    {
      name: "healthy Universal SSL cert, 80 days left",
      target: {
        name: "demo-ok",
        host: "app.spindle.app",
        port: 443,
        warnDays: 21,
        criticalDays: 7,
      },
      observation: {
        ok: true,
        authorized: true,
        protocol: "TLSv1.3",
        cert: certFixture("CN=app.spindle.app", daysAgo(10), daysFromNow(80)),
      },
      expected: "ok",
    },
    {
      name: "expires in 14 days (inside warn window, above critical)",
      target: {
        name: "demo-warn",
        host: "app.spindle.app",
        port: 443,
        warnDays: 21,
        criticalDays: 7,
      },
      observation: {
        ok: true,
        authorized: true,
        protocol: "TLSv1.3",
        cert: certFixture("CN=app.spindle.app", daysAgo(76), daysFromNow(14)),
      },
      expected: "warn",
    },
    {
      name: "expires in 3 days (inside critical window)",
      target: {
        name: "demo-critical",
        host: "app.spindle.app",
        port: 443,
        warnDays: 21,
        criticalDays: 7,
      },
      observation: {
        ok: true,
        authorized: true,
        protocol: "TLSv1.3",
        cert: certFixture("CN=app.spindle.app", daysAgo(87), daysFromNow(3)),
      },
      expected: "critical",
    },
    {
      name: "expired certificate",
      target: {
        name: "demo-expired",
        host: "app.spindle.app",
        port: 443,
        warnDays: 21,
        criticalDays: 7,
      },
      observation: {
        ok: true,
        authorized: true,
        protocol: "TLSv1.3",
        cert: certFixture("CN=app.spindle.app", daysAgo(100), daysAgo(1)),
      },
      expected: "critical",
    },
    {
      name: "untrusted chain (self-signed origin cert)",
      target: {
        name: "demo-untrusted",
        host: "app.spindle.app",
        port: 443,
        warnDays: 21,
        criticalDays: 7,
      },
      observation: {
        ok: true,
        authorized: false,
        authorizationError: "self-signed certificate",
        protocol: "TLSv1.3",
        cert: certFixture("CN=app.spindle.app", daysAgo(10), daysFromNow(80)),
      },
      expected: "critical",
    },
    {
      name: "unreachable host (connection refused)",
      target: {
        name: "demo-down",
        host: "app.spindle.app",
        port: 443,
        warnDays: 21,
        criticalDays: 7,
      },
      observation: { ok: false, error: "connect ECONNREFUSED 1.2.3.4:443" },
      expected: "critical",
    },
  ]
}

async function runDemo(json) {
  const now = new Date()
  const fixtures = demoFixtures()
  const results = []
  let mismatches = 0

  for (const fixture of fixtures) {
    const { status, daysLeft, checks } = evaluate(fixture.observation, fixture.target, now)
    const ok = status === fixture.expected
    if (!ok) mismatches += 1
    results.push({
      name: fixture.name,
      target: `${fixture.target.name} (${fixture.target.host}:${fixture.target.port})`,
      expected: fixture.expected,
      actual: status,
      daysLeft,
      ok,
      checks,
    })
  }

  if (json) {
    console.log(JSON.stringify({ mode: "demo", fixtures: results }, null, 2))
  } else {
    console.log(`Certificate expiry self-test — ${fixtures.length} canned observations\n`)
    for (const r of results) {
      const mark = r.ok ? "PASS" : "MISMATCH"
      console.log(
        `${mark}  expected=${r.expected.padEnd(8)} actual=${r.actual.padEnd(8)}  ${r.name}`,
      )
      console.log(`      target: ${r.target}`)
      for (const c of r.checks) {
        console.log(`      ${c.status.toUpperCase().padEnd(8)} ${c.id}: ${c.detail}`)
      }
    }
    console.log(
      mismatches === 0
        ? "\nSelf-test passed: every fixture produced its expected verdict."
        : `\nSelf-test FAILED: ${mismatches} fixture(s) produced unexpected verdicts.`,
    )
  }
  return mismatches === 0 ? 0 : 1
}

const STATUS_RANK = { ok: 0, warn: 1, critical: 2 }

function worstStatus(statuses) {
  return statuses.reduce((worst, s) => (STATUS_RANK[s] > STATUS_RANK[worst] ? s : worst), "ok")
}

async function runLive(args) {
  const targets = loadTargets(args)
  const results = []

  for (const target of targets) {
    const observation = await probe(target.host, target.port, target.timeoutMs)
    const { status, daysLeft, checks } = evaluate(observation, target)
    results.push({
      name: target.name,
      host: target.host,
      port: target.port,
      thresholds: { warnDays: target.warnDays, criticalDays: target.criticalDays },
      status,
      daysLeft,
      checks,
      cert: observation.ok ? observation.cert : null,
      error: observation.ok ? null : observation.error,
    })
  }

  const overall = worstStatus(results.map((r) => r.status))
  const exitCode = overall === "critical" ? 2 : overall === "warn" ? 1 : 0

  if (args.json) {
    console.log(JSON.stringify({ mode: "live", overall, results }, null, 2))
  } else {
    console.log(
      `Certificate expiry check — ${results.length} host(s) ` +
        `(warn <=${targets[0]?.warnDays ?? DEFAULTS.warnDays}d, ` +
        `critical <=${targets[0]?.criticalDays ?? DEFAULTS.criticalDays}d thresholds)\n`,
    )
    for (const r of results) {
      console.log(`[${r.status.toUpperCase()}] ${r.name} — ${r.host}:${r.port}`)
      for (const c of r.checks) {
        console.log(`    ${c.status.toUpperCase().padEnd(8)} ${c.id}: ${c.detail}`)
      }
      if (r.cert) {
        console.log(`    cert subject: ${r.cert.subject}`)
        console.log(`    cert issuer:  ${r.cert.issuer}`)
        console.log(`    SAN:           ${r.cert.subjectAltName}`)
        console.log(`    fingerprint:   ${r.cert.fingerprint256}`)
      }
      console.log("")
    }
    console.log(`Overall: ${overall.toUpperCase()}`)
  }

  return exitCode
}

async function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(`error: ${err.message}\n\n${USAGE}`)
    return 64
  }
  if (args.help) {
    console.log(USAGE)
    return 0
  }
  if (args.demo) {
    try {
      return await runDemo(args.json)
    } catch (err) {
      console.error(`error: demo failed: ${err.message}`)
      return 64
    }
  }
  try {
    return await runLive(args)
  } catch (err) {
    console.error(`error: ${err.message}`)
    return 64
  }
}

main().then((code) => process.exit(code))
