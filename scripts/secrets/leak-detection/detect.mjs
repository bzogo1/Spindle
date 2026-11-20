#!/usr/bin/env node
// Secret leak detection: scans git history, source files, tracked .env files,
// and optionally a running app's log output for values that look like secrets.
// Complements gitleaks (see .gitleaks.toml and docs/security/secret-leak-detection.md).
//
// Usage:
//   node scripts/secrets/leak-detection/detect.mjs [options]
//
// Options:
//   --json            Print findings as JSON instead of a human report
//   --history         Also scan `git log -p` history (slower; default on)
//   --no-history      Skip git history scan
//   --logs-dir DIR    Scan text files under DIR (app logs, error dumps)
//   --dry-run         Scan but always exit 0 (report only)
//   --demo            Print a simulated report without scanning
//   -h, --help        Show this help
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { join, relative } from "node:path"

const root = process.cwd()

const options = {
  json: false,
  history: true,
  logsDir: null,
  dryRun: false,
  demo: false,
  help: false,
}

for (const arg of process.argv.slice(2)) {
  if (arg === "--json") options.json = true
  else if (arg === "--history") options.history = true
  else if (arg === "--no-history") options.history = false
  else if (arg === "--dry-run") options.dryRun = true
  else if (arg === "--demo") options.demo = true
  else if (arg === "--help" || arg === "-h") options.help = true
  else if (arg.startsWith("--logs-dir=")) options.logsDir = arg.slice("--logs-dir=".length)
  else if (arg === "--logs-dir") {
    const next = process.argv[process.argv.indexOf(arg) + 1]
    if (next) options.logsDir = next
  } else {
    console.error(`Unknown argument: ${arg}`)
    process.exit(2)
  }
}

if (options.help) {
  console.log(`Usage: node scripts/secrets/leak-detection/detect.mjs [options]

Scans for leaked secrets in git history, source files, tracked .env files,
and (with --logs-dir) a running app's logs.

  --json            Print findings as JSON instead of a human report
  --history         Scan \`git log -p\` (default)
  --no-history      Skip git history scan
  --logs-dir DIR    Scan text files under DIR (app logs, error dumps)
  --dry-run         Scan but always exit 0 (report only)
  --demo            Print a simulated report without scanning
  -h, --help        Show this help`)
  process.exit(0)
}

// ---- Detection rules -------------------------------------------------------

const SEVERITY = { critical: 0, high: 1, medium: 2, low: 3 }

const knownPatterns = [
  {
    name: "private key",
    severity: "critical",
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/,
  },
  { name: "AWS access key", severity: "critical", regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "GitHub token", severity: "critical", regex: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  {
    name: "GitHub fine-grained token",
    severity: "critical",
    regex: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/,
  },
  { name: "Slack token", severity: "critical", regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "Stripe live key", severity: "critical", regex: /\bsk_live_[A-Za-z0-9]{20,}\b/ },
  {
    name: "OpenAI/Anthropic-style key",
    severity: "critical",
    regex: /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}\b/,
  },
  { name: "Google API key", severity: "critical", regex: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "Linear API key", severity: "high", regex: /\blin_api_[A-Za-z0-9]{20,}\b/ },
  {
    name: "JWT",
    severity: "high",
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  },
  {
    name: "connection string with credentials",
    severity: "high",
    regex: /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^/\s:@]+:[^@\s]+@/,
  },
  {
    name: "generic API key assignment",
    severity: "medium",
    regex:
      /\b[A-Z][A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY)\s*=\s*["']?[^\s"'`$]{16,}/,
  },
]

// Right-hand side values that are code references or placeholders, not literals.
const safeAssignmentValue =
  /^(?:process\.env|import|require|new |await |[A-Za-z_$][\w$]*\.|true|false|null|undefined|env\.|config\.)/i

// Lockfiles are full of integrity hashes that are not secrets.
const lockfileNames = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "composer.lock",
  "cargo.lock",
  "gemfile.lock",
  "poetry.lock",
  "go.sum",
])

// This script contains the detection patterns themselves; never scan it.
const selfPath = "scripts/secrets/leak-detection/detect.mjs"

// A line carrying this marker is a reviewed false positive (test fixture,
// documentation example, placeholder). Prefer fixing the fixture over marking.
const ignoreMarker = "leak-detection:ignore"

