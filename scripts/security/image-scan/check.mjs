#!/usr/bin/env node
// Container image reference checker. Verifies that image references are
// digest-pinned and flags mutable tags, then optionally delegates
// vulnerability scanning to an installed scanner (trivy or grype).
//
// This repo has no Dockerfiles: app/worker images are built and pushed by an
// external pipeline (DEV-9/DEV-10) and referenced indirectly through compose
// env vars (SPINDLE_APP_IMAGE, SPINDLE_WORKER_IMAGE). The checker therefore
// works on *references*, not on built images: it inspects compose files,
// env files, and explicit refs — and only shells out to a vulnerability
// scanner when one is installed and --scanner is passed.
//
// Dependency-free node so it runs on a fresh checkout and inside CI before
// `npm ci`. Never touches process.env — all inputs come from flags and files.
//
// Usage:
//   node scripts/security/image-scan/check.mjs [options] [ref ...]
//
// Options:
//   --image <ref>        Add an image reference (repeatable; commas allowed)
//   --compose <path>     Compose file to scan for `image:` lines (repeatable;
//                        defaults to compose*.yml / docker-compose*.yml in the
//                        repo root and infra/)
//   --env-file <path>    KEY=VALUE file; *_IMAGE vars are checked as refs and
//                        ${VAR} compose indirections are resolved through it
//                        (repeatable)
//   --scanner <name>     Vulnerability scanner: trivy, grype, or auto
//                        (auto = trivy then grype). Off by default.
//   --demo               Scan built-in fixture refs (always exits 1)
//   --json               Machine-readable report
//   --ci                 GitHub Actions annotations (::error/::warning/::notice)
//   --strict             Any finding fails (exit 1), not just errors
//   --help, -h           Usage
//
// Exit codes:
//   0  no error-severity findings (warnings/info are advisory unless --strict)
//   1  at least one error-severity finding, or any finding with --strict
//   2  usage error
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join, relative } from "node:path"
import { spawnSync } from "node:child_process"

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/
const ENV_REF_RE = /^\$\{([A-Za-z_][A-Za-z0-9_]*)[:?+-].*\}$|^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/
const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 }

function parseArgs(argv) {
  const args = {
    refs: [],
    composes: [],
    envFiles: [],
    scanner: null,
    demo: false,
    json: false,
    ci: false,
    strict: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const takeValue = (flag) => {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith("--")) {
        console.error(`${flag} requires a value`)
        process.exit(2)
      }
      i += 1
      return next
    }
    if (arg === "--image") args.refs.push(...takeValue(arg).split(","))
    else if (arg === "--compose") args.composes.push(takeValue(arg))
    else if (arg === "--env-file") args.envFiles.push(takeValue(arg))
    else if (arg === "--scanner") {
      const value = takeValue(arg)
      if (!["trivy", "grype", "auto"].includes(value)) {
        console.error(`Unknown scanner: ${value} (expected trivy, grype, or auto)`)
        process.exit(2)
      }
      args.scanner = value
    } else if (arg === "--demo") args.demo = true
    else if (arg === "--json") args.json = true
    else if (arg === "--ci") args.ci = true
    else if (arg === "--strict") args.strict = true
    else if (arg === "--help" || arg === "-h") args.help = true
    else if (arg.startsWith("--image=")) args.refs.push(...arg.slice("--image=".length).split(","))
    else if (arg.startsWith("--compose=")) args.composes.push(arg.slice("--compose=".length))
    else if (arg.startsWith("--env-file=")) args.envFiles.push(arg.slice("--env-file=".length))
    else if (arg.startsWith("--scanner=")) {
      const value = arg.slice("--scanner=".length)
      if (!["trivy", "grype", "auto"].includes(value)) {
        console.error(`Unknown scanner: ${value} (expected trivy, grype, or auto)`)
        process.exit(2)
      }
      args.scanner = value
    } else if (arg.startsWith("--")) {
      console.error(`Unknown argument: ${arg}`)
      process.exit(2)
    } else {
      args.refs.push(arg)
    }
  }
  args.refs = args.refs.map((r) => r.trim()).filter(Boolean)
  return args
}

