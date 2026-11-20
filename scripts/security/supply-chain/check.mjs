#!/usr/bin/env node
// Supply-chain hygiene check. Audits GitHub Actions pinning, dependency
// specifiers in package.json, lockfile presence, container image pinning in
// compose files, and npm lifecycle-script exposure. Runs with plain node and
// no dependencies so it works on a fresh checkout and inside CI before
// `npm ci`.
//
// Usage:
//   node scripts/security/supply-chain/check.mjs [--demo] [--json] [--ci] [--strict]
//
// Exit codes:
//   0  no error-severity findings (warnings are advisory unless --strict)
//   1  at least one error-severity finding, or any finding with --strict
//   2  usage error
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"

const SHA_RE = /^[0-9a-f]{40}$/i
const LOCKFILES = ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "bun.lockb"]
const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 }

function parseArgs(argv) {
  const args = { demo: false, json: false, ci: false, strict: false, help: false }
  for (const arg of argv) {
    if (arg === "--demo") args.demo = true
    else if (arg === "--json") args.json = true
    else if (arg === "--ci") args.ci = true
    else if (arg === "--strict") args.strict = true
    else if (arg === "--help" || arg === "-h") args.help = true
    else {
      console.error(`Unknown argument: ${arg}`)
      process.exit(2)
    }
  }
  return args
}

function finding(severity, check, file, message, line) {
  return { severity, check, file, line, message }
}

// ---------- checks ----------

function checkWorkflows(root, findings) {
  const dir = join(root, ".github", "workflows")
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) {
    if (!/\.ya?ml$/.test(name)) continue
    const file = `.github/workflows/${name}`
    const lines = readFileSync(join(dir, name), "utf8").split("\n")
    lines.forEach((text, index) => {
      if (text.trimStart().startsWith("#")) return // YAML comment — not a step
      const match = /^\s*-?\s*uses:\s*([^\s#]+)/.exec(text)
      if (!match) return
      const ref = match[1]
      // Local composite actions and Docker actions are out of scope.
      if (ref.startsWith("./") || ref.startsWith("../") || ref.startsWith("docker://")) return
      const at = ref.lastIndexOf("@")
      const pinned = at > 0 && SHA_RE.test(ref.slice(at + 1))
      if (!pinned) {
        const tag = at > 0 ? ref.slice(at + 1) : "(no ref)"
        findings.push(
          finding(
            "warning",
            "actions-pinned",
            file,
            `action '${ref}' is pinned to mutable tag '${tag}', not a commit SHA — a retagged or compromised release would execute in CI`,
            index + 1,
          ),
        )
      }
    })
  }
}

function checkPackageJson(root, findings) {
  const file = "package.json"
  const path = join(root, file)
  if (!existsSync(path)) return
  let pkg
  try {
    pkg = JSON.parse(readFileSync(path, "utf8"))
  } catch {
    findings.push(finding("error", "package-json", file, "package.json is not valid JSON"))
    return
  }

  const sections = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]
  const ranged = []
  const nonRegistry = []
  let exact = 0
  let total = 0

  for (const section of sections) {
    const deps = pkg[section]
    if (!deps || typeof deps !== "object") continue
    for (const [name, spec] of Object.entries(deps)) {
      total += 1
      if (typeof spec !== "string") continue
      // Non-registry sources (git, http, file:, link:, workspace:) bypass the
      // registry and the lockfile's integrity guarantees in different ways.
      if (
        /^(git\+|git:|github:|gitlab:|bitbucket:|https?:|file:|link:|workspace:)/.test(spec) ||
        spec === "*"
      ) {
        nonRegistry.push(`${name}@${spec}`)
        continue
      }
      if (/^[\d.]+$/.test(spec) || /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(spec)) {
        exact += 1
      } else {
        ranged.push(`${name}@${spec}`)
      }
    }
  }

  for (const dep of nonRegistry) {
    findings.push(
      finding(
        "error",
        "dependency-pinning",
        file,
        `dependency '${dep}' is not a registry semver spec — pin to an exact version and verify provenance`,
      ),
    )
  }
  if (ranged.length > 0) {
    const shown = ranged.slice(0, 10).join(", ")
    const more = ranged.length > 10 ? `, +${ranged.length - 10} more` : ""
    findings.push(
      finding(
        "warning",
        "dependency-pinning",
        file,
        `${ranged.length} of ${total} dependency specifiers use mutable ranges (^, ~, >=, etc.); only ${exact} are exact pins. Examples: ${shown}${more}`,
      ),
    )
  }

  // Lifecycle scripts run arbitrary code on `npm ci`/`npm install` unless the
  // CI job passes --ignore-scripts. Report which ones exist; the doc explains
  // the current mixed posture.
  const lifecycle = ["preinstall", "install", "postinstall", "prepublish", "prepare", "prepack"]
  const present = lifecycle.filter((key) => typeof pkg.scripts?.[key] === "string")
  if (present.length > 0) {
    findings.push(
      finding(
        "info",
        "lifecycle-scripts",
        file,
        `lifecycle scripts present (${present.join(", ")}) — they execute on npm ci unless the job uses --ignore-scripts`,
      ),
    )
  }
}

