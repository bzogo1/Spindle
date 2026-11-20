#!/usr/bin/env node
// Configuration drift detector for the Spindle origin stack.
//
//   node scripts/drift/detect.mjs [options]
//
// Compares DECLARED infrastructure (checked-in compose files, cloudflared
// ingress, env contracts, and a recorded checksum manifest) against OBSERVED
// state that is verifiable offline or on the host:
//
//   manifest  sha256 of every file under infra/ plus compose.yaml, compared
//             against scripts/drift/manifest.json (regenerate with
//             --update-manifest after an intentional infra change)
//   compose   services and external networks declared in the compose file
//             vs containers/networks actually running under Docker
//             (skipped gracefully when docker is unavailable)
//   tunnel    hostnames in the cloudflared ingress configs vs the
//             hostnames documented in docs/runbooks/hosting.md
//   env       variables required by the compose file (`${VAR:?}`) and
//             declared in host.env.example vs the live host.env
//             (skipped when no env file is present)
//
// Options:
//   --demo               run every check against a synthetic fixture that
//                        contains one drift per layer; no files or docker
//                        are touched
//   --json               print only the JSON report
//   --ci                 exit 1 when any check fails (default: exit 0 and
//                        report; exit 2 is always a usage error)
//   --update-manifest    rewrite the checksum manifest and exit
//   --manifest <path>    manifest file (default scripts/drift/manifest.json)
//   --compose <path>     compose file to check (default infra/origin/compose.yaml)
//   --env-file <path>    live env file (default: /srv/spindle/host.env when
//                        it exists; skipped otherwise)
//   --env-example <path> env contract file (default: host.env.example next
//                        to the compose file)
//   --tunnel-config <p>  cloudflared config to check (repeatable; default:
//                        infra/origin and infra/staging configs that exist)
//   --docs <path>        runbook used as the hostname source of truth
//                        (default docs/runbooks/hosting.md)
//   --no-docker          never invoke docker; mark the compose check skipped
//   -h, --help           show this message
//
// Exit codes: 0 no failing checks (or --demo/--update-manifest), 1 at least
// one check failed under --ci, 2 usage error.
//
// See docs/infrastructure/drift-detection.md for what drift means here and
// how to remediate findings.

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { env } from "node:process"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const DEFAULT_MANIFEST = join(ROOT, "scripts", "drift", "manifest.json")
const DEFAULT_COMPOSE = join(ROOT, "infra", "origin", "compose.yaml")
const DEFAULT_DOCS = join(ROOT, "docs", "runbooks", "hosting.md")
const DEFAULT_ENV_FILE = "/srv/spindle/host.env"
const MANIFEST_VERSION = 1

const USAGE = `Usage: node scripts/drift/detect.mjs [options]

Options:
  --demo               synthetic fixture; every layer reports one drift
  --json               JSON report only
  --ci                 exit 1 when a check fails
  --update-manifest    regenerate the checksum manifest
  --manifest <path>    manifest path (default scripts/drift/manifest.json)
  --compose <path>     compose file (default infra/origin/compose.yaml)
  --env-file <path>    live env file (default /srv/spindle/host.env)
  --env-example <path> env contract file
  --tunnel-config <p>  cloudflared config (repeatable)
  --docs <path>        hostname source-of-truth runbook
  --no-docker          skip the docker observation
  -h, --help           this help

Exit codes: 0 clean/skipped, 1 drift under --ci, 2 usage error.`

function parseArgs(argv) {
  const opts = {
    demo: false,
    json: false,
    ci: false,
    updateManifest: false,
    noDocker: false,
    manifest: DEFAULT_MANIFEST,
    compose: DEFAULT_COMPOSE,
    envFile: env.DRIFT_ENV_FILE || DEFAULT_ENV_FILE,
    envExample: null,
    tunnelConfigs: [],
    docs: DEFAULT_DOCS,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => {
      const value = argv[++i]
      if (value === undefined) throw new Error(`missing value for ${arg}`)
      return value
    }
    switch (arg) {
      case "--demo":
        opts.demo = true
        break
      case "--json":
        opts.json = true
        break
      case "--ci":
        opts.ci = true
        break
      case "--update-manifest":
        opts.updateManifest = true
        break
      case "--no-docker":
        opts.noDocker = true
        break
      case "-h":
      case "--help":
        opts.help = true
        break
      case "--manifest":
        opts.manifest = resolve(next())
        break
      case "--compose":
        opts.compose = resolve(next())
        break
      case "--env-file":
        opts.envFile = resolve(next())
        break
      case "--env-example":
        opts.envExample = resolve(next())
        break
      case "--tunnel-config":
        opts.tunnelConfigs.push(resolve(next()))
        break
      case "--docs":
        opts.docs = resolve(next())
        break
      default:
        throw new Error(`unknown option: ${arg}`)
    }
  }
  return opts
}