function finding(severity, check, source, message) {
  return { severity, check, source, message }
}

// ---------- reference classification ----------

// Returns { kind: "digest" | "indirect" | "tagged" | "untagged" | "invalid", ... }
function classifyRef(ref) {
  if (/^\$\{[^}]+\}$/.test(ref)) return { kind: "indirect", varName: envVarName(ref) }
  if (ref.includes("@")) {
    const at = ref.lastIndexOf("@")
    const digest = ref.slice(at + 1)
    if (!DIGEST_RE.test(digest)) {
      return { kind: "invalid", reason: `digest '${digest}' is not sha256:<64 hex>` }
    }
    return { kind: "digest", name: ref.slice(0, at), digest }
  }
  // Compose-style interpolation in the tag position, e.g. repo/app:${TAG}
  // or repo/app:${TAG:-latest}. The ':' inside '${...:-...}' can be the last
  // colon in the ref, so detect interpolation before splitting tag/digest.
  const afterSlash = ref.slice(ref.lastIndexOf("/") + 1)
  const interpStart = afterSlash.indexOf("${")
  if (interpStart >= 0 && afterSlash.slice(0, interpStart).endsWith(":")) {
    const braceEnd = afterSlash.indexOf("}", interpStart)
    const inner = afterSlash.slice(interpStart + 2, braceEnd === -1 ? undefined : braceEnd)
    // ${VAR:-default} / ${VAR-default} carry a usable default; ${VAR:?msg}
    // and ${VAR+alt} do not.
    const nameMatch = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(inner)
    const name = nameMatch ? nameMatch[1] : inner
    const rest = inner.slice(name.length)
    const fallback = rest.startsWith(":-")
      ? rest.slice(2)
      : rest.startsWith("-")
        ? rest.slice(1)
        : null
    const prefixEnd = ref.lastIndexOf("/") + 1 + interpStart - 1 // drop the ':'
    return { kind: "indirect", varName: name, raw: ref, prefix: ref.slice(0, prefixEnd), fallback }
  }
  // Tag = last ':' after the last '/'; a ':' before any '/' is a port.
  const lastSlash = ref.lastIndexOf("/")
  const lastColon = ref.lastIndexOf(":")
  if (lastColon > lastSlash) {
    const tag = ref.slice(lastColon + 1)
    if (!/^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(tag)) {
      return { kind: "invalid", reason: `tag '${tag}' contains invalid characters` }
    }
    return { kind: "tagged", name: ref.slice(0, lastColon), tag }
  }
  if (!ref || ref.includes(":")) return { kind: "invalid", reason: "unparseable reference" }
  return { kind: "untagged", name: ref }
}

function envVarName(indirect) {
  const match = ENV_REF_RE.exec(indirect)
  return match ? match[1] || match[2] : null
}

function envDefault(indirect) {
  // ${VAR:-default} / ${VAR-default} carry a usable default; ${VAR:?msg} and
  // ${VAR+alt} do not.
  const match = /^\$\{[A-Za-z_][A-Za-z0-9_]*(?::-(.*)|-(.*))\}$/.exec(indirect)
  return match ? (match[1] ?? match[2]) : null
}

