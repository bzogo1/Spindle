#!/usr/bin/env node
// Static validation for the infrastructure tree (infra/ by default).
//
// There is no live cloud in CI, so this script checks everything that can be
// checked without a host: YAML/JSON syntax, compose service structure,
// cloudflared ingress rules (hostname routing plus a terminal 404), shell
// script syntax via `bash -n`, and cross-file consistency (ports referenced
// by the tunnel exist on the compose services, required environment
// variables are documented in the host.env examples, and paths bootstrap.sh
// references actually exist).
//
// Usage:
//   node scripts/infra-test/validate.mjs [--root <dir>] [--json] [--demo]
//
//   --root <dir>  Validate a different tree (default: <repo>/infra).
//   --json        Emit the report as JSON instead of human-readable lines.
//   --demo        Validate the bundled fixture tree and always exit 0; the
//                 fixture intentionally contains findings to demonstrate
//                 both PASS and FAIL output.
//
// Exit codes: 0 = no failures, 1 = at least one FAIL,
// 2 = target tree unreadable or empty. Arguments are not validated; a bare
// --root falls back to "infra" resolved against the current working directory.
//
// js-yaml is resolved from the repository's own node_modules (it is already
// an installed transitive dependency); no packages are added by this script.

import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { basename, dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..")
const require = createRequire(import.meta.url)

const args = process.argv.slice(2)
const JSON_OUT = args.includes("--json")
const DEMO = args.includes("--demo")
const rootFlagIndex = args.indexOf("--root")
const ROOT = resolve(
  rootFlagIndex === -1 ? join(REPO_ROOT, "infra") : (args[rootFlagIndex + 1] ?? "infra"),
)
const FIXTURE_ROOT = join(SCRIPT_DIR, "fixtures", "demo")
const EFFECTIVE_ROOT = DEMO ? FIXTURE_ROOT : ROOT

const findings = []
// All findings are stored repo-relative so --json and the human report agree.
// Callers may pass absolute paths or paths already relative to REPO_ROOT;
// resolve() recovers the absolute path in both cases before relativizing.
const report = (level, file, check, message) => {
  const relFile = relative(REPO_ROOT, resolve(REPO_ROOT, file))
  findings.push({ level, file: relFile, check, message })
}
const pass = (file, check, message) => report("pass", file, check, message)
const fail = (file, check, message) => report("fail", file, check, message)
const warn = (file, check, message) => report("warn", file, check, message)
const info = (file, check, message) => report("info", file, check, message)

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.isFile()) out.push(full)
  }
  return out
}

let yaml = null
function loadYaml() {
  if (yaml) return yaml
  try {
    yaml = require("js-yaml")
  } catch {
    throw new Error(
      "js-yaml is not resolvable from the repository node_modules; " +
        "run `npm ci` first or validate on a machine with dependencies installed.",
    )
  }
  return yaml
}

// ── File collectors ─────────────────────────────────────────────────────────

const composeFiles = [] // { path, data }
const cloudflaredFiles = [] // { path, data }
const envExamples = new Map() // path -> Set(keys)
const shellFiles = []
const jsonFiles = []
const caddyFiles = []
const yamlDocs = new Map() // path -> parsed doc (for compose/cloudflared reuse)

const ENV_VAR_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(:?[-=?]?)([^}]*)\}/g
// Groups: name, operator-ish marker, default-or-message.
// ":?" means "fail if unset"; ":-" means "use default if unset".

function collectEnvVars(value, into) {
  if (typeof value === "string") {
    for (const match of value.matchAll(ENV_VAR_RE)) {
      const [, name, marker] = match
      into.set(name, marker.startsWith(":?") ? "required" : "defaulted")
    }
  } else if (Array.isArray(value)) {
    for (const item of value) collectEnvVars(item, into)
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectEnvVars(item, into)
  }
}

function parsePortEntry(entry) {
  // Returns { hostPort, containerPort } or null when unparseable.
  if (typeof entry === "string") {
    const parts = entry.split(":")
    if (parts.length === 1) return { hostPort: null, containerPort: parts[0] }
    if (parts.length === 2) {
      return { hostPort: parts[0], containerPort: parts[1] }
    }
    if (parts.length === 3) {
      return { hostPort: parts[1], containerPort: parts[2] }
    }
    return null
  }
  if (entry && typeof entry === "object") {
    return {
      hostPort: entry.published != null ? String(entry.published) : null,
      containerPort: entry.target != null ? String(entry.target) : null,
    }
  }
  return null
}