// ---------------------------------------------------------------------------
// Parsers (dependency-free; the formats are simple enough for line scanning)
// ---------------------------------------------------------------------------

/** Service names, `${VAR:?}` requirements, project name, external networks. */
export function parseCompose(text) {
  const name = (text.match(/^name:\s*([A-Za-z0-9_.-]+)/m) || [])[1] || null
  const services = new Set()
  const requiredVars = new Set()
  for (const m of text.matchAll(/\$\{([A-Z_][A-Z0-9_]*):\?/g)) {
    requiredVars.add(m[1])
  }
  const servicesBlock = text.match(/^services:\n((?:^[ \t]+.*\n?|^\n)*)/m)
  if (servicesBlock) {
    for (const m of servicesBlock[1].matchAll(/^ {2}([A-Za-z0-9_-]+):/gm)) {
      services.add(m[1])
    }
  }
  const networks = new Set()
  const networksBlock = text.match(/^networks:\n((?:^[ \t]+.*\n?|^\n)*)/m)
  if (networksBlock) {
    const entries = networksBlock[1].split(/^ {2}(?=[A-Za-z0-9_-]+:)/m)
    for (const entry of entries) {
      const key = (entry.match(/^([A-Za-z0-9_-]+):/) || [])[1]
      if (key && /external:\s*true/.test(entry)) networks.add(key)
    }
  }
  return { name, services, requiredVars, networks }
}

/** KEY -> raw value from a dotenv-style file (comments and blanks skipped). */
export function parseEnvFile(text) {
  const vars = new Map()
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m || line.trimStart().startsWith("#")) continue
    let value = m[2]
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    vars.set(m[1], value)
  }
  return vars
}

/** [{hostname, service}] from a cloudflared ingress config. */
export function parseTunnelIngress(text) {
  const rules = []
  const ingress = text.match(/^ingress:\n((?:^[ \t]+.*\n?|^\n)*)/m)
  if (!ingress) return rules
  const blocks = ingress[1].split(/^ {2}- /m)
  for (const block of blocks) {
    const hostname = (block.match(/hostname:\s*(\S+)/) || [])[1]
    const service = (block.match(/service:\s*(\S+)/) || [])[1]
    if (hostname) rules.push({ hostname, service: service || null })
  }
  return rules
}

/** Hostnames documented as *.spindle.app in the hosting runbook. */
export function documentedHostnames(docsText) {
  const found = new Set()
  for (const m of docsText.matchAll(
    /[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9-]+)*\.spindle\.app/g,
  )) {
    found.add(m[0].toLowerCase())
  }
  return found
}

// ---------------------------------------------------------------------------
// Manifest (checksum layer)
// ---------------------------------------------------------------------------

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

/** All files covered by the manifest: infra/** plus the root compose file.
 *  Terraform artifacts (.terraform/ dirs, *.tfstate*, *.terraform.lock.hcl)
 *  are local provider state and excluded from drift detection. */
export function manifestFiles(root = ROOT) {
  const files = []
  const ignored = (name) =>
    name === ".terraform" ||
    name.endsWith(".tfstate") ||
    name.endsWith(".tfstate.backup") ||
    name === ".terraform.lock.hcl"
  const walk = (dir) => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        if (!ignored(entry)) walk(full)
      } else if (!ignored(entry)) {
        files.push(full)
      }
    }
  }
  walk(join(root, "infra"))
  const compose = join(root, "compose.yaml")
  if (existsSync(compose)) files.push(compose)
  return files.sort()
}

export function buildManifest(root = ROOT) {
  const files = {}
  for (const file of manifestFiles(root)) {
    files[relative(root, file)] = `sha256:${sha256File(file)}`
  }
  return { version: MANIFEST_VERSION, files }
}