// High-entropy detection for strings that carry no known prefix.
const entropyPatterns = [
  // Quoted or bare strings of 32+ chars from a broad base64/hex alphabet.
  /["'`][A-Za-z0-9+/=_-]{32,}["'`]/g,
  /\b[0-9a-f]{40,}\b/gi, // hex digests/secrets
]

const entropySkipRegex =
  /^(?:[0-9a-f]{7,40}|[a-f0-9-]{36}|sha256|md5|[A-Z_]{4,}|[\w.-]+\.(?:ts|tsx|js|mjs|json|md|css|png|svg|ico|woff2?)|[a-z]+(?:-[a-z]+)+)$/i

function shannonEntropy(value) {
  const counts = new Map()
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1)
  let entropy = 0
  for (const count of counts.values()) {
    const p = count / value.length
    entropy -= p * Math.log2(p)
  }
  return entropy
}

function isHighEntropyCandidate(text) {
  if (text.length < 32 || text.length > 4096) return false
  if (entropySkipRegex.test(text)) return false
  // Only flag strings with genuine entropy; prose and hashes-in-URLs fail here.
  return shannonEntropy(text) >= 4.2
}

function looksLikeSecretValue(text) {
  if (
    /^(?:\[?redacted\]?|\*+|x+|changeme|change-me|placeholder|example|your[-_]|<.*>|\$\{.*\}|process\.env)/i.test(
      text,
    )
  ) {
    return false
  }
  // Real secrets mix character classes; alphabets, hashes, and IDs do not.
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(text)).length
  if (classes < 3) return false
  return isHighEntropyCandidate(text)
}

const placeholderPassword =
  /^(?:user|username|pass|password|passwd|secret|example|sample|test|demo|changeme|change-me|xxx+|<.*>|\$\{.*\}|%s|your[-_]?\w*|admin|root|postgres|db|database|localhost|127\.0\.0\.1|redacted|\*+)$/i

// A connection-string match only counts when the password segment looks real
// and the host is not a local development database.
function isRealCredentialedUrl(line) {
  const match = /[a-z][a-z0-9+.-]*:\/\/([^/\s:@]+):([^@\s]+)@([^/\s:]+)/i.exec(line)
  if (!match) return false
  const [, username, password, host] = match
  if (/^(?:localhost|127\.0\.0\.1|::1|0\.0\.0\.0|host\.docker\.internal)$/i.test(host)) return false
  if (password === username) return false
  if (placeholderPassword.test(password)) return false
  if (password.length < 6) return false
  return true
}

// ---- File discovery --------------------------------------------------------

const ignoredDirectories = new Set([
  ".agents",
  ".git",
  ".next",
  ".node_modules.original",
  "coverage",
  "dist",
  "legacy",
  "node_modules",
  "playwright-report",
  "public",
  "test-results",
])

function git(args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  } catch {
    return null
  }
}

function listRepoFiles() {
  const output = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
  if (output !== null) return output.split("\0").filter(Boolean)
  return walk(root).map((absolute) => relative(root, absolute).split("\\").join("/"))
}

function walk(directory) {
  const files = []
  let entries
  try {
    entries = readdirSync(directory, { withFileTypes: true })
  } catch {
    return files
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) files.push(...walk(absolute))
      continue
    }
    files.push(absolute)
  }
  return files
}

function readText(file) {
  try {
    const stats = statSync(file)
    if (!stats.isFile() || stats.size > 2_000_000) return null
    const buffer = readFileSync(file)
    if (buffer.includes(0)) return null
    return buffer.toString("utf8")
  } catch {
    return null
  }
}

function isEnvironmentFile(file) {
  const name = file.split("/").pop() ?? ""
  return name === ".env" || name.startsWith(".env.")
}

function isScannable(file) {
  return (
    /\.(?:[cm]?[jt]sx?|json|ya?ml|toml|env|txt|md|sql|sh|py|rb|go|rs|php|conf|ini|cfg|properties|xml|html?|css|scss|less|graphql|proto|dockerfile|tf|tfvars)$/i.test(
      file.split("/").pop() ?? "",
    ) || /(^|\/)(Dockerfile|Makefile|LICENSE|README)(\.|$)/i.test(file)
  )
}

// ---- Scanners --------------------------------------------------------------

function addFinding(findings, { source, severity, rule, location, excerpt }) {
  findings.push({ source, severity, rule, location, excerpt })
}

