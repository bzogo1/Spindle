#!/usr/bin/env node
// Preflight validation for the staging deploy pipeline. Runs in CI with no
// cloud credentials and no npm install: plain Node, repository files only.
//
//   node scripts/deploy/validate-config.mjs
//
// Checks:
//   1. Every file the deploy workflow uploads exists.
//   2. Every variable compose.yaml requires is documented in the staging
//      host.env.example (the host file itself lives on the server).
//   3. Every GitHub secret/variable the workflow consumes is listed in
//      REQUIRED_SECRETS / REQUIRED_VARS below, so docs and code cannot drift.
//   4. The default smoke-test paths resolve to real App Router routes.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const root = process.cwd()
const read = (file) => readFileSync(join(root, file), "utf8")

const failures = []
const notes = []

function check(condition, message) {
  if (condition) {
    notes.push(`ok    ${message}`)
  } else {
    failures.push(message)
    console.error(`FAIL  ${message}`)
  }
}

// --- 1. Files the workflow uploads -------------------------------------------

const REQUIRED_FILES = [
  "infra/origin/compose.yaml",
  "infra/staging/cloudflared/config.yml",
  "infra/staging/host.env.example",
  "scripts/deploy/remote-deploy.sh",
  "scripts/deploy/smoke-test.mjs",
]

for (const file of REQUIRED_FILES) {
  check(existsSync(join(root, file)), `required file present: ${file}`)
}

const composePath = join(root, "infra/origin/compose.yaml")
const envExamplePath = join(root, "infra/staging/host.env.example")
const workflowPath = join(root, ".github/workflows/deploy-staging.yml")

if (!existsSync(composePath) || !existsSync(envExamplePath) || !existsSync(workflowPath)) {
  console.error("validate-config: cannot continue, required inputs are missing")
  process.exit(1)
}

// --- 2. Compose variables vs host.env.example --------------------------------

const compose = read("infra/origin/compose.yaml")
const envExample = read("infra/staging/host.env.example")

// `${VAR:?msg}` is mandatory; `${VAR:-default}` has a fallback but is still
// documented for operators. `${VAR}` bare interpolation is treated as optional.
const requiredVars = new Set()
const documentedVars = new Set()
for (const match of compose.matchAll(/\$\{([A-Z][A-Z0-9_]*):\?[^}]*\}/g)) {
  requiredVars.add(match[1])
}
for (const match of envExample.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)) {
  documentedVars.add(match[1])
}

for (const name of [...requiredVars].sort()) {
  check(
    documentedVars.has(name),
    `compose-required variable documented in host.env.example: ${name}`,
  )
}

// SPINDLE_APP_IMAGE / SPINDLE_WORKER_IMAGE are injected per deploy, not stored.
for (const injected of ["SPINDLE_APP_IMAGE", "SPINDLE_WORKER_IMAGE"]) {
  check(
    envExample.includes(`${injected}=`),
    `deploy-injected variable present in host.env.example: ${injected}`,
  )
}

// --- 3. Workflow secrets/vars coverage ----------------------------------------

const REQUIRED_SECRETS = ["STAGING_HOST", "STAGING_USER", "STAGING_SSH_KEY", "STAGING_KNOWN_HOSTS"]
const REQUIRED_VARS = ["STAGING_APP_IMAGE", "STAGING_WORKER_IMAGE", "STAGING_URL"]

const workflow = read(".github/workflows/deploy-staging.yml")
const referencedSecrets = new Set(
  [...workflow.matchAll(/secrets\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]),
)
const referencedVars = new Set([...workflow.matchAll(/vars\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]))

for (const name of REQUIRED_SECRETS) {
  check(referencedSecrets.has(name), `workflow consumes required secret: ${name}`)
}
for (const name of REQUIRED_VARS) {
  check(referencedVars.has(name), `workflow consumes required variable: ${name}`)
}

// Every referenced name must be documented in docs/deploy/README.md.
const docsPath = join(root, "docs/deploy/README.md")
if (existsSync(docsPath)) {
  const docs = read("docs/deploy/README.md")
  for (const name of [...referencedSecrets, ...referencedVars]) {
    check(docs.includes(`\`${name}\``), `docs/deploy/README.md documents ${name}`)
  }
} else {
  notes.push("note  docs/deploy/README.md not present yet; secret documentation check skipped")
}

// --- 4. Smoke-test paths resolve to real routes -------------------------------

const appDir = join(root, "src/app")
const smokeSource = read("scripts/deploy/smoke-test.mjs")
const defaultPathsMatch = smokeSource.match(/DEFAULT_PATHS = "([^"]+)"/)
check(defaultPathsMatch !== null, "smoke-test.mjs exposes DEFAULT_PATHS")

const routes = new Set()
function collectRoutes(dir, segments) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue
    const absolute = join(dir, entry)
    if (!statSync(absolute).isDirectory()) continue
    // Route groups `(name)` do not contribute a path segment.
    const isGroup = entry.startsWith("(") && entry.endsWith(")")
    const next = isGroup ? segments : [...segments, entry]
    if (existsSync(join(absolute, "page.tsx")) || existsSync(join(absolute, "route.ts"))) {
      const route = `/${next.join("/")}`.replace(/\/+$/, "") || "/"
      routes.add(route === "" ? "/" : route)
    }
    collectRoutes(absolute, next)
  }
}
if (existsSync(appDir)) collectRoutes(appDir, [])

if (defaultPathsMatch) {
  for (const entry of defaultPathsMatch[1].split(",")) {
    const path = entry.split("=")[0]
    check(routes.has(path), `smoke path resolves to an app route: ${path}`)
  }
}

// --- Summary ------------------------------------------------------------------

for (const note of notes) console.log(note)
if (failures.length > 0) {
  console.error(`validate-config: ${failures.length} check(s) failed`)
  process.exit(1)
}
console.log(`validate-config: all checks passed (${notes.length} ok)`)
