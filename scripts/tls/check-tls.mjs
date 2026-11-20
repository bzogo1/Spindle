#!/usr/bin/env node
// TLS posture checker for public hostnames.
//
// Live mode (--host): opens real TLS connections with node:tls, reads the
// peer certificate and negotiated protocol/cipher, then evaluates them
// against a policy (minimum TLS version, certificate validity window,
// cipher strength). Also probes whether the server still accepts TLS 1.0
// as a downgrade floor.
//
// Offline mode (--demo / --self-test): runs the same evaluation engine over
// canned observations (healthy, expired cert, TLS 1.0, weak cipher,
// soon-to-expire cert) and verifies each produces the expected verdict.
// No network access is needed; use this in CI or on hosts without egress.
//
// Usage:
//   node scripts/tls/check-tls.mjs --host app.spindle.app
//   node scripts/tls/check-tls.mjs --host staging.spindle.app --port 443 \
//     --min-version TLSv1.2 --warn-days 30 --fail-days 7
//   node scripts/tls/check-tls.mjs --demo
//   node scripts/tls/check-tls.mjs --self-test
//   node scripts/tls/check-tls.mjs --host app.spindle.app --json
//
// Exit codes: 0 = all checks pass (warnings allowed), 1 = a check failed or
// a fixture verdict mismatched in demo mode, 2 = usage/connection error.

import tls from "node:tls"
import { X509Certificate } from "node:crypto"

const USAGE = `Usage:
  check-tls.mjs --host <hostname> [options]
  check-tls.mjs --demo | --self-test

Options:
  --host <hostname>   Hostname to probe (SNI + certificate CN/SAN check).
  --port <port>       TCP port (default 443).
  --min-version <v>   Minimum acceptable protocol: TLSv1.2 (default), TLSv1.3.
  --warn-days <n>     Warn when the certificate expires within n days (default 30).
  --fail-days <n>     Fail when the certificate expires within n days (default 7).
  --timeout <ms>      Per-connection timeout (default 10000).
  --no-floor-check    Skip the TLS 1.0 downgrade-floor probe.
  --json              Emit machine-readable JSON instead of text.
  --demo, --self-test Run the offline assertion self-test (no network).
  --help              Show this text.`

const PROTOCOL_RANK = {
  SSLv3: 0,
  TLSv1: 1,
  "TLSv1.1": 2,
  "TLSv1.2": 3,
  "TLSv1.3": 4,
}

const DEFAULT_POLICY = {
  minVersion: "TLSv1.2",
  warnDays: 30,
  failDays: 7,
}

// Cipher names that must never be negotiated: export-grade, null, RC4,
// MD5-based, anonymous Diffie-Hellman, and single-DES suites.
const WEAK_CIPHER = /(^|[-_])(EXP|EXPORT|NULL|RC4|MD5|ADH|AECDH|DES)([-_]|$)/i

// TLS 1.2-and-below suites without ephemeral key exchange have no forward
// secrecy. OpenSSL names them without ECDHE/DHE (e.g. "AES256-GCM-SHA384"
// for TLS_RSA_WITH_AES_256_GCM_SHA384). TLS 1.3 suites are all ephemeral
// and are matched by standardName instead.
function cipherHasForwardSecrecy(cipher) {
  if (!cipher) return false
  if (cipher.version === "TLSv1.3" || /^TLS_(AES|CHACHA)/.test(cipher.standardName ?? "")) {
    return true
  }
  const name = cipher.name ?? ""
  return /ECDHE|DHE|ECDH/i.test(name)
}

function parseArgs(argv) {
  const args = {
    host: null,
    port: 443,
    policy: { ...DEFAULT_POLICY },
    timeout: 10_000,
    floorCheck: true,
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
      case "--host":
        args.host = next()
        break
      case "--port":
        args.port = Number(next())
        break
      case "--min-version":
        args.policy.minVersion = next()
        break
      case "--warn-days":
        args.policy.warnDays = Number(next())
        break
      case "--fail-days":
        args.policy.failDays = Number(next())
        break
      case "--timeout":
        args.timeout = Number(next())
        break
      case "--no-floor-check":
        args.floorCheck = false
        break
      case "--json":
        args.json = true
        break
      case "--demo":
      case "--self-test":
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
    throw new Error("--host is required unless --demo/--self-test is used")
  }
  if (args.policy.minVersion && !(args.policy.minVersion in PROTOCOL_RANK)) {
    throw new Error(`Unsupported --min-version: ${args.policy.minVersion}`)
  }
  return args
}