function checkManifest({ root, manifestPath }) {
  const id = "manifest"
  const layer = "checksums"
  if (!existsSync(manifestPath)) {
    return {
      id,
      layer,
      status: "fail",
      summary: `no manifest at ${relative(root, manifestPath)}; run --update-manifest`,
      findings: [{ severity: "error", message: "checksum manifest is missing" }],
    }
  }
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  } catch (err) {
    return {
      id,
      layer,
      status: "fail",
      summary: "manifest is not valid JSON",
      findings: [{ severity: "error", message: String(err.message || err) }],
    }
  }
  const recorded = manifest.files || {}
  const findings = []
  let compared = 0
  for (const [rel, expected] of Object.entries(recorded)) {
    const full = join(root, rel)
    if (!existsSync(full)) {
      findings.push({ severity: "error", message: `${rel}: recorded file is missing`, path: rel })
      continue
    }
    compared++
    const actual = `sha256:${sha256File(full)}`
    if (actual !== expected) {
      findings.push({
        severity: "error",
        message: `${rel}: checksum changed since manifest was recorded`,
        path: rel,
      })
    }
  }
  const recordedSet = new Set(Object.keys(recorded))
  for (const file of manifestFiles(root)) {
    const rel = relative(root, file)
    if (!recordedSet.has(rel)) {
      findings.push({
        severity: "warn",
        message: `${rel}: new infra file not yet in the manifest (run --update-manifest)`,
        path: rel,
      })
    }
  }
  const errors = findings.filter((f) => f.severity === "error").length
  const warns = findings.length - errors
  return {
    id,
    layer,
    status: errors ? "fail" : warns ? "warn" : "pass",
    summary:
      findings.length === 0
        ? `${compared} files match the recorded manifest`
        : `${errors} changed/missing, ${warns} unrecorded of ${Object.keys(recorded).length} recorded`,
    findings,
  }
}

// ---------------------------------------------------------------------------
// Compose vs Docker
// ---------------------------------------------------------------------------

function dockerAvailable() {
  const result = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
    encoding: "utf8",
    timeout: 10000,
  })
  return result.status === 0
}

/** observed = {services:Set, networks:Set} | null; dockerError string | null */
export function evaluateContainers({ services, networks }, observed, dockerError) {
  if (!observed || dockerError) {
    return {
      status: "skipped",
      summary: `docker unavailable (${dockerError || "no observation"}); container drift not checked`,
      findings: [],
    }
  }
  const findings = []
  for (const service of [...services].sort()) {
    if (!observed.services.has(service)) {
      findings.push({
        severity: "error",
        message: `compose service "${service}" has no running container`,
      })
    }
  }
  for (const network of [...networks].sort()) {
    if (!observed.networks.has(network)) {
      findings.push({
        severity: "error",
        message: `external network "${network}" does not exist`,
      })
    }
  }
  return {
    status: findings.length ? "fail" : "pass",
    summary:
      findings.length === 0
        ? `${services.size} services and ${networks.size} external networks match running state`
        : `${findings.length} compose declaration(s) not observed on the host`,
    findings,
  }
}

function observeDocker(project, expectedNetworks) {
  // Label lookup first; fall back to container names <project>-<service>-<n>.
  let result = spawnSync("docker", ["ps", "--format", '{{.Label "com.docker.compose.service"}}'], {
    encoding: "utf8",
    timeout: 15000,
  })
  let labelMode = result.status === 0
  if (!labelMode) {
    result = spawnSync("docker", ["ps", "--format", "{{.Names}}"], {
      encoding: "utf8",
      timeout: 15000,
    })
    if (result.status !== 0) {
      return { observed: null, error: (result.stderr || "docker ps failed").trim() }
    }
  }
  const services = new Set()
  for (const line of result.stdout.split("\n")) {
    const value = line.trim()
    if (!value) continue
    if (labelMode) {
      services.add(value)
    } else {
      const m = value.match(new RegExp(`^${project}-(.+)-\\d+$`))
      if (m) services.add(m[1])
    }
  }
  const networks = new Set()
  for (const network of expectedNetworks) {
    const probe = spawnSync("docker", ["network", "inspect", network], {
      encoding: "utf8",
      timeout: 10000,
    })
    if (probe.status === 0) networks.add(network)
  }
  return { observed: { services, networks }, error: null }
}

// ---------------------------------------------------------------------------
// Env contract
// ---------------------------------------------------------------------------

const PLACEHOLDER = /SET_BY_DEPLOY|CHANGE_ME|placeholder|example\.com/i

