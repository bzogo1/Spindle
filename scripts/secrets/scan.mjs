#!/usr/bin/env node
// Repository secret hygiene check. It complements gitleaks in CI and runs
// without installing dependencies so it can fail fast on a fresh checkout.
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const root = process.cwd()
const ignoredDirectories = new Set([
  ".agents",
  ".aws",
  ".codex",
  ".freebuff",
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

const patterns = [
  { name: "private key", regex: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: "AWS access key", regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "GitHub token", regex: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: "Slack token", regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "Stripe live key", regex: /\bsk_live_[A-Za-z0-9]{20,}\b/ },
  { name: "Linear API key", regex: /\blin_api_[A-Za-z0-9]{20,}\b/ },
  { name: "OpenAI key", regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/ },
  { name: "Google API key", regex: /\bAIza[0-9A-Za-z_-]{35}\b/ },
]

const findings = []

function walk(directory) {
  const files = []

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue

    const absolute = join(directory, entry.name)

    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) files.push(...walk(absolute))
      continue
    }

    files.push(relative(root, absolute).split("\\").join("/"))
  }

  return files
}

function listFiles() {
  try {
    const output = execFileSync(
      "git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      {
        cwd: root,
        encoding: "utf8",
      },
    )
    return { files: output.split("\0").filter(Boolean), fromGit: true }
  } catch {
    return { files: walk(root), fromGit: false }
  }
}

function readText(file) {
  const absolute = join(root, file)

  try {
    const stats = statSync(absolute)
    if (!stats.isFile() || stats.size > 2_000_000) return null

    const buffer = readFileSync(absolute)
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

const { files, fromGit } = listFiles()

for (const file of files) {
  if (isEnvironmentFile(file)) {
    if (file === ".env.example") {
      checkExampleFile(file)
    } else if (fromGit) {
      findings.push({ file, line: 0, rule: "environment file" })
    }
    continue
  }

  const text = readText(file)
  if (!text) continue

  const lines = text.split(/\r?\n/)

  for (const [index, line] of lines.entries()) {
    for (const pattern of patterns) {
      if (pattern.regex.test(line)) {
        findings.push({ file, line: index + 1, rule: pattern.name })
      }
    }
  }
}

function checkExampleFile(file) {
  const text = readText(file)
  if (!text) return

  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line)
    if (!match) continue

    if (match[2].trim() !== "") {
      findings.push({ file, line: index + 1, rule: `${match[1]} must stay empty` })
    }
  }
}

checkIgnoreFile(".gitignore", {
  required: [".env", ".env.*"],
  message: "must ignore .env and .env.*",
})

checkIgnoreFile(".dockerignore", {
  required: [".env", ".env.*"],
  message: "must exclude .env and .env.* from image layers",
})

function checkIgnoreFile(file, { required, message }) {
  const text = readText(file)

  if (!text) {
    findings.push({ file, line: 0, rule: `missing ${file}` })
    return
  }

  const lines = text.split(/\r?\n/).map((line) => line.trim())
  const missing = required.filter((entry) => !lines.includes(entry))

  if (missing.length > 0) {
    findings.push({ file, line: 0, rule: `${message} (missing ${missing.join(", ")})` })
  }
}

if (findings.length > 0) {
  console.error("Secret hygiene check failed:")

  for (const finding of findings) {
    const location = finding.line > 0 ? `${finding.file}:${finding.line}` : finding.file
    console.error(`  ${location}  ${finding.rule}`)
  }

  console.error("")
  console.error("Remove the value, rotate it in the provider, and use the secret store instead.")
  process.exit(1)
}

console.log(`Secret hygiene check passed (${files.length} files scanned).`)