// Open one TLS connection and capture everything the evaluator needs.
// `maxVersion` is used by the downgrade-floor probe.
function probe(host, port, { timeout, maxVersion } = {}) {
  return new Promise((resolve) => {
    let socket
    try {
      socket = tls.connect({
        host,
        port,
        servername: host,
        minVersion: "TLSv1",
        maxVersion: maxVersion ?? "TLSv1.3",
        ALPNProtocols: ["h2", "http/1.1"],
        // Certificate trust and hostname verification stay on: a probe that
        // accepts an untrusted cert is itself a finding, not a pass.
        rejectUnauthorized: true,
      })
    } catch (err) {
      resolve({ ok: false, error: String(err?.message ?? err) })
      return
    }

    const timer = setTimeout(() => {
      socket.destroy()
      resolve({ ok: false, error: `handshake timed out after ${timeout}ms` })
    }, timeout)

    socket.once("secureConnect", () => {
      clearTimeout(timer)
      try {
        const peer = socket.getPeerCertificate(true)
        const x509 = new X509Certificate(peer.raw)
        resolve({
          ok: true,
          protocol: socket.getProtocol(),
          cipher: socket.getCipher() ?? null,
          cert: {
            subject: x509.subject,
            issuer: x509.issuer,
            subjectAltName: x509.subjectAltName,
            validFrom: x509.validFrom,
            validTo: x509.validTo,
            fingerprint256: x509.fingerprint256,
          },
          alpn: socket.alpnProtocol || null,
        })
      } catch (err) {
        resolve({ ok: false, error: `could not parse peer certificate: ${err.message}` })
      } finally {
        socket.end()
      }
    })

    socket.once("error", (err) => {
      clearTimeout(timer)
      resolve({ ok: false, error: String(err?.message ?? err) })
      socket.destroy()
    })
  })
}

// Pure evaluation: turns an observation into pass/warn/fail checks.
// `observation` is either a live probe result or a demo fixture.
// Returns { status, checks } where status is the worst check status.
function evaluate(observation, policy = DEFAULT_POLICY, now = new Date()) {
  const checks = []

  if (!observation.ok) {
    checks.push({
      id: "tls.handshake",
      status: "fail",
      detail: observation.error ?? "TLS handshake failed",
    })
    return { status: "fail", checks }
  }

  checks.push({
    id: "tls.handshake",
    status: "pass",
    detail: `handshake ok; ALPN=${observation.alpn ?? "none"}`,
  })

  // Certificate validity window.
  const validFrom = new Date(observation.cert.validFrom)
  const validTo = new Date(observation.cert.validTo)
  const daysLeft = (validTo.getTime() - now.getTime()) / 86_400_000

  if (Number.isNaN(validFrom.getTime()) || Number.isNaN(validTo.getTime())) {
    checks.push({
      id: "cert.validity",
      status: "fail",
      detail: `unparseable validity window: ${observation.cert.validFrom} → ${observation.cert.validTo}`,
    })
  } else if (now < validFrom) {
    checks.push({
      id: "cert.validity",
      status: "fail",
      detail: `certificate not yet valid (valid from ${observation.cert.validFrom})`,
    })
  } else if (now > validTo) {
    checks.push({
      id: "cert.validity",
      status: "fail",
      detail: `certificate expired on ${observation.cert.validTo}`,
    })
  } else if (daysLeft <= policy.failDays) {
    checks.push({
      id: "cert.validity",
      status: "fail",
      detail: `certificate expires in ${Math.floor(daysLeft)} day(s) (${observation.cert.validTo})`,
    })
  } else if (daysLeft <= policy.warnDays) {
    checks.push({
      id: "cert.validity",
      status: "warn",
      detail: `certificate expires in ${Math.floor(daysLeft)} day(s) (${observation.cert.validTo})`,
    })
  } else {
    checks.push({
      id: "cert.validity",
      status: "pass",
      detail: `valid until ${observation.cert.validTo} (${Math.floor(daysLeft)} days left)`,
    })
  }

  // Negotiated protocol version.
  const protocol = observation.protocol
  const rank = PROTOCOL_RANK[protocol]
  const minRank = PROTOCOL_RANK[policy.minVersion]
  if (rank === undefined) {
    checks.push({
      id: "tls.version",
      status: "warn",
      detail: `unrecognized negotiated protocol "${protocol}"`,
    })
  } else if (rank < minRank) {
    checks.push({
      id: "tls.version",
      status: "fail",
      detail: `negotiated ${protocol}; policy requires >= ${policy.minVersion}`,
    })
  } else {
    checks.push({
      id: "tls.version",
      status: "pass",
      detail: `negotiated ${protocol} (policy >= ${policy.minVersion})`,
    })
  }

  // Cipher strength.
  const cipher = observation.cipher
  if (!cipher || !cipher.name) {
    checks.push({ id: "tls.cipher", status: "warn", detail: "no cipher information returned" })
  } else if (WEAK_CIPHER.test(cipher.name) || WEAK_CIPHER.test(cipher.standardName ?? "")) {
    checks.push({
      id: "tls.cipher",
      status: "fail",
      detail: `weak cipher negotiated: ${cipher.name}`,
    })
  } else if (!cipherHasForwardSecrecy(cipher)) {
    checks.push({
      id: "tls.cipher",
      status: "warn",
      detail: `cipher lacks forward secrecy: ${cipher.name}`,
    })
  } else {
    checks.push({
      id: "tls.cipher",
      status: "pass",
      detail: `cipher ${cipher.name} (${cipher.version ?? "?"})`,
    })
  }

  const status = checks.some((c) => c.status === "fail")
    ? "fail"
    : checks.some((c) => c.status === "warn")
      ? "warn"
      : "pass"
  return { status, checks }
}