// ── Per-file checks ─────────────────────────────────────────────────────────

function checkShell(file) {
  try {
    execFileSync("bash", ["-n", file], { stdio: "pipe" })
    pass(file, "bash -n", "shell syntax OK")
  } catch (error) {
    const detail = String(error.stderr || error.message)
      .trim()
      .split("\n")[0]
    fail(file, "bash -n", `syntax error: ${detail}`)
  }
}

function checkJson(file) {
  try {
    JSON.parse(readFileSync(file, "utf8"))
    pass(file, "json", "valid JSON")
  } catch (error) {
    fail(file, "json", `invalid JSON: ${error.message}`)
  }
}

function checkEnvExample(file) {
  const keys = new Set()
  const lines = readFileSync(file, "utf8").split("\n")
  let ok = true
  lines.forEach((line, index) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) return
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed)
    if (!match) {
      fail(file, "env-format", `line ${index + 1}: not a KEY=VALUE assignment`)
      ok = false
      return
    }
    if (keys.has(match[1])) {
      fail(file, "env-format", `line ${index + 1}: duplicate key ${match[1]}`)
      ok = false
      return
    }
    keys.add(match[1])
  })
  if (ok && keys.size > 0) {
    pass(file, "env-format", `${keys.size} keys, well-formed`)
  }
  envExamples.set(file, keys)
}

function checkYaml(file, data) {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    fail(file, "yaml", "top level must be a mapping")
    return
  }
  pass(file, "yaml", "parses as a YAML mapping")
  const lower = file.toLowerCase()
  const name = basename(file).toLowerCase()
  if (name.includes("compose") || lower.includes("compose")) {
    checkCompose(file, data)
  } else if (lower.includes("cloudflared")) {
    checkCloudflared(file, data)
  }
}

function checkCompose(file, doc) {
  const rel = relative(REPO_ROOT, file)
  if (!doc.services || typeof doc.services !== "object") {
    fail(rel, "compose", "missing or invalid `services` mapping")
    return
  }
  const serviceNames = new Set(Object.keys(doc.services))
  const exposedPorts = new Map() // service -> Set(container ports)
  const declaredNetworks = new Set(Object.keys(doc.networks ?? {}))
  const envVars = new Map() // name -> required|defaulted
  collectEnvVars(doc, envVars)

  for (const [serviceName, service] of Object.entries(doc.services)) {
    if (!service || typeof service !== "object") {
      fail(rel, "compose", `service ${serviceName}: not a mapping`)
      continue
    }
    if (!service.image && !service.build) {
      warn(rel, "compose", `service ${serviceName}: no image or build key`)
    }
    const ports = new Set()
    for (const entry of service.ports ?? []) {
      const parsed = parsePortEntry(entry)
      if (!parsed || !/^\d+$/.test(parsed.containerPort ?? "")) {
        fail(
          rel,
          "compose",
          `service ${serviceName}: unparseable port entry ${JSON.stringify(entry)}`,
        )
        continue
      }
      if (parsed.hostPort != null && !/^\d+$/.test(parsed.hostPort)) {
        fail(rel, "compose", `service ${serviceName}: non-numeric host port ${parsed.hostPort}`)
      }
      if (parsed.containerPort) ports.add(String(parsed.containerPort).split("/")[0])
    }
    for (const exposed of service.expose ?? []) {
      ports.add(String(exposed).split("/")[0])
    }
    exposedPorts.set(serviceName, ports)

    const dependsOn = Array.isArray(service.depends_on)
      ? service.depends_on
      : Object.keys(service.depends_on ?? {})
    for (const dep of dependsOn) {
      const depName = typeof dep === "string" ? dep : dep?.service
      if (depName && !serviceNames.has(depName)) {
        fail(rel, "compose", `service ${serviceName}: depends_on unknown service ${depName}`)
      }
    }
    const serviceNetworks = Array.isArray(service.networks)
      ? service.networks
      : Object.keys(service.networks ?? {})
    for (const network of serviceNetworks) {
      const networkName = typeof network === "string" ? network : (network?.name ?? network)
      if (networkName && !declaredNetworks.has(String(networkName))) {
        warn(
          rel,
          "compose",
          `service ${serviceName}: network ${networkName} is not declared under top-level networks`,
        )
      }
    }
  }

  if (serviceNames.size > 0) {
    pass(rel, "compose", `${serviceNames.size} services defined`)
  }

  composeFiles.push({ path: file, rel, doc, envVars, exposedPorts, serviceNames })
}