function checkRef(ref, source, findings) {
  const cls = classifyRef(ref)
  switch (cls.kind) {
    case "digest":
      // Fully pinned — no finding. Counted in the summary as pinned.
      return { pinned: true }
    case "indirect": {
      const fallback = cls.fallback ?? envDefault(ref) ?? envDefault(cls.raw ?? ref)
      if (fallback) {
        findings.push(
          finding(
            "info",
            "indirect-pin",
            source,
            `image '${ref}' is indirect via env var '${cls.varName}' with default '${fallback}' — supply a digest pin through the env file`,
          ),
        )
      } else {
        findings.push(
          finding(
            "info",
            "indirect-pin",
            source,
            `image '${ref}' is indirect via env var '${cls.varName}' — the deploy pipeline must supply 'repo:tag@sha256:<digest>'`,
          ),
        )
      }
      return { pinned: false }
    }
    case "tagged":
      if (cls.tag === "latest") {
        findings.push(
          finding(
            "error",
            "mutable-tag",
            source,
            `image '${ref}' uses ':latest' — pin to '@sha256:<digest>'`,
          ),
        )
      } else {
        findings.push(
          finding(
            "warning",
            "mutable-tag",
            source,
            `image '${ref}' uses mutable tag ':${cls.tag}' — add '@sha256:<digest>' so a retagged image cannot change what runs`,
          ),
        )
      }
      return { pinned: false }
    case "untagged":
      findings.push(
        finding(
          "error",
          "mutable-tag",
          source,
          `image '${ref}' has no tag — it resolves to ':latest'; pin to '@sha256:<digest>'`,
        ),
      )
      return { pinned: false }
    case "invalid":
      findings.push(
        finding(
          "warning",
          "invalid-ref",
          source,
          `image '${ref}' could not be parsed: ${cls.reason}`,
        ),
      )
      return { pinned: false }
    default:
      return { pinned: false }
  }
}

// ---------- input collection ----------

function collectComposeFiles(root, explicit) {
  const files = []
  if (explicit.length > 0) {
    return explicit.map((p) => {
      const abs = p.startsWith("/") ? p : join(root, p)
      if (!existsSync(abs)) {
        console.error(`compose file not found: ${p}`)
        process.exit(2)
      }
      return { path: abs, display: p }
    })
  }
  const seen = new Set()
  const add = (abs, display) => {
    if (!existsSync(abs) || seen.has(abs)) return
    seen.add(abs)
    files.push({ path: abs, display })
  }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && /^(docker-)?compose.*\.ya?ml$/.test(entry.name)) {
      add(join(root, entry.name), entry.name)
    }
  }
  const infra = join(root, "infra")
  if (existsSync(infra)) {
    for (const entry of readdirSync(infra, { withFileTypes: true })) {
      const dir = join(infra, entry.name)
      if (entry.isDirectory()) {
        for (const nested of readdirSync(dir, { withFileTypes: true })) {
          if (nested.isFile() && /compose.*\.ya?ml$|docker-compose.*\.ya?ml$/.test(nested.name)) {
            add(join(dir, nested.name), relative(root, join(dir, nested.name)))
          }
        }
      } else if (entry.isFile() && /compose.*\.ya?ml$/.test(entry.name)) {
        add(join(infra, entry.name), relative(root, join(infra, entry.name)))
      }
    }
  }
  return files
}