export function evaluateEnvContract({ exampleVars, requiredVars, envVars, envPath }) {
  if (envVars === null) {
    return {
      status: "skipped",
      summary: `no env file at ${envPath}; contract not verified`,
      findings: [],
    }
  }
  const findings = []
  const allDeclared = new Set([...exampleVars.keys(), ...requiredVars])
  for (const key of [...allDeclared].sort()) {
    const required = requiredVars.has(key)
    const declared = exampleVars.has(key)
    if (!envVars.has(key)) {
      findings.push({
        severity: required ? "error" : "warn",
        message: `${key}: required by the stack but missing from ${envPath}`,
      })
      continue
    }
    const value = envVars.get(key)
    if (required && value === "") {
      findings.push({ severity: "error", message: `${key}: present but empty in ${envPath}` })
    } else if (required && PLACEHOLDER.test(value)) {
      findings.push({
        severity: "warn",
        message: `${key}: still holds a placeholder value in ${envPath}`,
      })
    } else if (!required && declared && value === "" && exampleVars.get(key) !== "") {
      findings.push({
        severity: "warn",
        message: `${key}: empty in ${envPath} but has a default in the example`,
      })
    }
  }
  const errors = findings.filter((f) => f.severity === "error").length
  const warns = findings.length - errors
  return {
    status: errors ? "fail" : warns ? "warn" : "pass",
    summary:
      findings.length === 0
        ? `${allDeclared.size} contract variables satisfied by ${envPath}`
        : `${errors} missing/empty, ${warns} warnings across ${allDeclared.size} variables`,
    findings,
  }
}

// ---------------------------------------------------------------------------
// Tunnel ingress vs documented hostnames
// ---------------------------------------------------------------------------

export function evaluateTunnel({ configs, documented }) {
  const findings = []
  const configured = new Set()
  for (const { path, hostnames } of configs) {
    for (const hostname of hostnames) {
      configured.add(hostname)
      if (!documented.has(hostname)) {
        findings.push({
          severity: "error",
          message: `${hostname} in ${path} is not documented in the hosting runbook`,
          path,
        })
      }
    }
  }
  for (const hostname of [...documented].sort()) {
    if (!configured.has(hostname)) {
      findings.push({
        severity: "warn",
        message: `${hostname} is documented but has no ingress rule in any checked config`,
      })
    }
  }
  const errors = findings.filter((f) => f.severity === "error").length
  const warns = findings.length - errors
  return {
    status: errors ? "fail" : warns ? "warn" : "pass",
    summary:
      findings.length === 0
        ? `${configured.size} ingress hostnames match the documented set`
        : `${errors} undocumented, ${warns} documented-but-unrouted`,
    findings,
  }
}

// ---------------------------------------------------------------------------
// Demo fixtures (deterministic; one drift per layer)
// ---------------------------------------------------------------------------

function demoChecks() {
  const compose = parseCompose(`
name: spindle-demo
services:
  app:
    image: example/app:1
  worker:
    image: example/worker:1
  postgres:
    image: postgres:17-alpine
networks:
  spindle:
    external: true
`)
  const observed = {
    services: new Set(["app", "postgres"]), // worker is down: drift
    networks: new Set(["spindle"]),
  }

  const manifestCheck = {
    id: "manifest",
    layer: "checksums",
    status: "fail",
    summary: "1 changed/missing, 0 unrecorded of 2 recorded (demo fixture)",
    findings: [
      {
        severity: "error",
        message: "infra/origin/compose.yaml: checksum changed since manifest was recorded (demo)",
        path: "infra/origin/compose.yaml",
      },
    ],
  }
  const containerCheck = {
    id: "compose-containers",
    layer: "compose-vs-docker",
    ...evaluateContainers(compose, observed, null),
  }
  const envCheck = {
    id: "env-contract",
    layer: "env",
    ...evaluateEnvContract({
      exampleVars: new Map([
        ["SPINDLE_APP_IMAGE", "x"],
        ["POSTGRES_PASSWORD", ""],
        ["CLOUDFLARE_TUNNEL_ID", ""],
      ]),
      requiredVars: new Set(["SPINDLE_APP_IMAGE", "POSTGRES_PASSWORD", "CLOUDFLARE_TUNNEL_ID"]),
      envVars: new Map([
        ["SPINDLE_APP_IMAGE", "ghcr.io/spindle/app:abc123"],
        ["CLOUDFLARE_TUNNEL_ID", ""], // empty: drift
      ]),
      envPath: "/srv/spindle/host.env (demo)",
    }),
  }
  const tunnelCheck = {
    id: "tunnel-ingress",
    layer: "cloudflared",
    ...evaluateTunnel({
      configs: [
        {
          path: "infra/origin/cloudflared/config.yml (demo)",
          hostnames: ["app.spindle.app", "lab.spindle.app", "admin.spindle.app"],
        },
      ],
      documented: new Set(["app.spindle.app", "lab.spindle.app", "staging.spindle.app"]),
    }),
  }
  return [manifestCheck, containerCheck, envCheck, tunnelCheck]
}

// ---------------------------------------------------------------------------
// Live checks
// ---------------------------------------------------------------------------