function checkLockfile(root, findings) {
  const present = LOCKFILES.filter((name) => existsSync(join(root, name)))
  if (present.length === 0) {
    findings.push(
      finding(
        "error",
        "lockfile",
        "(repo root)",
        "no lockfile found (package-lock.json / yarn.lock / pnpm-lock.yaml / bun.lock) — builds are not reproducible",
      ),
    )
    return
  }
  if (existsSync(join(root, "package-lock.json"))) {
    try {
      const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"))
      if (typeof lock.lockfileVersion !== "number") {
        findings.push(
          finding(
            "warning",
            "lockfile",
            "package-lock.json",
            "package-lock.json has no numeric lockfileVersion",
          ),
        )
      }
    } catch {
      findings.push(
        finding("error", "lockfile", "package-lock.json", "package-lock.json is not valid JSON"),
      )
    }
  }
}

function checkWorkflowsForInstall(root, findings) {
  const dir = join(root, ".github", "workflows")
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) {
    if (!/\.ya?ml$/.test(name)) continue
    const file = `.github/workflows/${name}`
    const lines = readFileSync(join(dir, name), "utf8").split("\n")
    lines.forEach((text, index) => {
      if (text.trimStart().startsWith("#")) return // YAML comment — not a command
      // `npm install` resolves fresh ranges at run time; `npm ci` honours the
      // lockfile. Flags bare `npm install` invocations (not `npm ci`).
      if (/\bnpm\s+install\b/.test(text) && !/\bnpm\s+ci\b/.test(text)) {
        findings.push(
          finding(
            "warning",
            "lockfile",
            file,
            "workflow runs `npm install` — prefer `npm ci` so the lockfile is authoritative",
            index + 1,
          ),
        )
      }
    })
  }
}