const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i

function checkCloudflared(file, doc) {
  const rel = relative(REPO_ROOT, file)
  const ingress = doc.ingress
  if (!Array.isArray(ingress) || ingress.length === 0) {
    fail(rel, "cloudflared", "missing or empty `ingress` list")
    return
  }

  const hostnames = new Set()
  ingress.forEach((rule, index) => {
    const label = `ingress[${index}]`
    if (!rule || typeof rule !== "object") {
      fail(rel, "cloudflared", `${label}: not a mapping`)
      return
    }
    const isLast = index === ingress.length - 1
    if (rule.hostname) {
      if (!HOSTNAME_RE.test(rule.hostname)) {
        fail(rel, "cloudflared", `${label}: invalid hostname ${rule.hostname}`)
      }
      if (hostnames.has(rule.hostname)) {
        fail(rel, "cloudflared", `${label}: duplicate hostname ${rule.hostname}`)
      }
      hostnames.add(rule.hostname)
    } else if (!isLast) {
      fail(rel, "cloudflared", `${label}: rule without hostname before the catch-all`)
    }
    const service = rule.service
    if (typeof service !== "string" || service.length === 0) {
      fail(rel, "cloudflared", `${label}: missing service`)
    } else if (/^https?:\/\//.test(service)) {
      let url = null
      try {
        url = new URL(service)
      } catch {
        // handled below as an invalid service URL
      }
      if (!url || !url.hostname || !url.port) {
        fail(rel, "cloudflared", `${label}: service ${service} needs an explicit host and port`)
      }
    } else if (!/^(unix:|http_status:\d{3}|tcp:\/\/|hello_world)/.test(service)) {
      warn(rel, "cloudflared", `${label}: unusual service ${service}`)
    }
    if (isLast) {
      if (service !== "http_status:404") {
        fail(
          rel,
          "cloudflared",
          "last ingress rule must be the catch-all `service: http_status:404`",
        )
      }
      if (rule.hostname) {
        fail(rel, "cloudflared", "catch-all rule must not set a hostname")
      }
    }
  })
  const last = ingress[ingress.length - 1]
  if (last?.service === "http_status:404" && !last?.hostname) {
    pass(rel, "cloudflared", `${ingress.length} ingress rules, catch-all present`)
  } else {
    fail(
      rel,
      "cloudflared",
      `${ingress.length} ingress rules but the last rule is not a hostname-less ` +
        "`service: http_status:404` catch-all",
    )
  }

  cloudflaredFiles.push({ path: file, rel, doc })
}