function scanText(findings, source, text, locationPrefix) {
  const lines = text.split(/\r?\n/)

  for (const [index, line] of lines.entries()) {
    if (line.includes(ignoreMarker)) continue
    for (const pattern of knownPatterns) {
      if (!pattern.regex.test(line)) continue
      if (pattern.name === "connection string with credentials" && !isRealCredentialedUrl(line)) {
        continue
      }
      if (pattern.name === "generic API key assignment") {
        const rhs = /\s*=\s*["']?([^\s"'`$]+)/.exec(line)?.[1] ?? ""
        if (
          safeAssignmentValue.test(rhs) ||
          /^<.*>$/.test(rhs) ||
          /(?:do-not-use|insecure|placeholder|example|dummy|fake|signed-)/i.test(rhs)
        ) {
          continue
        }
      }
      addFinding(findings, {
        source,
        severity: pattern.severity,
        rule: `pattern: ${pattern.name}`,
        location: `${locationPrefix}:${index + 1}`,
        excerpt: redact(line),
      })
    }

    for (const entropyPattern of entropyPatterns) {
      entropyPattern.lastIndex = 0
      let match
      while ((match = entropyPattern.exec(line)) !== null) {
        const value = match[0].replace(/^["'`]|["'`]$/g, "")
        if (looksLikeSecretValue(value)) {
          addFinding(findings, {
            source,
            severity: "medium",
            rule: "high-entropy string",
            location: `${locationPrefix}:${index + 1}`,
            excerpt: `${line.slice(0, 80)}…`,
          })
          break
        }
      }
    }
  }
}

function redact(line) {
  return line
    .trim()
    .replace(/(=|:)\s*\S{8,}/, "$1 [REDACTED]")
    .slice(0, 160)
}

function scanSourceFiles(findings) {
  const files = listRepoFiles()
  const trackedEnvFiles = []

  for (const file of files) {
    if (isEnvironmentFile(file) && file !== ".env.example") {
      trackedEnvFiles.push(file)
      addFinding(findings, {
        source: "source",
        severity: "critical",
        rule: "environment file tracked in git",
        location: file,
        excerpt: "",
      })
      continue
    }
    if (file === selfPath || lockfileNames.has(file.split("/").pop() ?? "")) continue
    if (!isScannable(file)) continue

    const text = readText(join(root, file))
    if (text) scanText(findings, "source", text, file)
  }

  return { fileCount: files.length, trackedEnvFiles }
}

function scanGitHistory(findings) {
  const log = git(["log", "-p", "--all", "--no-color", "--max-count=2000"])
  if (log === null) return 0

  // Walk the diff line by line; track the current file from diff headers.
  let currentFile = "<history>"
  const lines = log.split(/\r?\n/)
  let scanned = 0

  for (const line of lines) {
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice(6)
      continue
    }
    if (!line.startsWith("+") || line.startsWith("+++")) continue
    // Lockfile diffs are integrity hashes, not secrets.
    if (lockfileNames.has(currentFile.split("/").pop() ?? "")) continue

    const body = line.slice(1)
    if (body.includes(ignoreMarker)) continue
    for (const pattern of knownPatterns) {
      if (!pattern.regex.test(body)) continue
      if (pattern.name === "connection string with credentials" && !isRealCredentialedUrl(body)) {
        continue
      }
      if (pattern.name === "generic API key assignment") {
        const rhs = /\s*=\s*["']?([^\s"'`$]+)/.exec(body)?.[1] ?? ""
        if (
          safeAssignmentValue.test(rhs) ||
          /^<.*>$/.test(rhs) ||
          /(?:do-not-use|insecure|placeholder|example|dummy|fake|signed-)/i.test(rhs)
        ) {
          continue
        }
      }
      addFinding(findings, {
        source: "history",
        severity: pattern.severity,
        rule: `pattern: ${pattern.name}`,
        location: currentFile,
        excerpt: redact(body),
      })
      scanned++
      break
    }
    for (const entropyPattern of entropyPatterns) {
      entropyPattern.lastIndex = 0
      const match = entropyPattern.exec(body)
      if (match) {
        const value = match[0].replace(/^["'`]|["'`]$/g, "")
        if (looksLikeSecretValue(value)) {
          addFinding(findings, {
            source: "history",
            severity: "medium",
            rule: "high-entropy string",
            location: currentFile,
            excerpt: `${body.slice(0, 80)}…`,
          })
          scanned++
        }
        break
      }
    }
  }

  return scanned
}

function scanLogsDir(findings, dir) {
  const absolute = join(root, dir)
  if (!existsSync(absolute)) return 0

  const files = walk(absolute).filter((file) => /\.(log|txt|out|err|json|ndjson)$/i.test(file))
  let scanned = 0

  for (const file of files) {
    const text = readText(file)
    if (!text) continue
    scanText(findings, "logs", text, relative(root, file).split("\\").join("/"))
    scanned++
  }

  return scanned
}

// ---- Reporting -------------------------------------------------------------

function demoFindings() {
  return [
    {
      source: "source",
      severity: "critical",
      rule: "pattern: GitHub token",
      location: "src/lib/example.ts:42",
      excerpt: "const token = ghp_[REDACTED]",
    },
    {
      source: "source",
      severity: "high",
      rule: "pattern: connection string with credentials",
      location: "scripts/db-backup.sh:7",
      excerpt: "psql postgres://user:[REDACTED]@host/db",
    },
    {
      source: "source",
      severity: "critical",
      rule: "environment file tracked in git",
      location: ".env.production",
      excerpt: "",
    },
    {
      source: "history",
      severity: "medium",
      rule: "high-entropy string",
      location: "old/config.json",
      excerpt: '"apiSecret": "9f8e7d6c…"',
    },
    {
      source: "logs",
      severity: "critical",
      rule: "pattern: private key",
      location: "logs/error-dump.log:118",
      excerpt: "-----BEGIN [REDACTED] PRIVATE KEY-----",
    },
  ]
}

function printHumanReport(findings, meta) {
  const sorted = [...findings].sort(
    (a, b) => SEVERITY[a.severity] - SEVERITY[b.severity] || a.location.localeCompare(b.location),
  )

  const counts = { critical: 0, high: 0, medium: 0, low: 0 }
  for (const finding of sorted) counts[finding.severity] = (counts[finding.severity] ?? 0) + 1

  console.log("Secret leak detection report")
  console.log("============================")
  console.log(
    `Sources: ${meta.sources.join(", ") || "none"}  |  Files scanned: ${meta.fileCount}` +
      (meta.historyScanned ? `  |  History additions scanned: ${meta.historyScanned}` : "") +
      (meta.logsScanned ? `  |  Log files scanned: ${meta.logsScanned}` : ""),
  )
  console.log(
    `Findings: ${sorted.length} total — critical: ${counts.critical}, high: ${counts.high}, medium: ${counts.medium}, low: ${counts.low}`,
  )

  if (sorted.length === 0) {
    console.log("\nNo leaked secrets detected.")
    return
  }

  let lastSeverity = null
  for (const finding of sorted) {
    if (finding.severity !== lastSeverity) {
      console.log(`\n[${finding.severity.toUpperCase()}]`)
      lastSeverity = finding.severity
    }
    const location = finding.location
      ? `  ${finding.source}:${finding.location}`
      : `  ${finding.source}`
    console.log(`${location}  (${finding.rule})`)
    if (finding.excerpt) console.log(`    ${finding.excerpt}`)
  }

  console.log("\nTriage: docs/security/secret-leak-detection.md")
}

// ---- Main ------------------------------------------------------------------

if (options.demo) {
  const findings = demoFindings()
  if (options.json) {
    console.log(JSON.stringify({ demo: true, findings }, null, 2))
  } else {
    printHumanReport(findings, {
      sources: ["source", "history", "logs"],
      fileCount: 0,
      historyScanned: 0,
      logsScanned: 0,
    })
    console.log("\n(demo mode — simulated findings, nothing was scanned)")
  }
  process.exit(0)
}

const findings = []
const meta = { sources: [], fileCount: 0, historyScanned: 0, logsScanned: 0 }

const sourceResult = scanSourceFiles(findings)
meta.sources.push("source")
meta.fileCount = sourceResult.fileCount

if (options.history && git(["rev-parse", "--git-dir"]) !== null) {
  meta.historyScanned = scanGitHistory(findings)
  meta.sources.push("history")
}

if (options.logsDir) {
  meta.logsScanned = scanLogsDir(findings, options.logsDir)
  meta.sources.push("logs")
}

if (options.json) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 }
  for (const finding of findings) counts[finding.severity] = (counts[finding.severity] ?? 0) + 1
  console.log(JSON.stringify({ meta, counts, findings }, null, 2))
} else {
  printHumanReport(findings, meta)
}

const hasCritical = findings.some((finding) => finding.severity === "critical")
if (hasCritical && !options.dryRun) {
  console.error("\nCritical findings present — treat as a leak until triaged.")
  process.exit(1)
}
process.exit(0)