function daysFromNow(days) {
  return new Date(Date.now() + days * 86_400_000).toUTCString()
}

function daysAgo(days) {
  return new Date(Date.now() - days * 86_400_000).toUTCString()
}

// Canned observations for --demo. Each fixture states the expected overall
// verdict so the self-test also proves the policy thresholds line up.
function demoFixtures(now) {
  void now
  return [
    {
      name: "healthy edge: TLS 1.3 + ECDSA cert, 90 days left",
      observation: {
        ok: true,
        protocol: "TLSv1.3",
        alpn: "h2",
        cipher: {
          name: "TLS_AES_256_GCM_SHA384",
          standardName: "TLS_AES_256_GCM_SHA384",
          version: "TLSv1.3",
        },
        cert: {
          subject: "CN=app.spindle.app",
          issuer: "C=US, O=Google Trust Services, CN=WE1",
          subjectAltName: "DNS:app.spindle.app",
          validFrom: daysAgo(60),
          validTo: daysFromNow(90),
          fingerprint256: "AA:BB",
        },
      },
      expected: "pass",
    },
    {
      name: "expired certificate",
      observation: {
        ok: true,
        protocol: "TLSv1.3",
        cipher: {
          name: "TLS_AES_128_GCM_SHA256",
          standardName: "TLS_AES_128_GCM_SHA256",
          version: "TLSv1.3",
        },
        cert: {
          subject: "CN=app.spindle.app",
          issuer: "C=US, O=Google Trust Services, CN=WE1",
          subjectAltName: "DNS:app.spindle.app",
          validFrom: daysAgo(400),
          validTo: daysAgo(10),
          fingerprint256: "AA:BB",
        },
      },
      expected: "fail",
    },
    {
      name: "TLS 1.0 negotiated against TLS 1.2 policy",
      observation: {
        ok: true,
        protocol: "TLSv1",
        cipher: {
          name: "ECDHE-RSA-AES128-SHA",
          standardName: "ECDHE-RSA-AES128-SHA",
          version: "TLSv1/SSLv3",
        },
        cert: {
          subject: "CN=app.spindle.app",
          issuer: "C=US, O=Google Trust Services, CN=WE1",
          subjectAltName: "DNS:app.spindle.app",
          validFrom: daysAgo(60),
          validTo: daysFromNow(90),
          fingerprint256: "AA:BB",
        },
      },
      expected: "fail",
    },
    {
      name: "weak cipher (RC4) negotiated",
      observation: {
        ok: true,
        protocol: "TLSv1.2",
        cipher: {
          name: "ECDHE-RSA-RC4-SHA",
          standardName: "ECDHE-RSA-RC4-SHA",
          version: "TLSv1/SSLv3",
        },
        cert: {
          subject: "CN=app.spindle.app",
          issuer: "C=US, O=Google Trust Services, CN=WE1",
          subjectAltName: "DNS:app.spindle.app",
          validFrom: daysAgo(60),
          validTo: daysFromNow(90),
          fingerprint256: "AA:BB",
        },
      },
      expected: "fail",
    },
    {
      name: "certificate expires in 10 days (inside warn window)",
      observation: {
        ok: true,
        protocol: "TLSv1.3",
        cipher: {
          name: "TLS_AES_256_GCM_SHA384",
          standardName: "TLS_AES_256_GCM_SHA384",
          version: "TLSv1.3",
        },
        cert: {
          subject: "CN=app.spindle.app",
          issuer: "C=US, O=Google Trust Services, CN=WE1",
          subjectAltName: "DNS:app.spindle.app",
          validFrom: daysAgo(355),
          validTo: daysFromNow(10),
          fingerprint256: "AA:BB",
        },
      },
      expected: "warn",
    },
    {
      name: "handshake rejected (untrusted or unreachable)",
      observation: { ok: false, error: "self-signed certificate in certificate chain" },
      expected: "fail",
    },
  ]
}