function refsFromCompose(file) {
  const refs = []
  const lines = readFileSync(file.path, "utf8").split("\n")
  lines.forEach((text, index) => {
    const match = /^\s*image:\s*(.+?)\s*$/.exec(text)
    if (!match) return
    const image = match[1].replace(/^["']|["']$/g, "")
    refs.push({ ref: image, source: `${file.display}:${index + 1}` })
  })
  return refs
}

function refsFromEnvFile(path, display) {
  const refs = []
  const lines = readFileSync(path, "utf8").split("\n")
  lines.forEach((text, index) => {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/.exec(text)
    if (!match) return
    const [, key, raw] = match
    if (!/IMAGE/i.test(key)) return
    const value = raw.replace(/^["']|["']$/g, "")
    if (!value || value.startsWith("#")) return
    refs.push({ ref: value, source: `${display}:${index + 1}` })
  })
  return refs
}

// Resolve ${VAR} compose indirections through collected env-file values.
// Returns a map varName -> { value, source }.
function envLookup(envFiles) {
  const map = new Map()
  for (const file of envFiles) {
    const display = relative(process.cwd(), file) || file
    const lines = readFileSync(file, "utf8").split("\n")
    lines.forEach((text, index) => {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/.exec(text)
      if (!match) return
      const value = match[2].replace(/^["']|["']$/g, "")
      if (!map.has(match[1])) map.set(match[1], { value, source: `${display}:${index + 1}` })
    })
  }
  return map
}

function collectInputs(root, args) {
  const refs = []
  for (const r of args.refs) refs.push({ ref: r, source: "cli" })

  for (const file of collectComposeFiles(root, args.composes)) {
    refs.push(...refsFromCompose(file))
  }

  const envFiles = []
  for (const p of args.envFiles) {
    const abs = p.startsWith("/") ? p : join(root, p)
    if (!existsSync(abs)) {
      console.error(`env file not found: ${p}`)
      process.exit(2)
    }
    envFiles.push(abs)
    refs.push(...refsFromEnvFile(abs, p))
  }
  const lookup = envLookup(envFiles)

  // Resolve indirect refs where an env file supplies the value.
  const resolved = []
  for (const entry of refs) {
    const cls = classifyRef(entry.ref)
    if (cls.kind !== "indirect" || !cls.varName) {
      resolved.push(entry)
      continue
    }
    const hit = lookup.get(cls.varName)
    const value = hit && hit.value && !hit.value.startsWith("$") ? hit.value : null
    if (cls.prefix) {
      // Tag-position interpolation: repo/app:${TAG} — the env value is a tag,
      // unless it is itself a full reference.
      const tagValue = value ?? cls.fallback ?? null
      if (tagValue) {
        const looksLikeRef = tagValue.includes("/") || tagValue.includes("@")
        resolved.push({
          ref: looksLikeRef ? tagValue : `${cls.prefix}:${tagValue}`,
          source: `${entry.source} (via ${cls.varName}${hit ? ` @ ${hit.source}` : " default"})`,
        })
      } else {
        resolved.push(entry)
      }
      continue
    }
    const replacement = value ?? envDefault(entry.ref) ?? envDefault(cls.raw ?? entry.ref)
    if (replacement) {
      resolved.push({
        ref: replacement,
        source: value ? `${entry.source} (via ${cls.varName} @ ${hit.source})` : entry.source,
      })
    } else {
      resolved.push(entry)
    }
  }
  return resolved
}

// ---------- optional vulnerability scanner ----------

function which(cmd) {
  const probe = spawnSync(cmd, ["--version"], { encoding: "utf8" })
  return probe.error ? null : cmd
}

function pickScanner(name) {
  if (name === "trivy") return which("trivy") ? "trivy" : null
  if (name === "grype") return which("grype") ? "grype" : null
  // auto
  if (which("trivy")) return "trivy"
  if (which("grype")) return "grype"
  return null
}

function scanWithTrivy(ref) {
  const run = spawnSync(
    "trivy",
    [
      "image",
      "--quiet",
      "--format",
      "json",
      "--scanners",
      "vuln",
      "--severity",
      "HIGH,CRITICAL",
      ref,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
  if (run.error || run.status === null) {
    return { ok: false, error: run.error ? run.error.message : "trivy did not exit" }
  }
  let counts = { HIGH: 0, CRITICAL: 0 }
  try {
    const report = JSON.parse(run.stdout)
    for (const result of report.Results ?? []) {
      for (const vuln of result.Vulnerabilities ?? []) {
        if (vuln.Severity === "HIGH") counts.HIGH += 1
        else if (vuln.Severity === "CRITICAL") counts.CRITICAL += 1
      }
    }
  } catch {
    return { ok: false, error: "trivy JSON output could not be parsed" }
  }
  return { ok: true, counts }
}

function scanWithGrype(ref) {
  const run = spawnSync("grype", ["-o", "json", ref], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
  if (run.error || run.status === null) {
    return { ok: false, error: run.error ? run.error.message : "grype did not exit" }
  }
  let counts = { HIGH: 0, CRITICAL: 0 }
  try {
    const report = JSON.parse(run.stdout)
    for (const match of report.matches ?? []) {
      const severity = match.vulnerability?.severity
      if (severity === "High") counts.HIGH += 1
      else if (severity === "Critical") counts.CRITICAL += 1
    }
  } catch {
    return { ok: false, error: "grype JSON output could not be parsed" }
  }
  return { ok: true, counts }
}

function runScanner(scanner, ref, source, findings) {
  const result = scanner === "trivy" ? scanWithTrivy(ref) : scanWithGrype(ref)
  if (!result.ok) {
    findings.push(
      finding(
        "warning",
        "scanner-error",
        source,
        `${scanner} could not scan '${ref}' (${result.error}) — registry access or scanner setup may be missing`,
      ),
    )
    return
  }
  const { HIGH: high, CRITICAL: critical } = result.counts
  if (critical > 0) {
    findings.push(
      finding(
        "error",
        "vulnerabilities",
        source,
        `${scanner} found ${critical} CRITICAL and ${high} HIGH vulnerability(ies) in '${ref}'`,
      ),
    )
  } else if (high > 0) {
    findings.push(
      finding(
        "warning",
        "vulnerabilities",
        source,
        `${scanner} found ${high} HIGH vulnerability(ies) in '${ref}'`,
      ),
    )
  }
}

// ---------- demo fixtures ----------

const DEMO_REFS = [
  {
    ref: "ghcr.io/spindle/app@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    source: "demo:1",
  },
  { ref: "ghcr.io/spindle/app:latest", source: "demo:2" },
  { ref: "postgres:17-alpine", source: "demo:3" },
  { ref: "valkey/valkey:8-alpine", source: "demo:4" },
  { ref: "postgres", source: "demo:5" },
  { ref: "ghcr.io/spindle/app:${IMAGE_TAG:-SET_BY_DEPLOY}", source: "demo:6" },
  { ref: "ghcr.io/spindle/app@sha256:nothex", source: "demo:7" },
]

// ---------- driver ----------

function scan(root, args) {
  const findings = []
  let pinned = 0
  let total = 0

  let inputs
  if (args.demo) {
    inputs = DEMO_REFS.map((r) => ({ ...r }))
  } else {
    inputs = collectInputs(root, args)
  }

  for (const entry of inputs) {
    total += 1
    const result = checkRef(entry.ref, entry.source, findings)
    if (result.pinned) pinned += 1
  }

  // Vulnerability scanning is opt-in and skipped for demo fixtures (the refs
  // are synthetic and would only produce scanner errors).
  const scannerName = args.scanner && !args.demo ? pickScanner(args.scanner) : null
  if (args.scanner && !args.demo && !scannerName) {
    findings.push(
      finding(
        "info",
        "scanner-unavailable",
        "scanner",
        `--scanner ${args.scanner} requested but no compatible scanner is installed — install trivy or grype, or drop the flag`,
      ),
    )
  }
  if (scannerName) {
    for (const entry of inputs) {
      if (classifyRef(entry.ref).kind !== "indirect") {
        runScanner(scannerName, entry.ref, entry.source, findings)
      }
    }
  }

  findings.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9))
  const summary = {
    total,
    pinned,
    errors: findings.filter((f) => f.severity === "error").length,
    warnings: findings.filter((f) => f.severity === "warning").length,
    info: findings.filter((f) => f.severity === "info").length,
    scanner: scannerName ?? (args.scanner ? `${args.scanner} (unavailable)` : "off"),
  }
  return { findings, summary }
}

function printHuman(report) {
  const { findings, summary } = report
  for (const f of findings) {
    console.log(`${f.severity.toUpperCase().padEnd(7)} [${f.check}] ${f.source} — ${f.message}`)
  }
  console.log(
    `\nImage-scan check: ${summary.pinned}/${summary.total} ref(s) digest-pinned; ` +
      `${summary.errors} error(s), ${summary.warnings} warning(s), ${summary.info} info finding(s). ` +
      `Scanner: ${summary.scanner}.`,
  )
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(
      "Usage: node scripts/security/image-scan/check.mjs [--image <ref>] [--compose <path>] [--env-file <path>] [--scanner trivy|grype|auto] [--demo] [--json] [--ci] [--strict] [ref ...]",
    )
    process.exit(0)
  }

  const root = process.cwd()
  const report = scan(root, args)
  if (args.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    printHuman(report)
  }

  if (args.ci) {
    for (const f of report.findings) {
      const level =
        f.severity === "error" ? "error" : f.severity === "warning" ? "warning" : "notice"
      console.log(`::${level} title=image-scan/${f.check}::${f.message} (${f.source})`)
    }
  }

  const failed = report.summary.errors > 0 || (args.strict && report.findings.length > 0)
  process.exit(failed ? 1 : 0)
}

main()