function checkCaddyfile(file) {
  const text = readFileSync(file, "utf8")
  if (text.trim().length === 0) {
    fail(file, "caddyfile", "empty file")
    return
  }
  if (!/^\s*:\d+|^[\w.-]+(?::\d+)?\s*\{/m.test(text)) {
    warn(file, "caddyfile", "no site address block found")
  }
  pass(file, "caddyfile", "non-empty site definition")
}

// ── Cross-file consistency ──────────────────────────────────────────────────

function crossCheck() {
  // Env vars required by compose must be documented in an env example.
  const documented = new Set()
  for (const keys of envExamples.values()) {
    for (const key of keys) documented.add(key)
  }
  for (const compose of composeFiles) {
    for (const [name, kind] of compose.envVars) {
      if (kind === "required" && !documented.has(name)) {
        fail(
          compose.rel,
          "env-docs",
          `required variable ${name} is not documented in any *.env.example`,
        )
      } else if (kind === "defaulted" && !documented.has(name)) {
        info(compose.rel, "env-docs", `variable ${name} has a default and is not in an env example`)
      }
    }
  }

  // Tunnel upstreams must resolve to a compose service (or a known external
  // proxy) on a port that service actually exposes.
  for (const tunnel of cloudflaredFiles) {
    for (const [index, rule] of (tunnel.doc.ingress ?? []).entries()) {
      const service = rule?.service
      if (typeof service !== "string" || !/^https?:\/\//.test(service)) continue
      let url
      try {
        url = new URL(service)
      } catch {
        warn(
          tunnel.rel,
          "tunnel-upstream",
          `ingress[${index}] service ${service} is not a parseable URL`,
        )
        continue
      }
      const host = url.hostname
      const port = url.port
      let matched = false
      for (const compose of composeFiles) {
        if (!compose.serviceNames.has(host)) continue
        matched = true
        const exposed = compose.exposedPorts.get(host) ?? new Set()
        if (exposed.size > 0 && !exposed.has(port)) {
          fail(
            tunnel.rel,
            "tunnel-upstream",
            `ingress[${index}] routes to ${host}:${port}, but service ${host} ` +
              `exposes ${[...exposed].join(", ")}`,
          )
        } else {
          pass(
            tunnel.rel,
            "tunnel-upstream",
            `ingress[${index}] ${host}:${port} matches compose service`,
          )
        }
      }
      if (!matched) {
        warn(
          tunnel.rel,
          "tunnel-upstream",
          `ingress[${index}] upstream ${host}:${port} is not a compose service ` +
            "(expected for host-run proxies such as lab-proxy; verify it manually)",
        )
      }
    }
  }

  // Paths referenced by shell scripts under infra/ must exist in the repo.
  for (const file of shellFiles) {
    const text = readFileSync(file, "utf8")
    const refs = new Set()
    for (const match of text.matchAll(/infra\/[A-Za-z0-9_./-]+/g)) {
      refs.add(match[0].replace(/[.,;:)\]]+$/, ""))
    }
    for (const ref of refs) {
      try {
        statSync(join(REPO_ROOT, ref))
      } catch {
        if (DEMO) continue
        fail(file, "path-refs", `references missing path ${ref}`)
      }
    }
    if (refs.size > 0) {
      pass(file, "path-refs", `${refs.size} infra/ path reference(s) exist`)
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  let files
  try {
    files = walk(EFFECTIVE_ROOT)
  } catch (error) {
    console.error(`Cannot read ${EFFECTIVE_ROOT}: ${error.message}`)
    process.exit(2)
  }
  if (files.length === 0) {
    console.error(`No files found under ${EFFECTIVE_ROOT}`)
    process.exit(2)
  }

  for (const file of files) {
    const name = basename(file)
    if (name.endsWith(".sh")) {
      shellFiles.push(file)
      checkShell(file)
    } else if (name.endsWith(".json")) {
      jsonFiles.push(file)
      checkJson(file)
    } else if (name === "caddyfile" || name.startsWith("caddyfile.")) {
      caddyFiles.push(file)
      checkCaddyfile(file)
    } else if (/\.env(\..*)?\.example$/.test(name) || name.endsWith(".env.example")) {
      checkEnvExample(file)
    } else if (/\.(ya?ml)$/.test(name)) {
      try {
        const doc = loadYaml().load(readFileSync(file, "utf8"))
        yamlDocs.set(file, doc)
        checkYaml(file, doc)
      } catch (error) {
        fail(file, "yaml", `invalid YAML: ${error.message.split("\n")[0]}`)
      }
    }
  }
  crossCheck()

  const counts = { pass: 0, fail: 0, warn: 0, info: 0 }
  for (const finding of findings) counts[finding.level] += 1

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        {
          root: EFFECTIVE_ROOT,
          demo: DEMO,
          summary: counts,
          findings,
        },
        null,
        2,
      ),
    )
  } else {
    for (const finding of findings) {
      console.log(
        `${finding.level.toUpperCase().padEnd(4)} ${finding.file} — ${finding.check}: ${finding.message}`,
      )
    }
    console.log(
      `\n${counts.pass} passed, ${counts.fail} failed, ${counts.warn} warnings, ${counts.info} info ` +
        `(root: ${relative(REPO_ROOT, EFFECTIVE_ROOT) || EFFECTIVE_ROOT})`,
    )
    if (DEMO) {
      console.log("Demo mode: findings above come from the intentionally imperfect fixture tree.")
    }
  }

  if (DEMO) process.exit(0)
  process.exit(counts.fail > 0 ? 1 : 0)
}

main()