function checkComposeImages(root, findings) {
  const candidates = []
  // Only scan known locations to stay fast and avoid vendored trees.
  for (const sub of [".", "infra"]) {
    const base = join(root, sub)
    if (!existsSync(base)) continue
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory() && /^compose.*\.ya?ml$|^docker-compose.*\.ya?ml$/.test(entry.name)) {
        candidates.push(join(base, entry.name))
      }
      if (entry.isDirectory() && sub === "infra") {
        for (const nested of readdirSync(join(base, entry.name), { withFileTypes: true })) {
          if (
            !nested.isDirectory() &&
            /compose.*\.ya?ml$|docker-compose.*\.ya?ml$/.test(nested.name)
          ) {
            candidates.push(join(base, entry.name, nested.name))
          }
        }
      }
    }
  }

  for (const abs of new Set(candidates)) {
    const file = relative(root, abs)
    const lines = readFileSync(abs, "utf8").split("\n")
    lines.forEach((text, index) => {
      const match = /^\s*image:\s*(.+?)\s*$/.exec(text)
      if (!match) return
      const image = match[1].replace(/^["']|["']$/g, "")
      if (image.includes("@sha256:")) return // digest-pinned
      if (image.startsWith("${") || image.includes(":${")) {
        findings.push(
          finding(
            "info",
            "container-images",
            file,
            `image '${image}' is pinned indirectly via environment variable — the deploy pipeline must supply a digest or immutable tag`,
            index + 1,
          ),
        )
        return
      }
      findings.push(
        finding(
          "warning",
          "container-images",
          file,
          `image '${image}' uses a mutable tag — pin to '@sha256:<digest>' so a retagged upstream image cannot change what runs`,
          index + 1,
        ),
      )
    })
  }
}

function checkNpmrc(root, findings) {
  const path = join(root, ".npmrc")
  if (!existsSync(path)) return
  const lines = readFileSync(path, "utf8").split("\n")
  lines.forEach((text, index) => {
    const match = /^\s*([^#=\s]+)\s*=\s*(.+)$/.exec(text)
    if (!match) return
    const [, key, value] = match
    if (key === "registry" || key.endsWith(":registry")) {
      findings.push(
        finding(
          "warning",
          "npmrc",
          ".npmrc",
          `custom registry '${value.trim()}' redirects package downloads — verify it is an intended mirror with its own integrity guarantees`,
          index + 1,
        ),
      )
    }
    if (key === "ignore-scripts" && value.trim() === "false") {
      findings.push(
        finding(
          "warning",
          "npmrc",
          ".npmrc",
          "ignore-scripts=false re-enables lifecycle scripts for all installs",
          index + 1,
        ),
      )
    }
  })
}

// ---------- demo fixtures ----------

function writeDemoFixture(dir) {
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true })
  writeFileSync(
    join(dir, ".github", "workflows", "demo.yml"),
    [
      "name: demo",
      "on: [push]",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - uses: actions/setup-node@11d5960a326750d5838078e36cf38b85af677262 # v4 — good",
      "      - run: npm install",
    ].join("\n"),
  )
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: "demo",
        dependencies: {
          react: "^19.0.0",
          leftpad: "1.3.0",
          evil: "git+https://example.com/evil.git",
        },
        scripts: { postinstall: "node scripts/setup.mjs" },
      },
      null,
      2,
    ),
  )
  writeFileSync(join(dir, "compose.yaml"), "services:\n  db:\n    image: postgres:17\n")
}

// ---------- driver ----------

function scan(root) {
  const findings = []
  checkWorkflows(root, findings)
  checkPackageJson(root, findings)
  checkLockfile(root, findings)
  checkWorkflowsForInstall(root, findings)
  checkComposeImages(root, findings)
  checkNpmrc(root, findings)
  findings.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9))
  const summary = {
    errors: findings.filter((f) => f.severity === "error").length,
    warnings: findings.filter((f) => f.severity === "warning").length,
    info: findings.filter((f) => f.severity === "info").length,
  }
  return { findings, summary }
}

function printHuman(report) {
  const { findings, summary } = report
  for (const f of findings) {
    const loc = f.line ? `${f.file}:${f.line}` : f.file
    console.log(`${f.severity.toUpperCase().padEnd(7)} [${f.check}] ${loc} — ${f.message}`)
  }
  console.log(
    `\nSupply-chain check: ${summary.errors} error(s), ${summary.warnings} warning(s), ${summary.info} info finding(s) across ${findings.length} item(s).`,
  )
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(
      "Usage: node scripts/security/supply-chain/check.mjs [--demo] [--json] [--ci] [--strict]",
    )
    process.exit(0)
  }

  let root = process.cwd()
  let cleanup = null
  if (args.demo) {
    root = mkdtempSync(join(tmpdir(), "spindle-supply-chain-demo-"))
    writeDemoFixture(root)
    cleanup = () => rmSync(root, { recursive: true, force: true })
  }

  const report = scan(root)
  if (args.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    printHuman(report)
  }

  if (args.ci && !args.json) {
    for (const f of report.findings) {
      const level =
        f.severity === "error" ? "error" : f.severity === "warning" ? "warning" : "notice"
      const loc = f.line ? `${f.file}:${f.line}` : f.file
      console.log(
        `::${level} file=${f.file}${f.line ? `,line=${f.line}` : ""},title=supply-chain/${f.check}::${f.message} (${loc})`,
      )
    }
  }

  cleanup?.()

  const strict = args.strict
  const failed = report.summary.errors > 0 || (strict && report.findings.length > 0)
  process.exit(failed ? 1 : 0)
}

main()