async function runDemo(json) {
  const now = new Date()
  const fixtures = demoFixtures(now)
  const results = []
  let mismatches = 0

  for (const fixture of fixtures) {
    const { status, checks } = evaluate(fixture.observation, DEFAULT_POLICY, now)
    const ok = status === fixture.expected
    if (!ok) mismatches += 1
    results.push({ name: fixture.name, expected: fixture.expected, actual: status, ok, checks })
  }

  if (json) {
    console.log(JSON.stringify({ mode: "demo", fixtures: results }, null, 2))
  } else {
    console.log(`TLS self-test — ${fixtures.length} canned observations against default policy\n`)
    for (const r of results) {
      const mark = r.ok ? "PASS" : "MISMATCH"
      console.log(
        `${mark}  expected=${r.expected.padEnd(4)} actual=${r.actual.padEnd(4)}  ${r.name}`,
      )
      for (const c of r.checks) {
        console.log(`      ${c.status.toUpperCase().padEnd(4)} ${c.id}: ${c.detail}`)
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

async function runHost(args) {
  const { host, port, policy, timeout } = args
  const findings = []

  const main = await probe(host, port, { timeout })
  const evaluated = evaluate(main, policy)
  findings.push({
    target: `${host}:${port}`,
    kind: "primary",
    ...evaluated,
    observation: main.ok
      ? {
          protocol: main.protocol,
          cipher: main.cipher,
          cert: {
            subject: main.cert.subject,
            issuer: main.cert.issuer,
            subjectAltName: main.cert.subjectAltName,
            validFrom: main.cert.validFrom,
            validTo: main.cert.validTo,
            fingerprint256: main.cert.fingerprint256,
          },
        }
      : { error: main.error },
  })

  // Downgrade-floor probe: can a client still negotiate TLS 1.0? A success
  // here is a warning — Cloudflare's Minimum TLS Version should refuse it.
  if (args.floorCheck && main.ok) {
    const floor = await probe(host, port, { timeout, maxVersion: "TLSv1" })
    if (floor.ok) {
      findings.push({
        target: `${host}:${port}`,
        kind: "floor",
        status: "warn",
        checks: [
          {
            id: "tls.floor",
            status: "warn",
            detail: `server still accepts TLS ${floor.protocol} handshakes; raise Minimum TLS Version`,
          },
        ],
      })
    } else {
      findings.push({
        target: `${host}:${port}`,
        kind: "floor",
        status: "pass",
        checks: [
          {
            id: "tls.floor",
            status: "pass",
            detail: `TLS 1.0 handshake rejected (${floor.error})`,
          },
        ],
      })
    }
  }

  const failed = findings.some((f) => f.status === "fail")
  const warned = findings.some((f) => f.status === "warn")
  const overall = failed ? "fail" : warned ? "warn" : "pass"

  if (args.json) {
    console.log(JSON.stringify({ host, port, policy, overall, findings }, null, 2))
  } else {
    console.log(
      `TLS posture for ${host}:${port} (policy: min ${policy.minVersion}, warn <${policy.warnDays}d, fail <${policy.failDays}d)\n`,
    )
    for (const f of findings) {
      console.log(`[${f.status.toUpperCase()}] ${f.target} (${f.kind})`)
      for (const c of f.checks) {
        console.log(`    ${c.status.toUpperCase().padEnd(4)} ${c.id}: ${c.detail}`)
      }
      if (f.kind === "primary" && f.observation?.cert) {
        const cert = f.observation.cert
        console.log(`    cert subject: ${cert.subject}`)
        console.log(`    cert issuer:  ${cert.issuer}`)
        console.log(`    SAN:           ${cert.subjectAltName}`)
        console.log(`    fingerprint:   ${cert.fingerprint256}`)
      }
      console.log("")
    }
    console.log(`Overall: ${overall.toUpperCase()}`)
  }

  return failed ? 1 : 0
}

async function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(`error: ${err.message}\n\n${USAGE}`)
    return 2
  }
  if (args.help) {
    console.log(USAGE)
    return 0
  }
  if (args.demo) {
    return runDemo(args.json)
  }
  try {
    return await runHost(args)
  } catch (err) {
    console.error(`error: probing ${args.host}:${args.port} failed: ${err.message}`)
    return 2
  }
}

main().then((code) => process.exit(code))
