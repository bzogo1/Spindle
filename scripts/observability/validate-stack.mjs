#!/usr/bin/env node
/**
 * Sanity-check the OPTIONAL observability stack under infra/observability/
 * and the scripts it wraps. Verifies that every referenced file exists,
 * JSON/YAML configs parse, compose services are consistent, Prometheus
 * scrape targets resolve to defined services, and Grafana datasource URLs
 * point at real services.
 *
 * Usage:
 *   node scripts/observability/validate-stack.mjs [--docker]
 *
 * --docker additionally runs `docker compose config` on the overlay when a
 * Docker CLI is available (skipped silently otherwise).
 *
 * Exit codes: 0 ok, 1 problems found, 2 usage error.
 */

import { existsSync, readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const OBS_DIR = resolve(repoRoot, "infra/observability")

const problems = []
const notes = []
const ok = (msg) => console.log(`  ok   ${msg}`)
const fail = (msg) => {
  problems.push(msg)
  console.log(`  FAIL ${msg}`)
}
const note = (msg) => {
  notes.push(msg)
  console.log(`  note ${msg}`)
}

// ---------------------------------------------------------------------------
// File presence
// ---------------------------------------------------------------------------

const REQUIRED_FILES = [
  "infra/observability/compose.observability.yml",
  "infra/observability/loki-config.yaml",
  "infra/observability/prometheus.yml",
  "infra/observability/prometheus/rules/spindle-alerts.yml",
  "infra/observability/grafana/provisioning/datasources/datasources.yaml",
  "scripts/observability/serve-metrics.mjs",
  "scripts/observability/validate-stack.mjs",
  "scripts/logging/ship.mjs",
  "scripts/metrics/log-metrics.mjs",
  "scripts/metrics/log-metrics.config.json",
]

console.log("files:")
for (const rel of REQUIRED_FILES) {
  if (existsSync(resolve(repoRoot, rel))) ok(rel)
  else fail(`missing ${rel}`)
}

// ---------------------------------------------------------------------------
// JSON parse
// ---------------------------------------------------------------------------

console.log("json:")
try {
  const config = JSON.parse(
    readFileSync(resolve(repoRoot, "scripts/metrics/log-metrics.config.json"), "utf8"),
  )
  if (config.version !== 1 || !Array.isArray(config.metrics)) {
    fail("log-metrics.config.json: expected {version:1, metrics:[…]}")
  } else {
    ok(`log-metrics.config.json (${config.metrics.length} metrics)`)
  }
} catch (error) {
  fail(`log-metrics.config.json does not parse: ${error.message}`)
}

// ---------------------------------------------------------------------------
// YAML parse — js-yaml is a transitive dep; use it when resolvable, else skip
// structured checks with a note (file-presence checks above still ran).
// ---------------------------------------------------------------------------

let yaml = null
try {
  const require = createRequire(resolve(repoRoot, "package.json"))
  yaml = require("js-yaml")
} catch {
  yaml = null
}

const loadYaml = (rel) => {
  const text = readFileSync(resolve(repoRoot, rel), "utf8")
  return yaml ? yaml.load(text) : null
}

const serviceNames = (compose) =>
  compose && typeof compose === "object" && compose.services ? Object.keys(compose.services) : []

console.log("yaml:")
if (!yaml) {
  note("js-yaml not resolvable — skipping structured YAML checks")
} else {
  let compose = null
  try {
    compose = loadYaml("infra/observability/compose.observability.yml")
    ok("compose.observability.yml parses")
  } catch (error) {
    fail(`compose.observability.yml does not parse: ${error.message}`)
  }

  let prometheus = null
  try {
    prometheus = loadYaml("infra/observability/prometheus.yml")
    ok("prometheus.yml parses")
  } catch (error) {
    fail(`prometheus.yml does not parse: ${error.message}`)
  }

  try {
    const loki = loadYaml("infra/observability/loki-config.yaml")
    if (!loki?.schema_config?.configs?.length || !loki?.limits_config?.retention_period) {
      fail("loki-config.yaml missing schema_config or retention_period")
    } else {
      ok(`loki-config.yaml (retention ${loki.limits_config.retention_period})`)
    }
  } catch (error) {
    fail(`loki-config.yaml does not parse: ${error.message}`)
  }

  let datasources = null
  try {
    datasources = loadYaml("infra/observability/grafana/provisioning/datasources/datasources.yaml")
    ok("grafana datasources.yaml parses")
  } catch (error) {
    fail(`grafana datasources.yaml does not parse: ${error.message}`)
  }

  try {
    loadYaml("infra/observability/prometheus/rules/spindle-alerts.yml")
    ok("prometheus/rules/spindle-alerts.yml parses")
  } catch (error) {
    fail(`prometheus/rules/spindle-alerts.yml does not parse: ${error.message}`)
  }

  // --- Cross-file consistency -------------------------------------------
  console.log("consistency:")

  const services = serviceNames(compose)
  if (compose?.name !== "spindle-observability") {
    fail(
      `compose project name should be "spindle-observability", got ${JSON.stringify(compose?.name)}`,
    )
  } else {
    ok("compose project is standalone (spindle-observability)")
  }

  const expected = ["loki", "prometheus", "grafana", "log-metrics-exporter"]
  for (const name of expected) {
    if (services.includes(name)) ok(`compose defines ${name}`)
    else fail(`compose missing service ${name}`)
  }

  // Ports must be loopback-only.
  for (const [name, svc] of Object.entries(compose?.services ?? {})) {
    for (const binding of svc.ports ?? []) {
      const published = String(binding).split(":")[0]
      if (published !== "127.0.0.1") {
        fail(`${name} port "${binding}" is not bound to 127.0.0.1`)
      }
    }
  }
  ok("all published ports are 127.0.0.1-only")

  // Prometheus scrape targets must be defined services (or localhost).
  const scrapeTargets = []
  for (const job of prometheus?.scrape_configs ?? []) {
    for (const sc of job.static_configs ?? []) {
      for (const target of sc.targets ?? []) {
        scrapeTargets.push({ job: job.job_name, target })
      }
    }
  }
  for (const { job, target } of scrapeTargets) {
    const host = String(target).split(":")[0]
    if (host === "localhost" || host === "127.0.0.1" || services.includes(host)) {
      ok(`scrape ${job} -> ${target}`)
    } else {
      fail(`scrape job ${job} targets unknown host ${host}`)
    }
  }
  if ((prometheus?.rule_files ?? []).length === 0) {
    note("prometheus.yml has no rule_files")
  }

  // Grafana datasource hosts must be defined services.
  for (const ds of datasources?.datasources ?? []) {
    const host = String(ds.url ?? "")
      .replace(/^https?:\/\//, "")
      .split("/")[0]
      .split(":")[0]
    if (services.includes(host)) ok(`datasource ${ds.name} -> ${ds.url}`)
    else fail(`datasource ${ds.name} url ${ds.url} does not resolve to a compose service`)
  }
}

// ---------------------------------------------------------------------------
// Optional: docker compose config
// ---------------------------------------------------------------------------

console.log("docker:")
const wantDocker = process.argv.includes("--docker")
if (!wantDocker) {
  note("skipped docker compose config (pass --docker to enable)")
} else {
  try {
    execFileSync("docker", ["compose", "-f", "compose.observability.yml", "config", "--quiet"], {
      cwd: OBS_DIR,
      stdio: "pipe",
      timeout: 30_000,
    })
    ok("docker compose config --quiet")
  } catch (error) {
    if (error.code === "ENOENT") {
      note("docker CLI not available — skipped")
    } else {
      const detail = String(error.stderr ?? error.message)
        .trim()
        .slice(0, 500)
      fail(`docker compose config failed: ${detail}`)
    }
  }
}

// ---------------------------------------------------------------------------

console.log("")
if (problems.length > 0) {
  console.error(`validate-stack: ${problems.length} problem(s) found`)
  process.exitCode = 1
} else {
  console.log("validate-stack: all checks passed")
  process.exitCode = 0
}