function liveChecks(opts) {
  const checks = []

  // 1. Checksum manifest
  checks.push(checkManifest({ root: ROOT, manifestPath: opts.manifest }))

  // 2. Compose vs Docker
  let compose = null
  if (existsSync(opts.compose)) {
    compose = parseCompose(readFileSync(opts.compose, "utf8"))
  }
  if (!compose || compose.services.size === 0) {
    checks.push({
      id: "compose-containers",
      layer: "compose-vs-docker",
      status: "fail",
      summary: `no services parsed from ${opts.compose}`,
      findings: [{ severity: "error", message: "compose file missing or has no services" }],
    })
  } else if (opts.noDocker || !dockerAvailable()) {
    checks.push({
      id: "compose-containers",
      layer: "compose-vs-docker",
      status: "skipped",
      summary: "docker unavailable; container drift not checked",
      findings: [],
    })
  } else {
    const project = compose.name || "spindle"
    const { observed, error } = observeDocker(project, [...compose.networks])
    checks.push({
      id: "compose-containers",
      layer: "compose-vs-docker",
      ...evaluateContainers(compose, observed, error),
    })
  }

  // 3. Env contract
  const envExamplePath = opts.envExample || join(dirname(opts.compose), "host.env.example")
  let exampleVars = new Map()
  if (existsSync(envExamplePath)) {
    exampleVars = parseEnvFile(readFileSync(envExamplePath, "utf8"))
  }
  const requiredVars = compose ? compose.requiredVars : new Set()
  const envVars = existsSync(opts.envFile) ? parseEnvFile(readFileSync(opts.envFile, "utf8")) : null
  checks.push({
    id: "env-contract",
    layer: "env",
    ...evaluateEnvContract({
      exampleVars,
      requiredVars,
      envVars,
      envPath: opts.envFile,
    }),
  })

  // 4. Tunnel ingress vs documented hostnames
  const tunnelPaths =
    opts.tunnelConfigs.length > 0
      ? opts.tunnelConfigs
      : [
          join(ROOT, "infra", "origin", "cloudflared", "config.yml"),
          join(ROOT, "infra", "staging", "cloudflared", "config.yml"),
        ].filter(existsSync)
  const configs = tunnelPaths.map((path) => ({
    path: relative(ROOT, path),
    hostnames: parseTunnelIngress(readFileSync(path, "utf8")).map((r) => r.hostname),
  }))
  const documented = existsSync(opts.docs)
    ? documentedHostnames(readFileSync(opts.docs, "utf8"))
    : new Set()
  checks.push({
    id: "tunnel-ingress",
    layer: "cloudflared",
    ...evaluateTunnel({ configs, documented }),
  })

  return checks
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function report(checks, { json, mode }) {
  const counts = { pass: 0, warn: 0, fail: 0, skipped: 0 }
  for (const check of checks) counts[check.status] = (counts[check.status] || 0) + 1
  const payload = {
    tool: "scripts/drift/detect.mjs",
    mode,
    generatedAt: new Date().toISOString(),
    summary: counts,
    checks,
  }
  if (json) {
    console.log(JSON.stringify(payload, null, 2))
    return
  }
  console.log(
    `Drift detection (${mode}) — ${counts.pass} pass, ${counts.warn} warn, ${counts.fail} fail, ${counts.skipped} skipped`,
  )
  for (const check of checks) {
    const mark = { pass: "PASS", warn: "WARN", fail: "FAIL", skipped: "SKIP" }[check.status]
    console.log(`\n[${mark}] ${check.id} (${check.layer}): ${check.summary}`)
    for (const finding of check.findings) {
      console.log(`       ${finding.severity === "error" ? "!" : "-"} ${finding.message}`)
    }
  }
  if (counts.fail > 0) {
    console.log("\nDrift detected. See docs/infrastructure/drift-detection.md for remediation.")
  }
}

function main() {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(`error: ${err.message}\n\n${USAGE}`)
    process.exit(2)
  }
  if (opts.help) {
    console.log(USAGE)
    return
  }

  if (opts.updateManifest) {
    const manifest = buildManifest(ROOT)
    mkdirSync(dirname(opts.manifest), { recursive: true })
    writeFileSync(
      opts.manifest,
      `${JSON.stringify({ ...manifest, generatedAt: new Date().toISOString() }, null, 2)}\n`,
    )
    console.log(`Wrote ${Object.keys(manifest.files).length} checksums to ${opts.manifest}`)
    return
  }

  const checks = opts.demo ? demoChecks() : liveChecks(opts)
  report(checks, { json: opts.json, mode: opts.demo ? "demo" : "live" })

  const failed = checks.some((c) => c.status === "fail")
  if (opts.ci && failed && !opts.demo) process.exit(1)
}

main()
